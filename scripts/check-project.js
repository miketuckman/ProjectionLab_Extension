#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

for (const file of (await walk(root)).filter((candidate) => candidate.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
for (const forbidden of ['activeTab', 'cookies', 'alarms']) {
  if (manifest.permissions.includes(forbidden)) {
    throw new Error(`Forbidden extension permission remains: ${forbidden}`);
  }
}
if (!manifest.permissions.includes('nativeMessaging')) {
  throw new Error('nativeMessaging permission is required for the local MCP bridge.');
}
const serviceWorker = await fs.readFile(
  path.join(root, 'background', 'service-worker.js'),
  'utf8',
);
if (/force\s*:\s*true/.test(serviceWorker)) {
  throw new Error('ProjectionLab forced-write bypass is forbidden.');
}
if (/updateViaHttp|buildPLUpdateHttpUrl/.test(serviceWorker)) {
  throw new Error('Direct ProjectionLab HTTP write fallback is forbidden.');
}
console.log('JavaScript syntax and manifests are valid.');
