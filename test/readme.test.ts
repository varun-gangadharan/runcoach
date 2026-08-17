/**
 * The README's example conversation, pinned.
 *
 * A README quoting example tool output is a liability: it is written once,
 * believed forever, and silently becomes fiction the first time a constant
 * changes. For a project whose entire argument is that its numbers are traceable,
 * shipping invented example figures would be self-defeating.
 *
 * These assertions are the exact values quoted in README.md. If a change to the
 * science moves them, this fails and the README gets updated in the same commit.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { analyzeStatus, predictRace } from '../src/tools/definitions.ts';
import { ATHLETE_IDS, context, textOf } from './fixtures.ts';

describe('README example conversation', () => {
  test('the training-status figures quoted in the README are what the code produces', async () => {
    const text = textOf(await analyzeStatus(context(ATHLETE_IDS.gpsGlitch), {}));

    assert.match(text, /# Training is consistent and load is steady/);
    assert.match(text, /46\.8 km\/week/);
    assert.match(text, /17 runs across 16 days/);
    assert.match(text, /acute-to-chronic ratio of 1\.00/);
    assert.match(text, /Longest gap: 3 days/);
  });

  test('the half-marathon prediction quoted in the README is what the code produces', async () => {
    const text = textOf(await predictRace(context(ATHLETE_IDS.gpsGlitch), { distance: 'Half Marathon' }));

    assert.match(text, /# Half Marathon prediction: 1:38:49/);
    assert.match(text, /Plausible range: 1:36:50 to 1:40:48/);
    assert.match(text, /Fatigue exponent used: 1\.059/);

    // The three reference efforts, with the dates and times the README names.
    assert.match(text, /"5K race" on 2026-07-08 — 5\.0 km in 21:30/);
    assert.match(text, /"10K race" on 2026-06-03 — 10\.0 km in 44:50/);
    assert.match(text, /"Half marathon" on 2026-04-29 — 21\.1 km in 1:38:48/);

    // And the exclusion the README mentions.
    assert.match(text, /"Tunnel GPS glitch" on 2026-07-28 — recorded pace is faster than the world record/);
  });
});
