/**
 * Configuration.
 *
 * Same rule as Runman: nothing has a default. A server that silently falls back
 * to a baked-in credential is worse than one that refuses to start, because the
 * misconfiguration survives until someone audits the source.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. RunCoach reads the same Postgres database as ` +
        `Runman; set this in the deployment environment (or .env.local locally).`,
    );
  }
  return value;
}

export const config = {
  supabaseUrl: () => requireEnv('SUPABASE_URL'),
  supabaseServiceKey: () => requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  /** Which athlete a stdio session acts as. Only used for local development. */
  localAthleteId: () => process.env.RUNCOACH_ATHLETE_ID ?? null,
  /**
   * A single API key accepted by the stdio server, for local use with Claude
   * Desktop. HTTP deployments authenticate per request against the database
   * instead, so this is never the production path.
   */
  localApiKey: () => process.env.RUNCOACH_API_KEY ?? null,
};
