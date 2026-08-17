#!/usr/bin/env node
/**
 * Local stdio entry point, for running RunCoach inside Claude Desktop against
 * your own data.
 *
 * The deployed HTTP transport authenticates each request against an API key in
 * the database. A stdio server has no requests to authenticate — it runs as a
 * child process of the client — so the athlete is fixed at startup from the
 * environment. That is only appropriate on the athlete's own machine.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.ts';
import { SupabaseRepository } from './data/supabaseRepository.ts';
import { config } from './config.ts';

async function main(): Promise<void> {
  const repository = new SupabaseRepository();

  // Prefer an API key, so a local run exercises the same lookup the deployment
  // does; fall back to a plain athlete id for quick local iteration.
  const apiKey = config.localApiKey();
  let athleteId = config.localAthleteId();

  if (apiKey) {
    const authenticated = await repository.authenticate(apiKey);
    if (!authenticated) {
      throw new Error('RUNCOACH_API_KEY was rejected: unknown, revoked, or expired.');
    }
    athleteId = authenticated.athleteId;
  }

  if (!athleteId) {
    throw new Error(
      'Set RUNCOACH_API_KEY (issued from the Runman profile page) or RUNCOACH_ATHLETE_ID so ' +
        'RunCoach knows whose data to serve.',
    );
  }

  const server = createServer({ repository, athleteId, now: () => new Date() });
  await server.connect(new StdioServerTransport());

  // stdout carries the protocol, so diagnostics must go to stderr.
  console.error(`RunCoach ready for athlete ${athleteId}`);
}

main().catch((error: unknown) => {
  console.error('RunCoach failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
