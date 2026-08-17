/**
 * In-memory repository, for tests and for the demo athlete.
 *
 * Having a fixture-backed implementation of the same interface is what lets the
 * tool tests run against the *exact* fixtures Runman's core is validated with,
 * with no database anywhere in the loop.
 */

import type { Activity, AthleteProfile } from '@runman/core';
import type { AthleteRepository, AthleteSummary, AuthenticatedAthlete, Authenticator } from './repository.ts';

export interface FixtureAthlete {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  profile: AthleteProfile;
  activities: Activity[];
  /** API keys that authenticate as this athlete. */
  apiKeys?: string[];
}

export class FixtureRepository implements AthleteRepository, Authenticator {
  private readonly athletes = new Map<string, FixtureAthlete>();
  private readonly keys = new Map<string, string>();
  /** Frozen clock, so windowed queries are deterministic across runs. */
  readonly now: Date;

  constructor(athletes: FixtureAthlete[], now: Date = new Date()) {
    this.now = now;
    for (const athlete of athletes) {
      this.athletes.set(athlete.id, athlete);
      for (const key of athlete.apiKeys ?? []) this.keys.set(key, athlete.id);
    }
  }

  async getAthlete(athleteId: string): Promise<AthleteSummary | null> {
    const athlete = this.athletes.get(athleteId);
    if (!athlete) return null;

    const latest = athlete.activities.reduce<string | null>(
      (newest, activity) => (!newest || activity.startDate > newest ? activity.startDate : newest),
      null,
    );

    return {
      id: athlete.id,
      firstName: athlete.firstName ?? null,
      lastName: athlete.lastName ?? null,
      profile: athlete.profile,
      lastSyncedAt: latest,
      activityCount: athlete.activities.length,
    };
  }

  async getActivities(
    athleteId: string,
    options: { sinceDays?: number; limit?: number } = {},
  ): Promise<Activity[]> {
    const athlete = this.athletes.get(athleteId);
    if (!athlete) return [];

    let activities = [...athlete.activities].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );

    if (options.sinceDays) {
      const cutoff = new Date(this.now.getTime() - options.sinceDays * 24 * 60 * 60 * 1000);
      activities = activities.filter((activity) => new Date(activity.startDate) >= cutoff);
    }
    return options.limit ? activities.slice(0, options.limit) : activities;
  }

  async authenticate(apiKey: string | undefined): Promise<AuthenticatedAthlete | null> {
    if (!apiKey) return null;
    const athleteId = this.keys.get(apiKey);
    return athleteId ? { athleteId, keyId: `fixture-key-${athleteId}`, scopes: ['read'] } : null;
  }
}
