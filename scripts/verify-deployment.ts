/**
 * Phase 4 verification: drive the *deployed* server with a real MCP client.
 *
 * Everything else in this repo tests the server in-process. That proves the
 * tools work; it says nothing about whether the streamable-HTTP transport,
 * the serverless entry point, the bearer-token auth and the live database
 * actually compose. This connects over the network, exactly as Claude would.
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-deployment.ts <url> <apiKey>
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.argv[2];
const apiKey = process.argv[3];

if (!url || !apiKey) {
  console.error('Usage: verify-deployment.ts <url> <apiKey>');
  process.exit(1);
}

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? '').join('\n');
}

async function main(): Promise<void> {
  console.log(`\n=== Connecting to ${url} as a real MCP client ===\n`);

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
  const client = new Client({ name: 'runcoach-deployment-check', version: '1.0.0' });
  await client.connect(transport);
  check('handshake completed', true);

  const { tools } = await client.listTools();
  check('all five tools advertised', tools.length === 5, `${tools.map((t) => t.name).join(', ')}`);

  console.log('\n--- analyze_training_status ---\n');
  const status = textOf(await client.callTool({ name: 'analyze_training_status', arguments: {} }));
  console.log(status.split('\n').slice(0, 8).join('\n'));
  check('status came back grounded', /Fitness \(CTL\)/.test(status));
  check('status carries a confidence', /Confidence: (high|medium|low)/.test(status));

  console.log('\n--- predict_race_time (Half Marathon) ---\n');
  const prediction = textOf(
    await client.callTool({ name: 'predict_race_time', arguments: { distance: 'Half Marathon' } }),
  );
  console.log(prediction.split('\n').slice(0, 14).join('\n'));
  check('prediction returned a time', /prediction: \d+:\d+/.test(prediction));
  check('prediction names its sources', /Derived from these activities/.test(prediction));
  check(
    'the GPS glitch was excluded and reported',
    /Excluded from consideration/.test(prediction) && /world record/.test(prediction),
  );

  console.log('\n--- get_training_load ---\n');
  const load = textOf(await client.callTool({ name: 'get_training_load', arguments: { windowDays: 42 } }));
  console.log(load.split('\n').slice(0, 8).join('\n'));
  check('load reports the acute:chronic ratio', /Acute:chronic workload ratio/.test(load));

  console.log('\n--- get_recent_activities ---\n');
  const recent = textOf(await client.callTool({ name: 'get_recent_activities', arguments: { days: 28 } }));
  console.log(recent.split('\n').slice(0, 6).join('\n'));
  check('recent activities returned', /runs in the last 28 days/.test(recent));

  console.log('\n--- generate_training_plan ---\n');
  const raceDate = new Date(Date.now() + 16 * 7 * 86400000).toISOString().slice(0, 10);
  const plan = textOf(
    await client.callTool({
      name: 'generate_training_plan',
      arguments: { distance: 'Marathon', raceDate, daysPerWeek: 4 },
    }),
  );
  console.log(plan.split('\n').slice(0, 10).join('\n'));
  check('plan generated', /week plan to Marathon/.test(plan));
  check('plan anchored to measured volume', /measured over the last 28 calendar days/.test(plan));

  await client.close();

  console.log('');
  if (failures > 0) {
    console.error(`FAILED: ${failures} check(s) did not pass.`);
    process.exit(1);
  }
  console.log('All deployment checks passed against the live server.');
}

main().catch((error: unknown) => {
  console.error('\nDeployment verification failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
