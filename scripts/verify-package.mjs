import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const wasm = await readFile('dist/llvm-aarch64.wasm');
const info = JSON.parse(await readFile('dist/build-info.json', 'utf8'));
const pins = JSON.parse(await readFile('upstream.json', 'utf8'));
for (const [key, value] of Object.entries(pins)) assert.equal(info[key], value, key);
assert.equal(createHash('sha256').update(wasm).digest('hex'), info.wasmSha256);
assert.equal(wasm.length, info.wasmBytes);
assert(WebAssembly.validate(wasm));
assert(info.linkedLibraries.includes('LLVMAArch64Disassembler'));
assert(!info.linkedLibraries.some(x => /X86|ARMDisassembler|CodeGen/.test(x)));
await readFile('licenses/LLVM.txt');
const { createDisassembler, llvmVersion } = await import('../dist/index.js');
assert.equal(llvmVersion, pins.llvmVersion, 'Exported LLVM version must match upstream.json');
if (process.env.CI) {
  assert.equal(info.sourceDirty, false, 'Release source must be clean');
  assert.equal(info.sourceCommit, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
}
const d = await createDisassembler({ wasmBinary: wasm });
assert.equal(d.decode(new Uint8Array([0xc0, 0x03, 0x5f, 0xd6]))[0].mnemonic, 'ret');
console.log(`Verified prebuilt WASM: ${wasm.length} bytes`);
