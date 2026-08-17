/**
 * Formatting tool output for a language model.
 *
 * Two rules shape everything here.
 *
 * First, provenance travels with the number. `@runman/core` returns a method,
 * a confidence and an explanation for every calculation; if a tool drops those,
 * the model has no way to know a marathon prediction rests on one 5 km time
 * trial, and will state it as flatly as one backed by four races. The
 * explanation is the difference between grounding and laundering.
 *
 * Second, prose beats JSON for the parts a model will paraphrase. A model reads
 * "fitness 62, up 8% over six weeks" more reliably than it reads a nested
 * object, and is far less likely to invent a field that was not there. Precise
 * figures still appear, but inside sentences rather than as a payload to parse.
 */

import { formatDuration, formatPace, type Confidence } from '@runman/core';

export function km(meters: number, places = 1): string {
  return `${(meters / 1000).toFixed(places)} km`;
}

export function pace(secondsPerKm: number): string {
  return `${formatPace(secondsPerKm)}/km`;
}

export function duration(seconds: number): string {
  return formatDuration(seconds);
}

export function date(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * A confidence line the model should reproduce rather than discard. Written as
 * an instruction because models otherwise tend to drop hedges when summarising.
 */
export function confidenceLine(confidence: Confidence, explanation: string): string {
  const guidance: Record<Confidence, string> = {
    high: 'This figure is well supported by the available data.',
    medium: 'This figure is reasonable but rests on limited data — say so when reporting it.',
    low: 'This figure is a rough estimate. State that clearly to the athlete rather than presenting it as a measurement.',
    none: 'There is not enough data to support a figure at all. Say that plainly instead of estimating.',
  };
  return `Confidence: ${confidence}. ${guidance[confidence]}\nHow it was calculated: ${explanation}`;
}

export function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

export function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

/** Join non-empty blocks with blank lines between them. */
export function compose(...blocks: Array<string | null | undefined | false>): string {
  return blocks.filter((block): block is string => Boolean(block && block.trim())).join('\n\n');
}
