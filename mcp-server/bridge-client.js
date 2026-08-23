import crypto from 'node:crypto';
import net from 'node:net';
import { bridgeSocketPath } from '../native-host/paths.js';

export async function requestExtension(action, params = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 90_000;
  const socketPath = options.socketPath || bridgeSocketPath();
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setEncoding('utf8');
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`ProjectionLab bridge timed out while running ${action}.`));
    }, timeoutMs);

    const finish = (callback) => {
      clearTimeout(timer);
      socket.end();
      callback();
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, action, params })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      let response;
      try {
        response = JSON.parse(buffer.slice(0, newline));
      } catch (error) {
        finish(() => reject(new Error(`Invalid response from ProjectionLab bridge: ${error.message}`)));
        return;
      }
      if (response.id !== id) {
        finish(() => reject(new Error('ProjectionLab bridge returned a mismatched request id.')));
        return;
      }
      if (!response.ok) {
        finish(() => reject(new Error(response.error || 'ProjectionLab bridge request failed.')));
        return;
      }
      finish(() => resolve(response.result));
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        reject(
          new Error(
            'ProjectionLab browser bridge is offline. Open Chrome, enable the unpacked extension, and keep the ProjectionLab and Monarch tabs signed in.',
          ),
        );
        return;
      }
      reject(error);
    });
  });
}
