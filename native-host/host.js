#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { bridgeSocketPath, stateDirectory } from './paths.js';
import { encodeNativeMessage, NativeMessageDecoder } from './native-framing.js';

const REQUEST_TIMEOUT_MS = 90_000;
const MAX_CLIENT_REQUEST_BYTES = 1024 * 1024;
const socketPath = bridgeSocketPath();
const pending = new Map();
const decoder = new NativeMessageDecoder();

function log(message) {
  process.stderr.write(`[projectionlab-native-host] ${message}\n`);
}

function sendNative(message) {
  process.stdout.write(encodeNativeMessage(message));
}

function replyToClient(socket, payload) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(payload)}\n`);
}

function handleNativeMessage(message) {
  if (message?.type !== 'response' || typeof message.id !== 'string') return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  replyToClient(request.socket, {
    id: request.clientRequestId,
    ok: message.ok === true,
    result: message.result,
    error: message.error,
  });
}

process.stdin.on('data', (chunk) => {
  try {
    for (const message of decoder.push(chunk)) handleNativeMessage(message);
  } catch (error) {
    log(`Invalid native message: ${error.message}`);
    process.exitCode = 1;
  }
});

process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', (error) => {
  log(`Native input failed: ${error.message}`);
  process.exit(1);
});

function handleClientLine(socket, line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    replyToClient(socket, { ok: false, error: 'Invalid JSON request.' });
    return;
  }
  if (typeof request.id !== 'string' || typeof request.action !== 'string') {
    replyToClient(socket, {
      id: request.id,
      ok: false,
      error: 'Requests require string id and action fields.',
    });
    return;
  }

  const nativeId = crypto.randomUUID();
  const timer = setTimeout(() => {
    const timedOut = pending.get(nativeId);
    if (!timedOut) return;
    pending.delete(nativeId);
    replyToClient(timedOut.socket, {
      id: timedOut.clientRequestId,
      ok: false,
      error: 'The Chrome extension did not respond before the bridge timeout.',
    });
  }, REQUEST_TIMEOUT_MS);
  timer.unref();
  pending.set(nativeId, {
    socket,
    clientRequestId: request.id,
    timer,
  });
  sendNative({
    type: 'request',
    id: nativeId,
    action: request.action,
    params: request.params || {},
  });
}

function createClientHandler(socket) {
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > MAX_CLIENT_REQUEST_BYTES) {
      replyToClient(socket, { ok: false, error: 'Bridge request exceeds the 1 MiB safety limit.' });
      socket.destroy();
      return;
    }
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) handleClientLine(socket, line);
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    for (const [id, request] of pending) {
      if (request.socket !== socket) continue;
      clearTimeout(request.timer);
      pending.delete(id);
    }
  });
}

fs.mkdirSync(stateDirectory(), { recursive: true, mode: 0o700 });
fs.chmodSync(stateDirectory(), 0o700);
try {
  const stat = fs.lstatSync(socketPath);
  if (!stat.isSocket()) {
    throw new Error(`Refusing to replace non-socket path: ${socketPath}`);
  }
  fs.unlinkSync(socketPath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const server = net.createServer(createClientHandler);
server.on('error', (error) => {
  log(`Socket server failed: ${error.message}`);
  process.exit(1);
});
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600);
  log(`Listening on ${socketPath}`);
});

function cleanup() {
  server.close();
  try {
    const stat = fs.lstatSync(socketPath);
    if (stat.isSocket()) fs.unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== 'ENOENT') log(`Socket cleanup failed: ${error.message}`);
  }
}

process.on('exit', cleanup);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
