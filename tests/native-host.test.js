import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { requestExtension } from '../mcp-server/bridge-client.js';
import { encodeNativeMessage, NativeMessageDecoder } from '../native-host/native-framing.js';

async function waitForPath(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

test('forwards Unix-socket requests through Chrome native-message framing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'projectionlab-native-host-'));
  const socketPath = path.join(root, 'bridge.sock');
  const child = spawn(process.execPath, ['native-host/host.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PROJECTIONLAB_MCP_DATA_DIR: root,
      PROJECTIONLAB_BRIDGE_SOCKET: socketPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await fs.rm(root, { recursive: true, force: true });
  });
  await waitForPath(socketPath);

  const decoder = new NativeMessageDecoder();
  child.stdout.on('data', (chunk) => {
    for (const message of decoder.push(chunk)) {
      child.stdin.write(
        encodeNativeMessage({
          type: 'response',
          id: message.id,
          ok: true,
          result: { action: message.action, ready: true },
        }),
      );
    }
  });

  assert.deepEqual(
    await Promise.all(
      ['status', 'list_accounts', 'create_snapshot'].map((action) =>
        requestExtension(action, {}, { socketPath, timeoutMs: 2_000 }),
      ),
    ),
    [
      { action: 'status', ready: true },
      { action: 'list_accounts', ready: true },
      { action: 'create_snapshot', ready: true },
    ],
  );
});
