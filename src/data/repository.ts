/**
 * Data access.
 *
 * `AthleteRepository` is an interface rather than a concrete Supabase client so
 * that the tools can be tested against the same fixtures Runman's core is tested
 * with. A tool test that needs a live database is a test nobody runs.
 *
 * Queries go directly to Postgres rather than through Runman's HTTP API. Both
 * services are owned by the same person and share the same schema, so routing
 * through HTTP would mean implementing authentication against ourselves for no
 * gain — one more hop, one more failure mode, one more credential.
 */

import type { Activity, AthleteProfile } from '@runman/core';

export interface AthleteSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profile: AthleteProfile;
  /** When the athlete's Strava data was last pulled in, if ever. */
  lastSyncedAt: string | null;
  activityCount: number;
}

export interface AthleteRepository {
  /** Null when no athlete row exists for that id. */
  getAthlete(athleteId: string): Promise<AthleteSummary | null>;

  /**
   * Activities for an athlete, newest first.
   * `sinceDays` is a calendar window, not an activity count — see the note in
   * `@runman/core`'s volume module for why that distinction matters.
   */
  getActivities(athleteId: string, options?: { sinceDays?: number; limit?: number }): Promise<Activity[]>;
}

/** Resolved identity for one request. */
export interface AuthenticatedAthlete {
  athleteId: string;
  keyId: string | null;
  scopes: string[];
}

export interface Authenticator {
  /** Null when the key is unknown, revoked or expired. */
  authenticate(apiKey: string | undefined): Promise<AuthenticatedAthlete | null>;
}
