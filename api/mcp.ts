/**
 * Streamable-HTTP MCP endpoint.
 *
 * This is what makes RunCoach a service rather than a script: any MCP client
 * that can reach a URL can use it, without cloning anything.
 *
 * Authentication is per request. The API key resolves to exactly one athlete,
 * and that athlete id becomes the tool context — tools never take an athlete
 * argument, so there is no path by which a request authenticated as one athlete
 * can read another's data, whatever the model is asked to do.
 *
 * Each request builds its own server and transport instance. Sharing one across
 * requests in a serverless environment risks interleaving two athletes' sessions
 * inside a single warm container, which is exactly the failure that must not
 * happen when the payload is someone's personal health data.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../src/server.ts';
import { SupabaseRepository } from '../src/data/supabaseRepository.ts';

/** `Authorization: Bearer rc_live_…`, or `X-API-Key: rc_live_…`. */
function extractApiKey(req: IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();

  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return undefined;
}

function unauthorized(res: ServerResponse, message: string): void {
  // The WWW-Authenticate header is what lets a client tell "I need a credential"
  // apart from "your credential is wrong".
  res.setHeader('WWW-Authenticate', 'Bearer realm="RunCoach"');
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message },
      id: null,
    }),
  );
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'GET') {
    // A plain browser hitting the endpoint should get an explanation, not a
    // protocol error it cannot interpret.
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        name: 'runcoach',
        description: 'MCP server exposing a runner\'s computed training data as LLM-callable tools.',
        transport: 'streamable-http',
        authentication: 'Bearer token — an API key issued from the Runman profile page.',
        tools: [
          'get_training_load',
          'predict_race_time',
          'get_recent_activities',
          'generate_training_plan',
          'analyze_training_status',
        ],
      }),
    );
    return;
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.statusCode = 405;
    res.end();
    return;
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    unauthorized(res, 'Missing API key. Send it as an Authorization: Bearer header.');
    return;
  }

  let repository: SupabaseRepository;
  try {
    repository = new SupabaseRepository();
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: error instanceof Error ? error.message : 'Configuration error' },
        id: null,
      }),
    );
    return;
  }

  const authenticated = await repository.authenticate(apiKey);
  if (!authenticated) {
    unauthorized(res, 'API key is unknown, revoked, or expired.');
    return;
  }

  const server = createServer({
    repository,
    athleteId: authenticated.athleteId,
    now: () => new Date(),
  });

  // Stateless mode: no session ids to track across serverless invocations, which
  // would otherwise require shared storage for something the client can carry.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
