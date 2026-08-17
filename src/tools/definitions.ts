/**
 * The five v1 tools.
 *
 * Each is a thin adapter: fetch the athlete's activities, hand them to
 * `@runman/core`, format the result for a model. No tool reimplements any
 * calculation, which is the point of sharing the core — a fix to the race
 * predictor lands in the web app and here at the same time, and the fixture
 * tests that guard it are the same fixtures.
 */

import { z } from 'zod';
import {
  analyzeTrainingStatus,
  buildLoadScorer,
  computeLoadSeries,
  generateTrainingPlan,
  heartRateZones,
  PlanGenerationError,
  predictRaceTime,
  rollingVolume,
  STANDARD_DISTANCES,
  type Activity,
} from '@runman/core';
import { bullets, compose, confidenceLine, date, duration, km, pace, section } from './format.ts';
import { errorResult, textResult, type ToolContext, type ToolResult } from './context.ts';

/** History depth for calculations whose exponential averages need warm-up. */
const FULL_HISTORY_DAYS = 400;

async function loadActivities(context: ToolContext, days = FULL_HISTORY_DAYS): Promise<Activity[]> {
  return context.repository.getActivities(context.athleteId, { sinceDays: days });
}

/** Shared "nothing to work with" answer, so no tool invents a number from zero. */
function noDataResult(what: string): ToolResult {
  return textResult(
    `No activities are stored for this athlete, so ${what} cannot be computed.\n\n` +
      `Tell the athlete their Strava history has not been synced into Runman yet, and do not ` +
      `estimate or guess any figures.`,
  );
}

const distanceEnum = z.enum([
  '5K',
  '10K',
  '15K',
  '10 mile',
  'Half Marathon',
  '30K',
  'Marathon',
  '50K',
]);

function metersFor(label: string): number {
  const match = STANDARD_DISTANCES.find((distance) => distance.label === label);
  if (!match) throw new Error(`Unknown race distance: ${label}`);
  return match.meters;
}

// ---------------------------------------------------------------------------

export const getTrainingLoadSchema = {
  windowDays: z
    .number()
    .int()
    .min(7)
    .max(365)
    .default(42)
    .describe('Calendar days to report the trend over. 42 covers a full fitness time constant.'),
};

export async function getTrainingLoad(
  context: ToolContext,
  args: { windowDays?: number },
): Promise<ToolResult> {
  const windowDays = args.windowDays ?? 42;
  const activities = await loadActivities(context);
  if (activities.length === 0) return noDataResult('training load');

  const athlete = await context.repository.getAthlete(context.athleteId);
  const summary = computeLoadSeries(activities, {
    endDate: context.now(),
    days: windowDays,
    profile: athlete?.profile ?? {},
  });

  if (!summary) return noDataResult('training load');

  const { current, trend, acuteChronicRatio, ctlChangeRatio } = summary;
  const changePercent = Math.round(ctlChangeRatio * 100);

  const ratioReading =
    acuteChronicRatio >= 1.5
      ? 'above the 1.5 threshold associated with elevated injury risk — recent training is running well ahead of what the last six weeks prepared them for'
      : acuteChronicRatio >= 1.3
        ? 'at the upper end of the comfortable 0.8–1.3 band'
        : acuteChronicRatio >= 0.8
          ? 'inside the comfortable 0.8–1.3 band'
          : 'below 0.8, which means recent training is lighter than the established base';

  return textResult(
    compose(
      `# Training load over the last ${windowDays} days`,
      section(
        'Current values',
        bullets([
          `Fitness (CTL, 42-day exponential average): ${current.ctl}`,
          `Fatigue (ATL, 7-day exponential average): ${current.atl}`,
          `Form (TSB, fitness minus fatigue): ${current.tsb > 0 ? '+' : ''}${current.tsb}`,
          `Acute:chronic workload ratio: ${acuteChronicRatio} — ${ratioReading}`,
        ]),
      ),
      section(
        'Trend',
        `Fitness has ${changePercent >= 0 ? 'risen' : 'fallen'} ${Math.abs(changePercent)}% across the window. ` +
          `Classified as: **${trend}**.`,
      ),
      section(
        'Recent daily load',
        summary.series
          .slice(-14)
          .map((day) => `${day.date}: load ${day.load}${day.activityCount === 0 ? ' (rest)' : ` (${day.activityCount} activity)`}`)
          .join('\n'),
      ),
      confidenceLine(summary.confidence, summary.explanation),
    ),
  );
}

// ---------------------------------------------------------------------------

export const predictRaceTimeSchema = {
  distance: distanceEnum.describe('Target race distance.'),
  goal: z
    .enum(['finish', 'pr', 'compete'])
    .default('finish')
    .describe(
      'What the athlete intends to do on race day. Affects pacing advice only — it does not and must not change the predicted time.',
    ),
};

export async function predictRace(
  context: ToolContext,
  args: { distance: string; goal?: 'finish' | 'pr' | 'compete' },
): Promise<ToolResult> {
  const activities = await loadActivities(context);
  if (activities.length === 0) return noDataResult('a race prediction');

  const targetMeters = metersFor(args.distance);
  const prediction = predictRaceTime(activities, targetMeters, {
    goal: args.goal ?? 'finish',
    now: context.now(),
  });

  if (!prediction) {
    return textResult(
      `No activity in the last six months is clean enough and long enough to base a ${args.distance} ` +
        `prediction on.\n\nTell the athlete this directly. Do not estimate a time from their weekly ` +
        `mileage or from anything other than an actual recorded effort.`,
    );
  }

  const references = prediction.basedOn
    .map(
      (reference) =>
        `"${reference.activityName}" on ${date(reference.date)} — ${km(reference.distanceMeters)} in ` +
        `${reference.formattedTime} (${reference.formattedPace})`,
    )
    .join('\n');

  const excluded =
    prediction.excluded.length > 0
      ? section(
          `Excluded from consideration (${prediction.excluded.length})`,
          prediction.excluded
            .slice(0, 5)
            .map((entry) => `"${entry.activityName}" on ${date(entry.date)} — ${entry.reasons.join('; ')}`)
            .join('\n') +
            (prediction.excluded.length > 5 ? `\n…and ${prediction.excluded.length - 5} more.` : ''),
        )
      : null;

  return textResult(
    compose(
      `# ${prediction.targetLabel} prediction: ${prediction.formattedTime}`,
      section(
        'Details',
        bullets([
          `Predicted time: ${prediction.formattedTime} (${prediction.formattedPace})`,
          `Plausible range: ${prediction.range.formattedOptimistic} to ${prediction.range.formattedConservative}`,
          `Method: ${prediction.method === 'personal_power_law' ? "fitted to this athlete's own distance/time curve" : 'Riegel scaling from the closest recorded effort'}`,
          `Fatigue exponent used: ${prediction.exponent} (population average is 1.06)`,
        ]),
      ),
      section('Derived from these activities', references),
      excluded,
      section('Pacing advice for this goal', prediction.pacingAdvice),
      confidenceLine(prediction.confidence, prediction.explanation),
      `When reporting this, name at least one of the reference activities above. The athlete should ` +
        `be able to see which of their runs produced the number.`,
    ),
  );
}

// ---------------------------------------------------------------------------

export const getRecentActivitiesSchema = {
  days: z.number().int().min(1).max(365).default(28).describe('Calendar days to look back over.'),
  limit: z.number().int().min(1).max(50).default(20).describe('Maximum activities to return.'),
  runsOnly: z.boolean().default(true).describe('Exclude rides, swims and walks.'),
};

export async function getRecentActivities(
  context: ToolContext,
  args: { days?: number; limit?: number; runsOnly?: boolean },
): Promise<ToolResult> {
  const days = args.days ?? 28;
  const limit = args.limit ?? 20;
  const runsOnly = args.runsOnly ?? true;

  const all = await loadActivities(context);
  if (all.length === 0) return noDataResult('recent activity');

  const athlete = await context.repository.getAthlete(context.athleteId);
  const scorer = buildLoadScorer(all, athlete?.profile ?? {});

  const cutoff = new Date(context.now().getTime() - days * 24 * 60 * 60 * 1000);
  const recent = all
    .filter((activity) => new Date(activity.startDate) >= cutoff)
    .filter((activity) => !runsOnly || ['Run', 'TrailRun', 'VirtualRun'].includes(activity.type))
    .slice(0, limit);

  const volume = rollingVolume(all, { endDate: context.now(), windowDays: days, runsOnly });

  if (recent.length === 0) {
    return textResult(
      `No ${runsOnly ? 'runs' : 'activities'} recorded in the last ${days} days. ` +
        `That gap is itself the answer — report it rather than looking further back without saying so.`,
    );
  }

  const rows = recent.map((activity) => {
    const scored = scorer.score(activity);
    const activityPace =
      activity.distanceMeters > 0 ? pace((activity.movingTimeSeconds / activity.distanceMeters) * 1000) : 'n/a';
    const hr = activity.averageHeartrate ? `${Math.round(activity.averageHeartrate)} bpm avg` : 'no HR data';
    return (
      `${date(activity.startDate)} — "${activity.name}": ${km(activity.distanceMeters)} in ` +
      `${duration(activity.movingTimeSeconds)} (${activityPace}), ${hr}, load ${Math.round(scored.load)}` +
      `${activity.isRace ? ' [race]' : ''}`
    );
  });

  return textResult(
    compose(
      `# ${recent.length} ${runsOnly ? 'runs' : 'activities'} in the last ${days} days`,
      section(
        'Totals for the window',
        bullets([
          `Distance: ${km(volume.distanceMeters)} across ${volume.runDays} of ${days} days`,
          `Average: ${km(volume.averageWeeklyDistanceMeters)}/week`,
          `Longest: ${km(volume.longestRunMeters)}`,
        ]),
      ),
      section('Activities', rows.join('\n')),
      `Load values above come from ${scorer.primaryMethod === 'trimp_hr' ? 'heart-rate-based TRIMP' : scorer.primaryMethod === 'duration_only' ? 'duration alone, which is an assumption rather than a measurement' : 'pace against estimated threshold'}. ${scorer.explanation}`,
    ),
  );
}

// ---------------------------------------------------------------------------

export const generateTrainingPlanSchema = {
  distance: distanceEnum.describe('Target race distance.'),
  raceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .describe('Race date, YYYY-MM-DD. Must be 6 to 24 weeks away.'),
  daysPerWeek: z.number().int().min(3).max(7).default(4).describe('Running days per week.'),
  goal: z.enum(['finish', 'pr', 'compete']).default('finish').describe('Race intent.'),
  peakWeeklyKm: z
    .number()
    .min(10)
    .max(250)
    .optional()
    .describe('Optional target peak weekly volume. Capped if it exceeds a safe progression.'),
};

export async function generatePlan(
  context: ToolContext,
  args: {
    distance: string;
    raceDate: string;
    daysPerWeek?: number;
    goal?: 'finish' | 'pr' | 'compete';
    peakWeeklyKm?: number;
  },
): Promise<ToolResult> {
  const activities = await loadActivities(context);
  if (activities.length === 0) return noDataResult('a training plan');

  const athlete = await context.repository.getAthlete(context.athleteId);

  try {
    const plan = generateTrainingPlan(activities, {
      targetDistanceMeters: metersFor(args.distance),
      raceDate: new Date(`${args.raceDate}T00:00:00Z`),
      daysPerWeek: args.daysPerWeek ?? 4,
      goal: args.goal ?? 'finish',
      peakWeeklyMeters: args.peakWeeklyKm ? args.peakWeeklyKm * 1000 : undefined,
      profile: athlete?.profile ?? {},
      now: context.now(),
    });

    const weekLines = plan.weeks.map((week) => {
      const sessions = week.workouts
        .filter((workout) => workout.type !== 'rest')
        .map((workout) => `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][workout.dayOfWeek]} ${workout.type} ${km(workout.distanceMeters)}`)
        .join(', ');
      return (
        `Week ${week.weekNumber} (${week.weekStart}) — ${week.phase}${week.isRecoveryWeek ? ' / recovery' : ''}: ` +
        `${km(week.targetDistanceMeters)} total, long run ${km(week.longRunMeters)}\n  ${sessions}`
      );
    });

    return textResult(
      compose(
        `# ${plan.weeks.length}-week plan to ${plan.targetLabel} on ${plan.raceDate}`,
        section(
          'Shape of the plan',
          bullets([
            `Starting volume: ${km(plan.startingWeeklyMeters)}/week (measured over the last 28 calendar days)`,
            `Peak volume: ${km(plan.peakWeeklyMeters)}/week`,
            `Total: ${km(plan.totalDistanceMeters, 0)}`,
            `Recovery weeks: every fourth week, roughly 25% down`,
          ]),
        ),
        section(
          'Target paces',
          bullets([
            `Recovery: ${plan.paces.recovery.formatted}`,
            `Easy: ${plan.paces.easy.formatted}`,
            `Long run: ${plan.paces.long.formatted}`,
            `Tempo: ${plan.paces.tempo.formatted}`,
            `Intervals: ${plan.paces.intervals.formatted}`,
          ]),
        ),
        section('Week by week', weekLines.join('\n')),
        plan.warnings.length > 0
          ? section('Warnings the athlete needs to hear', bullets(plan.warnings))
          : null,
        confidenceLine(plan.confidence, plan.explanation),
        plan.warnings.length > 0
          ? 'Repeat the warnings above when presenting this plan. They are not boilerplate — each one ' +
            'describes a specific way this plan could injure this athlete.'
          : null,
      ),
    );
  } catch (error) {
    if (error instanceof PlanGenerationError) {
      // A refusal with a reason is a better answer than a plan built on nothing.
      return textResult(
        `A plan cannot be generated: ${error.message}\n\n` +
          `Relay this reason to the athlete. Do not construct a plan yourself to fill the gap — ` +
          `the refusal exists because the inputs would make the plan unsafe.`,
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------

export const analyzeTrainingStatusSchema = {
  windowDays: z
    .number()
    .int()
    .min(14)
    .max(180)
    .default(42)
    .describe('Calendar days for the load trend underlying the assessment.'),
};

export async function analyzeStatus(
  context: ToolContext,
  args: { windowDays?: number },
): Promise<ToolResult> {
  const activities = await loadActivities(context);
  const athlete = await context.repository.getAthlete(context.athleteId);

  if (activities.length === 0) return noDataResult('a training status assessment');

  const status = analyzeTrainingStatus(activities, {
    now: context.now(),
    profile: athlete?.profile ?? {},
    windowDays: args.windowDays ?? 42,
  });

  const zones = heartRateZones(activities, athlete?.profile ?? {});

  return textResult(
    compose(
      `# ${status.headline}`,
      status.narrative,
      section('What the data shows', bullets(status.observations)),
      section('What to do about it', bullets(status.recommendations)),
      section(
        'Key numbers',
        bullets([
          `Fitness (CTL): ${status.metrics.fitness ?? 'unavailable'}`,
          `Fatigue (ATL): ${status.metrics.fatigue ?? 'unavailable'}`,
          `Form (TSB): ${status.metrics.form ?? 'unavailable'}`,
          `Acute:chronic ratio: ${status.metrics.acuteChronicRatio ?? 'unavailable'}`,
          `Volume: ${status.metrics.weeklyDistanceKm} km/week over the last 28 days`,
          `Frequency: ${status.metrics.runsPerWeek} runs/week`,
          `Longest gap in the last 12 weeks: ${status.metrics.longestGapDays} days`,
          zones
            ? `Heart-rate zones: Z2 ${zones.zones[1]!.minBpm}–${zones.zones[1]!.maxBpm} bpm, threshold ${zones.zones[3]!.minBpm}–${zones.zones[3]!.maxBpm} bpm`
            : 'Heart-rate zones: unavailable (no HR data and no max HR or age on file)',
        ]),
      ),
      status.caveats.length > 0 ? section('What limits this assessment', bullets(status.caveats)) : null,
      confidenceLine(
        status.confidence,
        `Assessment state: ${status.state}. Derived from ${activities.length} stored activities.`,
      ),
      status.caveats.length > 0
        ? 'Carry the limitations above into your answer. An athlete told their fitness is 34 without ' +
          'being told that number rests on a duration-only estimate has been given false precision.'
        : null,
    ),
  );
}
