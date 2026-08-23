#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { requestExtension } from './bridge-client.js';
import { SnapshotStore } from './snapshot-store.js';

const store = new SnapshotStore();
const server = new McpServer(
  { name: 'projectionlab-local', version: '0.1.0' },
  {
    instructions:
      'ProjectionLab access is local and snapshot-backed. Use read tools freely. Always call pl_preview_balance_sync before pl_apply_balance_sync, inspect every proposed change, and obtain explicit user approval. Never invent preview IDs, snapshot IDs, balances, account mappings, or confirmation text.',
  },
);

function success(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function failure(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error.message || String(error) }],
  };
}

function registerTool(name, definition, handler) {
  server.registerTool(name, definition, async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      return failure(error);
    }
  });
}

registerTool(
  'pl_status',
  {
    title: 'ProjectionLab bridge status',
    description:
      'Check whether the Chrome bridge, ProjectionLab tab, Monarch tab, API key, and account mappings are ready.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => success(await requestExtension('status')),
);

registerTool(
  'pl_list_accounts',
  {
    title: 'List ProjectionLab accounts',
    description:
      'Return focused ProjectionLab account identifiers, names, categories, types, and current balance fields without returning the complete export.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => success(await requestExtension('list_accounts')),
);

registerTool(
  'pl_create_snapshot',
  {
    title: 'Create ProjectionLab snapshot',
    description:
      'Export the complete ProjectionLab state to the private local snapshot store and return only its handle, hash, path, and summary.',
    inputSchema: {
      reason: z.string().trim().min(1).max(200).default('manual MCP snapshot'),
    },
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ reason }) => {
    const exported = await requestExtension('create_snapshot');
    const snapshot = await store.saveSnapshot({
      data: exported.data,
      expectedHash: exported.hash,
      reason,
    });
    return success({ snapshot, summary: exported.summary });
  },
);

registerTool(
  'pl_preview_balance_sync',
  {
    title: 'Preview Monarch to ProjectionLab balance sync',
    description:
      'Read mapped Monarch balances, compare them with ProjectionLab, create a complete rollback snapshot, and return a non-writing per-field preview.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  },
  async () => {
    const preview = await requestExtension('preview_balance_sync');
    if (!/^[a-f0-9]{64}$/.test(preview.stateHash || '')) {
      throw new Error('ProjectionLab returned an invalid current-finances state hash.');
    }
    const snapshot = await store.saveSnapshot({
      data: preview.snapshot.data,
      expectedHash: preview.snapshot.hash,
      reason: `balance sync preview ${preview.previewId}`,
      previewId: preview.previewId,
    });
    await store.recordPreview({
      previewId: preview.previewId,
      snapshotId: snapshot.id,
      snapshotHash: snapshot.hash,
      stateHash: preview.stateHash,
      expiresAt: preview.expiresAt,
      createdAt: preview.createdAt,
    });
    return success({
      previewId: preview.previewId,
      createdAt: preview.createdAt,
      expiresAt: preview.expiresAt,
      snapshot,
      summary: preview.summary,
      changes: preview.changes,
    });
  },
);

registerTool(
  'pl_apply_balance_sync',
  {
    title: 'Apply an approved Monarch to ProjectionLab balance sync',
    description:
      'Apply a previously reviewed preview only when its rollback snapshot exists, it has not expired, ProjectionLab state is unchanged, and the exact confirmation phrase is supplied.',
    inputSchema: {
      previewId: z.string().uuid(),
      snapshotId: z.string().min(1),
      confirmation: z.literal('APPLY BALANCE SYNC'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ previewId, snapshotId, confirmation }) => {
    const preview = await store.loadPreview(previewId);
    if (preview.snapshotId !== snapshotId) {
      throw new Error('Snapshot ID does not belong to this balance-sync preview.');
    }
    if (Date.now() > Date.parse(preview.expiresAt)) {
      throw new Error('The balance-sync preview has expired. Create and review a new preview.');
    }
    if (!/^[a-f0-9]{64}$/.test(preview.stateHash || '')) {
      throw new Error('The balance-sync preview has no valid ProjectionLab state hash.');
    }
    await store.assertSnapshot(preview.snapshotId, preview.snapshotHash);
    const receipt = await requestExtension('apply_balance_sync', {
      previewId,
      expectedStateHash: preview.stateHash,
      confirmation,
    });
    const savedReceipt = await store.saveReceipt({
      ...receipt,
      previewId,
      snapshotId,
      snapshotHash: preview.snapshotHash,
    });
    return success({ ...receipt, receipt: savedReceipt });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
