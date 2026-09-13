import { test } from 'node:test';
import assert from 'node:assert/strict';
import metadata from '../dist/features.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { llvmVersion } from '../dist/index.js';

test('all generated predicate and dependency references resolve', () => {
  function check(expression) {
    if (typeof expression === 'boolean') return;
    assert.equal(Object.keys(expression).length, 1);
    if ('feature' in expression) {
      assert(Object.hasOwn(metadata.features, expression.feature), expression.feature);
      assert.notEqual(expression.feature, 'FeatureAll');
    } else if ('not' in expression) check(expression.not);
    else {
      const args = expression.all_of ?? expression.any_of;
      assert(Array.isArray(args));
      args.forEach(check);
    }
  }
  for (const requirement of metadata.requirements)
    requirement.predicates.forEach(p => check(p.expression));
  for (const feature of Object.values(metadata.features))
    feature.implies.forEach(id => assert(Object.hasOwn(metadata.features, id), id));
  for (const index of Object.values(metadata.opcodes)) assert(metadata.requirements[index]);
  assert(Object.keys(metadata.opcodes).length > 7000);
});

test('prebuilt artifact provenance matches the pinned source and binary', async () => {
  const info = JSON.parse(await readFile('dist/build-info.json', 'utf8'));
  const pins = JSON.parse(await readFile('upstream.json', 'utf8'));
  assert.equal(llvmVersion, pins.llvmVersion);
  for (const [key, value] of Object.entries(pins)) assert.equal(info[key], value);
  const wasm = await readFile('dist/llvm-aarch64.wasm');
  assert.equal(wasm.length, info.wasmBytes);
  assert.equal(createHash('sha256').update(wasm).digest('hex'), info.wasmSha256);
  assert.deepEqual(info.linkedLibraries, [
    'LLVMAArch64Desc', 'LLVMAArch64Disassembler', 'LLVMAArch64Info', 'LLVMAArch64Utils',
    'LLVMBinaryFormat', 'LLVMMC', 'LLVMMCDisassembler', 'LLVMSupport', 'LLVMTargetParser',
  ]);
});
