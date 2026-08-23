import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeNativeMessage, NativeMessageDecoder } from '../native-host/native-framing.js';

test('decodes fragmented and combined native messages', () => {
  const first = encodeNativeMessage({ id: 'one', ok: true });
  const second = encodeNativeMessage({ id: 'two', value: 42 });
  const combined = Buffer.concat([first, second]);
  const decoder = new NativeMessageDecoder();
  assert.deepEqual(decoder.push(combined.subarray(0, 7)), []);
  assert.deepEqual(decoder.push(combined.subarray(7)), [
    { id: 'one', ok: true },
    { id: 'two', value: 42 },
  ]);
});
