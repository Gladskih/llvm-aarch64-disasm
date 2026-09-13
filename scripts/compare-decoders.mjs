// Optional native-change audit: compare a saved package build with dist/.
// Usage: node scripts/compare-decoders.mjs BASELINE/index.js LLVM/test/MC/AArch64
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createDisassembler } from '../dist/index.js';

const [baselinePath, fixturePath] = process.argv.slice(2);
assert(baselinePath && fixturePath, 'Supply baseline index.js and LLVM AArch64 MC test directory');
const baselineURL = pathToFileURL(resolve(baselinePath));
const baseline = await (await import(baselineURL.href)).createDisassembler();
const current = await createDisassembler();
assert.deepEqual(await readFile(new URL('features.js', baselineURL)),
  await readFile(new URL('../dist/features.js', import.meta.url)), 'Feature metadata changed');
const words = new Set();
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith('.s') || entry.name.endsWith('.txt')) {
      const text = await readFile(path, 'utf8');
      for (const match of text.matchAll(/\[0x([\da-f]{2}),\s*0x([\da-f]{2}),\s*0x([\da-f]{2}),\s*0x([\da-f]{2})\]/gi)) {
        words.add(parseInt(match[4] + match[3] + match[2] + match[1], 16));
      }
    }
  }
}
await collect(fixturePath);
const fixtureCount = words.size;
assert(fixtureCount > 10000, `Unexpectedly few upstream encodings: ${fixtureCount}`);
let seed = 0x12345678;
for (let i = 0; i < 65536; i++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  words.add(seed >>> 0);
}
const values = [...words].sort((a, b) => a - b);
const counts = { success: 0, 'soft-fail': 0, invalid: 0 };
for (let offset = 0; offset < values.length; offset += 1024) {
  const batch = values.slice(offset, offset + 1024);
  const bytes = new Uint8Array(batch.length * 4);
  const view = new DataView(bytes.buffer);
  batch.forEach((word, i) => view.setUint32(i * 4, word, true));
  // Exercise full-width and wrapping branch targets as well as normal addresses.
  const address = offset % 2048 ? 0xfffffffffffffff0n : 0x123456789000n;
  const expected = baseline.decode(bytes, { address });
  const actual = current.decode(bytes, { address });
  for (let i = 0; i < actual.length; i++) {
    assert.deepEqual(actual[i], expected[i], `Encoding 0x${batch[i].toString(16)}`);
    counts[actual[i].status]++;
  }
}
console.log(JSON.stringify({ fixtureEncodings: fixtureCount, compared: values.length, ...counts }));
