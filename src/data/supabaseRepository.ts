/**
 * Postgres-backed repository and API-key authenticator.
 *
 * Reads the same tables Runman writes. RLS is enabled with no permissive policy
 * on any of them, so this connects with the service-role key and enforces
 * athlete scoping itself — every query below filters on `athlete_id` taken from
 * the authenticated key, never from tool arguments. A tool cannot ask for
 * someone else's data because it is never given the chance to name an athlete.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Activity, AthleteProfile } from '@runman/core';
import { config } from '../config.ts';
import type { AthleteRepository, AthleteSummary, AuthenticatedAthlete, Authenticator } from './repository.ts';

const API_KEY_PREFIX = 'rc_live_';

export class SupabaseRepository implements AthleteRepository, Authenticator {
  private readonly client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client =
      client ??
      createClient(config.supabaseUrl(), config.supabaseServiceKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  }

  async getAthlete(athleteId: string): Promise<AthleteSummary | null> {
    const [athleteResult, syncResult] = await Promise.all([
      this.client
        .from('athletes')
        .select('id, firstname, lastname, sex, max_heart_rate, resting_heart_rate, birth_year')
        .eq('id', athleteId)
        .maybeSingle(),
      this.client
        .from('sync_state')
        .select('last_synced_at, activity_count')
        .eq('athlete_id', athleteId)
        .maybeSingle(),
    ]);

    if (athleteResult.error) throw new Error(`Failed to read athlete: ${athleteResult.error.message}`);
    const row = athleteResult.data;
    if (!row) return null;

    const profile: AthleteProfile = {
      id: row.id,
      sex: row.sex ?? 'unspecified',
      maxHeartRate: row.max_heart_rate ?? null,
      restingHeartRate: row.resting_heart_rate ?? null,
      // Derived rather than stored, so the age-based fallback stays correct as
      // time passes instead of freezing at whatever age was entered.
      age: row.birth_year ? new Date().getUTCFullYear() - row.birth_year : null,
    };

    return {
      id: row.id,
      firstName: row.firstname ?? null,
      lastName: row.lastname ?? null,
      profile,
      lastSyncedAt: syncResult.data?.last_synced_at ?? null,
      activityCount: syncResult.data?.activity_count ?? 0,
    };
  }

  async getActivities(
    athleteId: string,
    options: { sinceDays?: number; limit?: number } = {},
  ): Promise<Activity[]> {
    let query = this.client
      .from('activities')
      .select(
        'id, name, type, start_date, distance_m, moving_time_s, elapsed_time_s, elevation_gain_m, average_heartrate, max_heartrate, average_speed_mps, is_race',
      )
      .eq('athlete_id', athleteId)
      .order('start_date', { ascending: false })
      .limit(options.limit ?? 2000);

    if (options.sinceDays) {
      const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000);
      query = query.gte('start_date', since.toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to read activities: ${error.message}`);
    return (data ?? []).map(rowToActivity);
  }

  async authenticate(apiKey: string | undefined): Promise<AuthenticatedAthlete | null> {
    if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) return null;

    const hash = createHash('sha256').update(apiKey).digest('hex');
    const { data, error } = await this.client
      .from('api_keys')
      .select('id, athlete_id, scopes, key_hash, revoked_at, expires_at')
      .eq('key_hash', hash)
      .maybeSingle();

    if (error || !data) return null;
    if (data.revoked_at) return null;
    if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

    const stored = Buffer.from(data.key_hash);
    const presented = Buffer.from(hash);
    if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) return null;

    void this.client
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(undefined, (updateError) => console.error('Failed to stamp key usage:', updateError));

    return { athleteId: data.athlete_id, keyId: data.id, scopes: data.scopes ?? ['read'] };
  }
}

interface ActivityRow {
  id: string;
  name: string;
  type: string;
  start_date: string;
  distance_m: number | string;
  moving_time_s: number;
  elapsed_time_s: number;
  elevation_gain_m: number | string | null;
  average_heartrate: number | string | null;
  max_heartrate: number | string | null;
  average_speed_mps: number | string | null;
  is_race: boolean;
}

/** Postgres numerics come back as strings; coerce once, here. */
function rowToActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Activity['type'],
    startDate: new Date(row.start_date).toISOString(),
    distanceMeters: Number(row.distance_m),
    movingTimeSeconds: Number(row.moving_time_s),
    elapsedTimeSeconds: Number(row.elapsed_time_s),
    totalElevationGainMeters: Number(row.elevation_gain_m ?? 0),
    averageHeartrate: row.average_heartrate === null ? null : Number(row.average_heartrate),
    maxHeartrate: row.max_heartrate === null ? null : Number(row.max_heartrate),
    averageSpeedMps: row.average_speed_mps === null ? null : Number(row.average_speed_mps),
    isRace: Boolean(row.is_race),
  };
}
