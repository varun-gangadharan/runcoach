/**
 * Test fixtures.
 *
 * These are imported directly from the Runman submodule rather than copied, so
 * "what should this data produce" has exactly one definition across both repos.
 * A copy would drift the moment either side gained a case the other lacked —
 * and the whole argument for sharing a core is that the two cannot disagree.
 */

import {
  consistentRunner,
  emptyRunner,
  gpsGlitchRunner,
  noHeartRateRunner,
  oneActivityRunner,
  returningRunner,
  sporadicRunner,
  spikingRunner,
  NOW,
} from '../vendor/runman/packages/core/test/fixtures.ts';
import { FixtureRepository, type FixtureAthlete } from '../src/data/fixtureRepository.ts';
import type { ToolContext } from '../src/tools/context.ts';

export { NOW };

export const ATHLETE_IDS = {
  consistent: 'athlete-consistent',
  noHeartRate: 'athlete-no-hr',
  oneActivity: 'athlete-one-activity',
  empty: 'athlete-empty',
  gpsGlitch: 'athlete-gps-glitch',
  sporadic: 'athlete-sporadic',
  returning: 'athlete-returning',
  spiking: 'athlete-spiking',
} as const;

function athlete(id: string, source: { activities: unknown; profile: unknown }, apiKey: string): FixtureAthlete {
  const { activities, profile } = source as { activities: FixtureAthlete['activities']; profile: FixtureAthlete['profile'] };
  return { id, profile, activities, apiKeys: [apiKey] };
}

export function repository(): FixtureRepository {
  return new FixtureRepository(
    [
      athlete(ATHLETE_IDS.consistent, consistentRunner(), 'rc_live_consistent'),
      athlete(ATHLETE_IDS.noHeartRate, noHeartRateRunner(), 'rc_live_nohr'),
      athlete(ATHLETE_IDS.oneActivity, oneActivityRunner(), 'rc_live_one'),
      athlete(ATHLETE_IDS.empty, emptyRunner(), 'rc_live_empty'),
      athlete(ATHLETE_IDS.gpsGlitch, gpsGlitchRunner(), 'rc_live_glitch'),
      athlete(ATHLETE_IDS.sporadic, sporadicRunner(), 'rc_live_sporadic'),
      athlete(ATHLETE_IDS.returning, returningRunner(), 'rc_live_returning'),
      athlete(ATHLETE_IDS.spiking, spikingRunner(), 'rc_live_spiking'),
    ],
    NOW,
  );
}

/** A tool context pinned to the fixture clock. */
export function context(athleteId: string, repo = repository()): ToolContext {
  return { repository: repo, athleteId, now: () => NOW };
}

/** The text a tool returned, for assertions. */
export function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((part) => part.text).join('\n');
}
