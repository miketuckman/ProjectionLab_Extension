#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, 'manifest.json'), 'utf8'));
if (!manifest.key) throw new Error('manifest.json must contain a deterministic public key.');

const digest = crypto
  .createHash('sha256')
  .update(Buffer.from(manifest.key, 'base64'))
  .digest()
  .subarray(0, 16);
const extensionId = [...digest]
  .map((byte) => {
    const high = String.fromCharCode('a'.charCodeAt(0) + (byte >> 4));
    const low = String.fromCharCode('a'.charCodeAt(0) + (byte & 15));
    return high + low;
  })
  .join('');

const hostName = 'com.miketuckman.projectionlab_bridge';
const hostDirectory = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome',
  'NativeMessagingHosts',
);
const hostManifestPath = path.join(hostDirectory, `${hostName}.json`);
const executablePath = path.join(projectDirectory, 'native-host', 'host.js');
const stateDirectory = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'ProjectionLab MCP',
);
const launcherPath = path.join(stateDirectory, 'native-host-launcher.sh');
const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
await fs.mkdir(hostDirectory, { recursive: true, mode: 0o700 });
await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
await fs.chmod(executablePath, 0o755);
await fs.writeFile(
  launcherPath,
  `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(executablePath)}\n`,
  { mode: 0o700 },
);
await fs.chmod(launcherPath, 0o700);
await fs.writeFile(
  hostManifestPath,
  `${JSON.stringify(
    {
      name: hostName,
      description: 'Local ProjectionLab MCP browser bridge',
      path: launcherPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
await fs.chmod(hostManifestPath, 0o600);

console.log(`Installed native host: ${hostManifestPath}`);
console.log(`Installed native host launcher: ${launcherPath}`);
console.log(`Expected unpacked extension ID: ${extensionId}`);
