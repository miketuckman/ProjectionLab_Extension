const MAX_NATIVE_MESSAGE_BYTES = 64 * 1024 * 1024;

export function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.length > MAX_NATIVE_MESSAGE_BYTES) {
    throw new Error('Native message exceeds the 64 MiB safety limit.');
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class NativeMessageDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length > MAX_NATIVE_MESSAGE_BYTES) {
        throw new Error('Native message length exceeds the 64 MiB safety limit.');
      }
      if (this.#buffer.length < length + 4) break;
      const payload = this.#buffer.subarray(4, length + 4).toString('utf8');
      this.#buffer = this.#buffer.subarray(length + 4);
      messages.push(JSON.parse(payload));
    }
    return messages;
  }
}
