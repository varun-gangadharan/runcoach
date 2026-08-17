/**
 * End-to-end protocol test.
 *
 * The tool tests call the handlers directly, which proves the logic but not that
 * a real MCP client can discover and invoke them. This connects an actual SDK
 * client to an actual server over an in-memory transport pair and drives it
 * through the wire protocol — schema validation, tool listing, argument
 * coercion, the lot.
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createServer } from '../src/server.ts';
import { ATHLETE_IDS, context } from './fixtures.ts';

let client: Client;
let server: McpServer;

before(async () => {
  server = createServer(context(ATHLETE_IDS.consistent));
  client = new Client({ name: 'runcoach-test-client', version: '1.0.0' });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

after(async () => {
  await client.close();
  await server.close();
});

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((part) => part.text ?? '').join('\n');
}

describe('MCP protocol', () => {
  test('advertises all five tools with descriptions and schemas', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      'analyze_training_status',
      'generate_training_plan',
      'get_recent_activities',
      'get_training_load',
      'predict_race_time',
    ]);

    for (const tool of tools) {
      // A model picks a tool from its description, so an empty or terse one is a
      // functional defect, not a documentation gap.
      assert.ok((tool.description ?? '').length > 80, `${tool.name} needs a substantive description`);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });

  test('server instructions tell the client how to treat the results', async () => {
    const instructions = client.getInstructions() ?? '';
    assert.match(instructions, /confidence/i);
    assert.match(instructions, /Do not substitute an estimate/i);
  });

  test('calls a tool over the wire and gets grounded output', async () => {
    const result = await client.callTool({
      name: 'predict_race_time',
      arguments: { distance: 'Half Marathon', goal: 'pr' },
    });

    const text = textOf(result);
    assert.match(text, /Half Marathon prediction: \d+:\d+/);
    assert.match(text, /Derived from these activities/);
    assert.match(text, /Confidence:/);
  });

  test('applies schema defaults when optional arguments are omitted', async () => {
    const result = await client.callTool({ name: 'get_training_load', arguments: {} });
    assert.match(textOf(result), /last 42 days/);
  });

  test('rejects an argument outside the declared schema, and says what was allowed', async () => {
    const result = await client.callTool({
      name: 'predict_race_time',
      arguments: { distance: 'Ultramarathon' },
    });

    // The SDK validates against the declared schema and returns an error result
    // rather than throwing, which is what a model needs: it can read the message
    // and retry with a valid value instead of the call simply failing.
    assert.equal(result.isError, true);
    const text = textOf(result);
    assert.match(text, /Invalid enum value/);
    assert.match(text, /Marathon/, 'the error must list the accepted values so the model can correct itself');
  });

  test('a tool that cannot answer returns a message, not a protocol error', async () => {
    const emptyServer = createServer(context(ATHLETE_IDS.empty));
    const emptyClient = new Client({ name: 'runcoach-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([emptyServer.connect(serverTransport), emptyClient.connect(clientTransport)]);

    const result = await emptyClient.callTool({ name: 'analyze_training_status', arguments: {} });
    assert.match(textOf(result), /No activities are stored/);

    await emptyClient.close();
    await emptyServer.close();
  });
});
