import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('starts over stdio and advertises the expected read/write tools', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('mcp-server/index.js')],
    cwd: path.resolve('.'),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'projectionlab-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const result = await client.listTools();
  const tools = new Map(result.tools.map((tool) => [tool.name, tool]));
  assert.deepEqual([...tools.keys()].sort(), [
    'pl_apply_balance_sync',
    'pl_create_snapshot',
    'pl_list_accounts',
    'pl_preview_balance_sync',
    'pl_status',
  ]);
  assert.equal(tools.get('pl_status').annotations.readOnlyHint, true);
  assert.equal(tools.get('pl_apply_balance_sync').annotations.destructiveHint, true);
  assert.match(client.getInstructions(), /Always call pl_preview_balance_sync/);
});
