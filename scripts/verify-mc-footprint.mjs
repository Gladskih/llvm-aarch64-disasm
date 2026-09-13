// Run against the post-LTO link map, before Emscripten's final Binaryen pass.
// Reject unwanted subsystems even if their enclosing LLVM library is required.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const [bridge, generated] = process.argv.slice(2);
const map = await readFile(join(bridge, 'llvm-aarch64.map'), 'utf8');
const forbidden = /LLVMInitializeAArch64TargetMC|ModelSchedClasses|AArch64(?:WriteProcResTable|WriteLatencyTable|ReadAdvanceTable)|resolveVariantSchedClassImpl|MCCodeEmitter|AsmBackend|ObjectWriter|create\w*Streamer/;
assert(!forbidden.test(map), 'Unused MC subsystem retained in link map');
const archives = await readFile(join(bridge, 'archive-inputs.tsv'), 'utf8');
assert(!/AArch64(?:MCTargetDesc|MCCodeEmitter|\w*ObjectWriter|AsmBackend)\.cpp/.test(archives),
  'Unused AArch64 archive member extracted');

// LLVM merges identical constants from its two printers. A shared register-name
// table may retain an Apple symbol name even though no Apple formatter survives.
const writers = await Promise.all(['AArch64GenAsmWriter.inc', 'AArch64GenAsmWriter1.inc']
  .map(name => readFile(join(generated, name), 'utf8')));
for (const name of ['RegAsmOffsetNoRegAltName', 'RegAsmOffsetvreg']) {
  const pattern = new RegExp(`static const \\w+ ${name}\\[\\] = \\{[\\s\\S]*?\\};`);
  const arrays = writers.map(writer => writer.match(pattern)?.[0]);
  assert(arrays[0], `Missing ${name}`);
  assert.equal(arrays[0], arrays[1], `Apple register table is not identical: ${name}`);
}
for (const line of map.split('\n').filter(line => line.includes('AArch64AppleInstPrinter'))) {
  assert(/RegAsmOffset(?:NoRegAltName|vreg)/.test(line), `Apple-specific formatter retained: ${line}`);
}
console.log('MC footprint verified: no scheduling tables, encoding, object writers, or Apple formatter');
