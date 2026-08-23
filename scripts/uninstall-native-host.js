#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const hostManifestPath = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome',
  'NativeMessagingHosts',
  'com.miketuckman.projectionlab_bridge.json',
);
const launcherPath = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'ProjectionLab MCP',
  'native-host-launcher.sh',
);

for (const [label, filePath] of [
  ['native host manifest', hostManifestPath],
  ['native host launcher', launcherPath],
]) {
  try {
    await fs.unlink(filePath);
    console.log(`Removed ${label}: ${filePath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log(`${label} was not installed.`);
  }
}
