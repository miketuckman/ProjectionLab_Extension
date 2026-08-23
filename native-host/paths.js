import os from 'node:os';
import path from 'node:path';

export function stateDirectory() {
  return (
    process.env.PROJECTIONLAB_MCP_DATA_DIR ||
    path.join(os.homedir(), 'Library', 'Application Support', 'ProjectionLab MCP')
  );
}

export function bridgeSocketPath() {
  return (
    process.env.PROJECTIONLAB_BRIDGE_SOCKET ||
    path.join(stateDirectory(), 'bridge.sock')
  );
}
