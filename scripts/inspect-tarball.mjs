import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const [pack] = JSON.parse(await readFile('pack-result.json', 'utf8'));
assert.equal(pack.name, pkg.name);
assert.equal(pack.version, pkg.version);
const expected = [...pkg.files, 'README.md', 'package.json'].sort();
assert.deepEqual(pack.files.map(file => file.path).sort(), expected);
const actual = execFileSync('tar', ['-tzf', pack.filename], { encoding: 'utf8' })
  .trim().split(/\r?\n/).map(path => path.replace(/^package\//, '')).sort();
assert.deepEqual(actual, expected);
console.log(`Package contents verified: ${pack.entryCount} files, ${pack.size} bytes`);
