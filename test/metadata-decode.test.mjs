import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDisassembler } from '../dist/index.js';

const decoder = await createDisassembler();
const compact = ({ text, mnemonic, operands, opcodeName, ...metadata }) => metadata;
function words(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

test('metadata matches full LLVM decoding for flow, features, invalid and soft-fail words', () => {
  // Encodings and upstream references are shared with decode.test.mjs.
  const bytes = words([0xd503201f, 0x91000420, 0xd65f03c0, 0x14000002, 0x97ffffff,
    0x54000040, 0xb4000040, 0x36000040, 0xd61f0000, 0xd63f0000, 0x10000000,
    0x1e622820, 0x4e228420, 0x88a07c41, 0x9adf1020, 0xc0080000, 0x04a00000,
    0xffffffff, 0xa9400020]);
  for (const address of [0n, 0x123456789000n, 0xfffffffffffffffcn]) {
    assert.deepEqual(decoder.decodeMetadata(bytes, { address }),
      decoder.decode(bytes, { address }).map(compact));
  }
});

test('metadata preserves empty input, subviews and truncated tails', () => {
  assert.deepEqual(decoder.decodeMetadata(new Uint8Array()), []);
  const bytes = words([0xd503201f, 0xd65f03c0, 0xffffffff]);
  for (let tail = 0; tail < 4; tail++) {
    const slice = bytes.subarray(4, 8 + tail);
    assert.deepEqual(decoder.decodeMetadata(slice), decoder.decode(slice).map(compact));
  }
});

test('metadata rejects invalid input and addresses like decode', () => {
  for (const bytes of [null, [], new Int8Array(4), new DataView(new ArrayBuffer(4))]) {
    assert.throws(() => decoder.decodeMetadata(bytes), TypeError);
  }
  for (const address of [-1n, 0x10000000000000000n, 1, NaN, null]) {
    assert.throws(() => decoder.decodeMetadata(new Uint8Array(), { address }), RangeError);
  }
});

test('metadata agrees with full decoding on a deterministic random corpus', () => {
  let state = 42;
  const bytes = words(Array.from({ length: 20000 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  }));
  assert.deepEqual(decoder.decodeMetadata(bytes), decoder.decode(bytes).map(compact));
});
