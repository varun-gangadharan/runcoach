import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  analyzeStatus,
  generatePlan,
  getRecentActivities,
  getTrainingLoad,
  predictRace,
} from '../src/tools/definitions.ts';
import { ATHLETE_IDS, context, NOW, repository, textOf } from './fixtures.ts';

function raceDateIn(weeks: number): string {
  return new Date(NOW.getTime() + weeks * 7 * 86400000).toISOString().slice(0, 10);
}

describe('get_training_load', () => {
  test('reports fitness, fatigue, form and the acute:chronic ratio', async () => {
    const text = textOf(await getTrainingLoad(context(ATHLETE_IDS.consistent), { windowDays: 42 }));

    assert.match(text, /Fitness \(CTL/);
    assert.match(text, /Fatigue \(ATL/);
    assert.match(text, /Form \(TSB/);
    assert.match(text, /Acute:chronic workload ratio/);
    assert.match(text, /Confidence: (high|medium|low)/);
  });

  test('flags a load spike as elevated risk rather than reporting a bare number', async () => {
    const text = textOf(await getTrainingLoad(context(ATHLETE_IDS.spiking), { windowDays: 42 }));
    assert.match(text, /elevated injury risk/);
    assert.match(text, /ramping/);
  });

  test('says so, and instructs the model not to guess, when there is no data', async () => {
    const text = textOf(await getTrainingLoad(context(ATHLETE_IDS.empty), {}));
    assert.match(text, /No activities are stored/);
    assert.match(text, /do not\s+estimate or guess/i);
  });

  test('carries the calculation method into the output for a no-HR athlete', async () => {
    const text = textOf(await getTrainingLoad(context(ATHLETE_IDS.noHeartRate), { windowDays: 42 }));
    assert.match(text, /How it was calculated:/);
    assert.match(text, /No usable heart-rate data/);
  });
});

describe('predict_race_time', () => {
  test('names the activities the prediction came from', async () => {
    const text = textOf(
      await predictRace(context(ATHLETE_IDS.consistent), { distance: 'Marathon', goal: 'finish' }),
    );

    assert.match(text, /Derived from these activities/);
    // The fixture's races must be traceable by name and date in the output.
    assert.match(text, /10K race|5K race|Half marathon/);
    assert.match(text, /\d{4}-\d{2}-\d{2}/);
  });

  test('excludes a GPS glitch and reports that it did', async () => {
    const text = textOf(
      await predictRace(context(ATHLETE_IDS.gpsGlitch), { distance: 'Marathon', goal: 'finish' }),
    );

    assert.match(text, /Excluded from consideration/);
    assert.match(text, /Tunnel GPS glitch/);
    assert.match(text, /world record/);
    // And the glitch must not appear as a source.
    const derivedSection = text.split('Excluded from consideration')[0]!;
    assert.ok(!derivedSection.includes('Tunnel GPS glitch'));
  });

  test('the goal changes only the pacing advice', async () => {
    const finish = textOf(await predictRace(context(ATHLETE_IDS.consistent), { distance: '10K', goal: 'finish' }));
    const compete = textOf(await predictRace(context(ATHLETE_IDS.consistent), { distance: '10K', goal: 'compete' }));

    const timeOf = (text: string) => text.match(/# 10K prediction: ([\d:]+)/)?.[1];
    assert.ok(timeOf(finish));
    assert.equal(timeOf(finish), timeOf(compete));
    assert.notEqual(finish, compete); // pacing advice differs
  });

  test('refuses rather than estimating when nothing supports a prediction', async () => {
    const text = textOf(await predictRace(context(ATHLETE_IDS.empty), { distance: '10K' }));
    assert.match(text, /No activities are stored|clean enough/);
    assert.match(text, /do not/i);
  });

  test('a single-activity athlete gets a low-confidence answer, clearly labelled', async () => {
    const text = textOf(await predictRace(context(ATHLETE_IDS.oneActivity), { distance: 'Marathon' }));
    assert.match(text, /Confidence: low/);
    assert.match(text, /rough estimate/);
  });
});

describe('get_recent_activities', () => {
  test('summarises recent runs with pace, heart rate and load', async () => {
    const text = textOf(await getRecentActivities(context(ATHLETE_IDS.consistent), { days: 28, limit: 10 }));

    assert.match(text, /runs in the last 28 days/);
    assert.match(text, /bpm avg/);
    assert.match(text, /load \d+/);
    assert.match(text, /Average: [\d.]+ km\/week/);
  });

  test('reports "no HR data" rather than omitting the field', async () => {
    const text = textOf(await getRecentActivities(context(ATHLETE_IDS.noHeartRate), { days: 28 }));
    assert.match(text, /no HR data/);
  });

  test('treats a gap as the answer instead of silently widening the window', async () => {
    const text = textOf(await getRecentActivities(context(ATHLETE_IDS.returning), { days: 14 }));
    assert.match(text, /No runs recorded in the last 14 days/);
    assert.match(text, /That gap is itself the answer/);
  });
});

describe('generate_training_plan', () => {
  test('builds a plan anchored to measured volume', async () => {
    const text = textOf(
      await generatePlan(context(ATHLETE_IDS.consistent), {
        distance: 'Marathon',
        raceDate: raceDateIn(16),
        daysPerWeek: 4,
        goal: 'finish',
      }),
    );

    assert.match(text, /week plan to Marathon/);
    assert.match(text, /measured over the last 28 calendar days/);
    assert.match(text, /Recovery weeks: every fourth week/);
    assert.match(text, /Target paces/);
    assert.match(text, /Week 1 \(/);
  });

  test('refuses a race window that is too short, and tells the model not to improvise', async () => {
    const text = textOf(
      await generatePlan(context(ATHLETE_IDS.consistent), { distance: 'Marathon', raceDate: raceDateIn(3) }),
    );

    assert.match(text, /A plan cannot be generated/);
    assert.match(text, /at least 6 weeks/);
    assert.match(text, /Do not construct a plan yourself/);
  });

  test('surfaces warnings and instructs the model to repeat them', async () => {
    const text = textOf(
      await generatePlan(context(ATHLETE_IDS.consistent), {
        distance: 'Marathon',
        raceDate: raceDateIn(12),
        peakWeeklyKm: 160,
      }),
    );

    assert.match(text, /Warnings the athlete needs to hear/);
    assert.match(text, /Capped at/);
    assert.match(text, /Repeat the warnings above/);
  });

  test('refuses for an athlete with no usable history', async () => {
    const text = textOf(
      await generatePlan(context(ATHLETE_IDS.empty), { distance: 'Half Marathon', raceDate: raceDateIn(12) }),
    );
    assert.match(text, /No activities are stored|cannot be generated/);
  });
});

describe('analyze_training_status', () => {
  test('gives a headline, a narrative, observations and recommendations', async () => {
    const text = textOf(await analyzeStatus(context(ATHLETE_IDS.consistent), {}));

    assert.match(text, /What the data shows/);
    assert.match(text, /What to do about it/);
    assert.match(text, /Key numbers/);
    assert.match(text, /Fitness \(CTL\)/);
  });

  test('flags overreaching for a spiking athlete', async () => {
    const text = textOf(await analyzeStatus(context(ATHLETE_IDS.spiking), {}));
    assert.match(text, /acute-to-chronic/);
    assert.match(text, /back off|Cut the next/i);
  });

  test('carries data-quality caveats and tells the model to keep them', async () => {
    const text = textOf(await analyzeStatus(context(ATHLETE_IDS.noHeartRate), {}));

    assert.match(text, /What limits this assessment/);
    assert.match(text, /heart-rate/);
    assert.match(text, /Carry the limitations above into your answer/);
  });

  test('reports unavailable heart-rate zones rather than inventing them', async () => {
    const text = textOf(await analyzeStatus(context(ATHLETE_IDS.noHeartRate), {}));
    assert.match(text, /Heart-rate zones: unavailable/);
  });

  test('does not claim a trend for a one-activity athlete', async () => {
    const text = textOf(await analyzeStatus(context(ATHLETE_IDS.oneActivity), {}));
    assert.match(text, /Confidence: low/);
    assert.match(text, /What limits this assessment/);
  });
});

describe('athlete scoping', () => {
  test('every tool reads only the athlete in its context', async () => {
    const shared = repository();
    const consistent = textOf(await analyzeStatus(context(ATHLETE_IDS.consistent, shared), {}));
    const empty = textOf(await analyzeStatus(context(ATHLETE_IDS.empty, shared), {}));

    // Two contexts over one repository must not bleed into each other.
    assert.notEqual(consistent, empty);
    assert.match(empty, /No activities are stored/);
  });

  test('no tool accepts an athlete id as an argument', async () => {
    // Guarding against a future change that adds one: a model that can name an
    // athlete can be talked into naming someone else's.
    const tools = [getTrainingLoad, predictRace, getRecentActivities, generatePlan, analyzeStatus];
    for (const tool of tools) {
      const source = tool.toString();
      assert.ok(
        !/args\.athleteId|args\.athlete_id/.test(source),
        `${tool.name} appears to read an athlete id from its arguments`,
      );
    }
  });
});
