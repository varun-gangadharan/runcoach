/**
 * Phase 2 verification: pull a real athlete's computed training load out of the
 * live database and print it.
 *
 * This exists because "the repository compiles" and "the repository returns
 * correct data from Postgres" are different claims. The tool tests run against
 * fixtures by design — fast, hermetic, no credentials — which means nothing in
 * the suite exercises the actual SQL, the actual column names, or the numeric
 * coercion Postgres forces on us. This script does, against real rows.
 *
 * Usage: node --experimental-strip-types scripts/verify-data-layer.ts [athleteId]
 */

import { readFileSync } from 'node:fs';
import {
  analyzeTrainingStatus,
  computeLoadSeries,
  predictRaceTime,
  rollingVolume,
} from '@runman/core';
import { SupabaseRepository } from '../src/data/supabaseRepository.ts';

function loadEnv(): void {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!;
    }
  } catch {
    // Already in the environment, presumably.
  }
}

function check(label: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}: ${detail}`);
  return ok;
}

async function main(): Promise<void> {
  loadEnv();
  const athleteId = process.argv[2] ?? 'demo-athlete';
  const repository = new SupabaseRepository();
  const failures: string[] = [];

  const record = (label: string, ok: boolean, detail: string): void => {
    if (!check(label, ok, detail)) failures.push(label);
  };

  console.log(`\n=== Reading athlete "${athleteId}" from Postgres ===\n`);

  const athlete = await repository.getAthlete(athleteId);
  if (!athlete) throw new Error(`No athlete row for "${athleteId}".`);

  record('athlete row', true, `${athlete.firstName ?? '?'} ${athlete.lastName ?? ''}`.trim());
  record(
    'profile physiology loaded',
    athlete.profile.maxHeartRate !== null || athlete.profile.age !== null,
    `maxHR=${athlete.profile.maxHeartRate}, restingHR=${athlete.profile.restingHeartRate}, age=${athlete.profile.age}`,
  );

  const activities = await repository.getActivities(athleteId, { sinceDays: 400 });
  record('activities returned', activities.length > 0, `${activities.length} activities`);

  // The coercion check that fixtures cannot catch: Postgres returns `numeric`
  // columns as strings, so a missing Number() shows up here as a string
  // masquerading as a distance and silently breaks every calculation.
  const sample = activities[0]!;
  record(
    'numeric columns coerced',
    typeof sample.distanceMeters === 'number' &&
      typeof sample.movingTimeSeconds === 'number' &&
      Number.isFinite(sample.distanceMeters),
    `distanceMeters is ${typeof sample.distanceMeters} (${sample.distanceMeters})`,
  );
  record(
    'dates are valid ISO instants',
    !Number.isNaN(new Date(sample.startDate).getTime()),
    sample.startDate,
  );

  console.log('\n=== 90-day training load ===\n');
  const load = computeLoadSeries(activities, { days: 90, profile: athlete.profile });
  if (!load) throw new Error('computeLoadSeries returned null for an athlete with activities.');

  console.log(`Fitness (CTL): ${load.current.ctl}`);
  console.log(`Fatigue (ATL): ${load.current.atl}`);
  console.log(`Form (TSB):    ${load.current.tsb > 0 ? '+' : ''}${load.current.tsb}`);
  console.log(`ACWR:          ${load.acuteChronicRatio}`);
  console.log(`Trend:         ${load.trend}`);
  console.log(`Method:        ${load.method} (confidence: ${load.confidence})`);

  record('load series covers 90 calendar days', load.series.length === 90, `${load.series.length} days`);
  record(
    'rest days present in the series',
    load.series.some((day) => day.activityCount === 0),
    `${load.series.filter((d) => d.activityCount === 0).length} rest days`,
  );
  record('fitness is a positive finite number', load.current.ctl > 0 && Number.isFinite(load.current.ctl), String(load.current.ctl));

  console.log('\nLast 10 days:');
  for (const day of load.series.slice(-10)) {
    console.log(`  ${day.date}  load ${String(day.load).padStart(6)}  ctl ${day.ctl}  atl ${day.atl}`);
  }

  console.log('\n=== 28-day volume ===\n');
  const volume = rollingVolume(activities, { windowDays: 28 });
  console.log(
    `${(volume.distanceMeters / 1000).toFixed(1)} km over 28 days = ` +
      `${(volume.averageWeeklyDistanceMeters / 1000).toFixed(1)} km/week ` +
      `(${volume.activityCount} runs across ${volume.runDays} days)`,
  );

  console.log('\n=== Half-marathon prediction ===\n');
  const prediction = predictRaceTime(activities, 21097.5);
  if (prediction) {
    console.log(`${prediction.formattedTime} (${prediction.formattedPace}), ${prediction.confidence} confidence`);
    console.log(`Method: ${prediction.method}, exponent ${prediction.exponent}`);
    console.log('Derived from:');
    for (const reference of prediction.basedOn) {
      console.log(`  "${reference.activityName}" ${reference.date.slice(0, 10)} — ${reference.formattedTime}`);
    }
    if (prediction.excluded.length > 0) {
      console.log(`Excluded ${prediction.excluded.length}: ${prediction.excluded[0]!.reasons[0]}`);
    }
    record('prediction is traceable to real activity ids', prediction.basedOn.length > 0, `${prediction.basedOn.length} references`);
    record(
      'reference ids exist in the fetched activities',
      prediction.basedOn.every((reference) => activities.some((a) => a.id === reference.activityId)),
      'all reference ids resolve',
    );
  } else {
    record('prediction produced', false, 'predictRaceTime returned null');
  }

  console.log('\n=== Training status ===\n');
  const status = analyzeTrainingStatus(activities, { profile: athlete.profile });
  console.log(`${status.headline} (${status.state}, ${status.confidence} confidence)`);
  record('status has a narrative', status.narrative.length > 60, `${status.narrative.length} chars`);

  console.log('');
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('All data-layer checks passed against the live database.');
}

main().catch((error: unknown) => {
  console.error('\nVerification failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
