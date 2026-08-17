/**
 * Per-session tool context.
 *
 * The athlete id lives here, resolved once from the authenticated API key, and
 * is *not* a tool argument. That is deliberate: if a model could pass an athlete
 * id, a prompt-injected instruction in an activity title could ask it to. Tools
 * can only ever read the data belonging to the key that called them.
 */

import type { AthleteRepository } from '../data/repository.ts';

export interface ToolContext {
  repository: AthleteRepository;
  athleteId: string;
  /** Injectable clock, so tool tests are deterministic. */
  now: () => Date;
}

/**
 * Result shape every tool returns.
 *
 * The index signature is what the SDK's `CallToolResult` requires — MCP allows
 * arbitrary extra fields on a tool result, so the type has to permit them.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Wrap a handler so an unexpected failure reaches the model as a readable
 * message rather than a stack trace or a silent empty response — a model that
 * receives "no data" when the real answer is "the database is unreachable" will
 * confidently tell the user they have not been training.
 */
export function guard(handler: () => Promise<ToolResult>): Promise<ToolResult> {
  return handler().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(
      `RunCoach could not complete this request: ${message}\n\n` +
        `This is a server-side failure, not a statement about the athlete's training. ` +
        `Do not infer anything about their fitness from it.`,
    );
  });
}
