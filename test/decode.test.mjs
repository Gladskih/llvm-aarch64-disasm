import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createDisassembler, featureDefinitions, llvmVersion } from '../dist/index.js';

const wasmBinary = await readFile(new URL('../dist/llvm-aarch64.wasm', import.meta.url));
const decoder = await createDisassembler({ wasmBinary });
function word(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}
const decode = (value, address = 0n) => decoder.decode(word(value), { address })[0];
function leaves(expression) {
  if (typeof expression === 'boolean') return [];
  if ('feature' in expression) return [expression.feature];
  if ('not' in expression) return leaves(expression.not);
  return (expression.all_of ?? expression.any_of).flatMap(leaves);
}

test('base instructions, aliases, MC operands, and version identity', () => {
  assert.equal(llvmVersion, '21.1.8');
  for (const [word, mnemonic] of [[0xd503201f, 'nop'], [0x91000420, 'add'], [0xd65f03c0, 'ret']]) {
    const result = decode(word);
    assert.equal(result.status, 'success');
    assert.equal(result.length, 4);
    assert.equal(result.mnemonic, mnemonic);
    assert.equal(result.features.known, true);
    assert.equal(typeof result.opcode, 'number');
    assert(result.opcodeName.length > 0);
  }
  const add = decode(0x91000420);
  assert.equal(add.text, 'add x0, x1, #1');
  assert.equal(add.operands[0].kind, 'register');
  assert(add.operands.some(o => o.kind === 'immediate' && o.value === 1n));
  assert.deepEqual(add.features.predicates, []);
});

test('control flow and full-width relative targets', () => {
  const address = 0x123456789000n;
  for (const [word, kind, delta] of [
    [0x14000002, 'unconditional-branch', 8n],
    [0x97ffffff, 'call', -4n],
    [0x54000040, 'conditional-branch', 8n],
    [0xb4000040, 'conditional-branch', 8n],
    [0x36000040, 'conditional-branch', 8n],
  ]) {
    const result = decode(word, address);
    assert.equal(result.controlFlow, kind);
    assert.equal(result.target, address + delta);
  }
  assert.equal(decode(0x17ffffff, 0n).target, 0xfffffffffffffffcn);
  assert.equal(decode(0xd61f0000).controlFlow, 'indirect-branch');
  assert.equal(decode(0xd63f0000).controlFlow, 'call');
  assert.equal(decode(0xd63f0000).target, undefined);
  assert.equal(decode(0xd65f03c0).controlFlow, 'return');
  assert.equal(decode(0x10000000).target, undefined); // ADR is not a branch.
});

test('FP/SIMD and modern extensions use generated LLVM feature gates', () => {
  // Extension encodings from the pinned upstream llvm/test/MC/AArch64 fixtures.
  for (const [word, mnemonic, feature] of [
    [0x1e622820, 'fadd', 'FeatureFPARMv8'],
    [0x4e228420, 'add', 'FeatureNEON'],
    [0x88a07c41, 'cas', 'FeatureLSE'],
    [0x9adf1020, 'irg', 'FeatureMTE'],
    [0xc0080000, 'zero', 'FeatureSME'],
    [0x4e284820, 'aese', 'FeatureAES'],
    [0x4e829420, 'sdot', 'FeatureDotProd'],
  ]) {
    const result = decode(word);
    assert.equal(result.status, 'success', mnemonic);
    assert.equal(result.mnemonic, mnemonic);
    assert.equal(result.features.known, true);
    assert(result.features.predicates.flatMap(p => leaves(p.expression)).includes(feature), JSON.stringify(result.features));
  }
  assert.equal(featureDefinitions.FeatureNEON.armName, 'FEAT_AdvSIMD');
  assert(featureDefinitions.FeatureNEON.implies.includes('FeatureFPARMv8'));
  assert.equal(featureDefinitions.FeatureAES.armName, 'FEAT_AES, FEAT_PMULL');
});

test('SVE or SME alternatives are preserved; LLVM +all is not a requirement', () => {
  const result = decode(0x04a00000);
  assert.equal(result.text, 'add z0.s, z0.s, z0.s');
  assert.deepEqual(result.features.predicates.map(p => p.expression), [
    { any_of: [{ feature: 'FeatureSVE' }, { feature: 'FeatureSME' }] },
  ]);
  assert.equal(featureDefinitions.FeatureAll, undefined);
  assert.throws(() => { featureDefinitions.FeatureSVE.implies.push('invented'); });
});

test('invalid, truncated and LLVM soft-fail results remain distinct', () => {
  assert.equal(decode(0xffffffff).status, 'invalid');
  const soft = decode(0xa9400020); // ldp x0, x0, [x1]: duplicate destinations.
  assert.equal(soft.status, 'soft-fail');
  assert.equal(soft.mnemonic, 'ldp');
  for (let length = 1; length <= 3; length++) {
    const result = decoder.decode(new Uint8Array(length))[0];
    assert.equal(result.status, 'invalid');
    assert.equal(result.length, 0);
    assert.equal(result.bytesConsumed, length);
  }
  const bytes = new Uint8Array([...word(0xffffffff), ...word(0xd65f03c0), 0xff]);
  const results = decoder.decode(bytes, { address: 0x1000n });
  assert.deepEqual(results.map(x => x.status), ['invalid', 'success', 'invalid']);
  assert.deepEqual(results.map(x => x.offset), [0, 4, 8]);
  assert.equal(results[1].address, 0x1004n);
});

test('determinism, byte views, empty input, and argument validation', async () => {
  const bytes = new Uint8Array([7, ...word(0xd65f03c0), 7]).subarray(1, 5);
  const expected = decoder.decode(bytes);
  for (let i = 0; i < 100; i++) assert.deepEqual(decoder.decode(bytes), expected);
  const second = await createDisassembler({ wasmBinary });
  assert.deepEqual(second.decode(bytes), expected);
  assert.deepEqual(decoder.decode(new Uint8Array()), []);
  assert.throws(() => decoder.decode([0, 0, 0, 0]), TypeError);
  for (const address of [-1n, 1n << 64n, 1, NaN])
    assert.throws(() => decoder.decode(bytes, { address }), RangeError);
});

test('default Node file URL loading', async () => {
  const d = await createDisassembler();
  assert.equal(d.decode(word(0xd65f03c0))[0].mnemonic, 'ret');
});

test('accepts Uint8Array views from another realm without accepting other view types', () => {
  const bytes = runInNewContext('new Uint8Array([7, 192, 3, 95, 214, 7]).subarray(1, 5)');
  assert.equal(decoder.decode(bytes)[0].mnemonic, 'ret');
  for (const value of [new Uint8ClampedArray(4), new Int8Array(4), new DataView(new ArrayBuffer(4))])
    assert.throws(() => decoder.decode(value), TypeError);
});

test('full decoding no longer serializes instructions through JSON', () => {
  const expected = decoder.decode(word(0x91000420));
  const parse = JSON.parse;
  try {
    JSON.parse = () => { throw new Error('JSON instruction transport'); };
    assert.deepEqual(decoder.decode(word(0x91000420)), expected);
  } finally {
    JSON.parse = parse;
  }
});

test('full results own their strings and operands across subsequent calls', () => {
  const first = decoder.decode(word(0x97ffffff), { address: 0x123456789000n });
  const saved = structuredClone(first);
  decoder.decode(word(0xa9400020));
  decoder.decode(word(0xffffffff));
  assert.deepEqual(first, saved);
});

test('binary full results preserve signed MC immediates independently of wrapped targets', () => {
  // LLVM AArch64 BL: signed imm26 counts words; the printer scales it by four.
  // https://github.com/llvm/llvm-project/blob/llvmorg-21.1.8/llvm/lib/Target/AArch64/AArch64InstrFormats.td
  const result = decode(0x97ffffff);
  assert.equal(result.opcodeName, 'BL');
  assert.equal(result.text, 'bl #-4');
  assert.equal(result.target, 0xfffffffffffffffen - 2n);
  assert.deepEqual(result.operands, [{ kind: 'immediate', value: -1n }]);
});
