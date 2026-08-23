import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stateDirectory } from '../native-host/paths.js';
import { hashProjectionLabExport } from '../shared/balance-sync.js';

function safeTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(':', '').replaceAll('.', '-');
}

export class SnapshotStore {
  constructor(rootDirectory = stateDirectory()) {
    this.rootDirectory = rootDirectory;
    this.snapshotsDirectory = path.join(rootDirectory, 'snapshots');
    this.operationsDirectory = path.join(rootDirectory, 'operations');
    this.receiptsDirectory = path.join(rootDirectory, 'receipts');
  }

  async initialize() {
    await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const directories = [
      this.rootDirectory,
      this.snapshotsDirectory,
      this.operationsDirectory,
      this.receiptsDirectory,
    ];
    await Promise.all(
      directories.map(async (directory) => {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        await fs.chmod(directory, 0o700);
      }),
    );
  }

  async saveSnapshot({ data, expectedHash, reason, previewId = null }) {
    await this.initialize();
    const hash = await hashProjectionLabExport(data);
    if (expectedHash && expectedHash !== hash) {
      throw new Error('Snapshot hash did not match the browser export.');
    }
    const id = `${safeTimestamp()}-${hash.slice(0, 12)}-${crypto.randomUUID().slice(0, 8)}`;
    const dataPath = path.join(this.snapshotsDirectory, `${id}.json`);
    const metadataPath = path.join(this.snapshotsDirectory, `${id}.meta.json`);
    const createdAt = new Date().toISOString();
    await fs.writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    const metadata = { id, hash, createdAt, reason, previewId, dataPath };
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    return metadata;
  }

  async recordPreview(record) {
    await this.initialize();
    const filePath = path.join(this.operationsDirectory, `${record.previewId}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    return filePath;
  }

  async loadPreview(previewId) {
    const filePath = path.join(this.operationsDirectory, `${previewId}.json`);
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Unknown balance-sync preview: ${previewId}`);
      }
      throw error;
    }
  }

  async assertSnapshot(snapshotId, expectedHash) {
    if (!/^[A-Za-z0-9._-]+$/.test(snapshotId)) {
      throw new Error('Invalid snapshot ID.');
    }
    const metadataPath = path.join(this.snapshotsDirectory, `${snapshotId}.meta.json`);
    const dataPath = path.join(this.snapshotsDirectory, `${snapshotId}.json`);
    let metadata;
    let data;
    try {
      [metadata, data] = await Promise.all([
        fs.readFile(metadataPath, 'utf8').then(JSON.parse),
        fs.readFile(dataPath, 'utf8').then(JSON.parse),
      ]);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Rollback snapshot is missing: ${snapshotId}`);
      }
      throw error;
    }
    const actualHash = await hashProjectionLabExport(data);
    if (
      metadata.id !== snapshotId ||
      metadata.hash !== expectedHash ||
      actualHash !== expectedHash
    ) {
      throw new Error(`Rollback snapshot failed integrity verification: ${snapshotId}`);
    }
    return metadata;
  }

  async saveReceipt(receipt) {
    await this.initialize();
    const id = receipt.receiptId || crypto.randomUUID();
    const filePath = path.join(this.receiptsDirectory, `${id}.json`);
    await fs.writeFile(filePath, `${JSON.stringify({ ...receipt, receiptId: id }, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    return { id, filePath };
  }
}
