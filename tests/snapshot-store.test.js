import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SnapshotStore } from '../mcp-server/snapshot-store.js';
import { hashProjectionLabExport } from '../shared/balance-sync.js';

test('stores raw snapshots, preview metadata, and receipts outside the repository', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'projectionlab-snapshots-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SnapshotStore(root);
  const data = { today: { savingsAccounts: [{ id: 'cash', balance: 100 }] } };
  const hash = await hashProjectionLabExport(data);
  const snapshot = await store.saveSnapshot({
    data,
    expectedHash: hash,
    reason: 'test',
    previewId: 'preview-test',
  });
  assert.deepEqual(JSON.parse(await fs.readFile(snapshot.dataPath, 'utf8')), data);
  const mode = (await fs.stat(snapshot.dataPath)).mode & 0o777;
  assert.equal(mode, 0o600);

  await store.recordPreview({
    previewId: 'preview-test',
    snapshotId: snapshot.id,
    snapshotHash: snapshot.hash,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal((await store.loadPreview('preview-test')).snapshotId, snapshot.id);
  assert.equal((await store.assertSnapshot(snapshot.id, snapshot.hash)).id, snapshot.id);
  await assert.rejects(
    store.assertSnapshot(snapshot.id, '0'.repeat(64)),
    /integrity verification/,
  );
  const receipt = await store.saveReceipt({ success: true });
  assert.equal(JSON.parse(await fs.readFile(receipt.filePath, 'utf8')).success, true);
});
