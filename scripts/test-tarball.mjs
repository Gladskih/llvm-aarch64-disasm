// A clean consumer install with lifecycle scripts disabled must work.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const tarball = process.argv[2] ?? resolve(`${pkg.name}-${pkg.version}.tgz`);
const directory = await mkdtemp(join(tmpdir(), 'aarch64-consumer-'));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: directory, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} failed: ${result.status}`);
}
try {
  await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
  const installArgs = ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball];
  if (process.platform === 'win32') {
    run(process.execPath, [process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...installArgs]);
  } else run('npm', installArgs);
  await writeFile(join(directory, 'check.mjs'), `
    import assert from 'node:assert/strict';
    import { createDisassembler } from 'llvm-aarch64-disasm';
    import { readFile, readdir } from 'node:fs/promises';
    import { createHash } from 'node:crypto';
    const root = new URL('./node_modules/llvm-aarch64-disasm/', import.meta.url);
    for (const name of ${JSON.stringify(['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/LLVM.txt', 'licenses/compiler-rt.txt', 'licenses/emscripten-AUTHORS.txt', 'licenses/emscripten-LICENSE.txt', 'licenses/libcxx.txt', 'licenses/musl.txt', 'dist/index.js', 'dist/index.d.ts', 'dist/features.js', 'dist/llvm-aarch64.js', 'dist/llvm-aarch64.wasm', 'dist/build-info.json'])}) {
      assert((await readFile(new URL(name, root))).length > 0, name);
    }
    const entries = await readdir(root);
    assert(!entries.some(name => ['src', 'native', 'scripts', 'artifacts', '.build', '.npmrc'].includes(name)));
    const manifest = JSON.parse(await readFile(new URL('dist/build-info.json', root)));
    const wasm = await readFile(new URL('dist/llvm-aarch64.wasm', root));
    assert.equal(createHash('sha256').update(wasm).digest('hex'), manifest.wasmSha256);
    if (process.env.EXPECTED_COMMIT) {
      assert.equal(manifest.sourceCommit, process.env.EXPECTED_COMMIT);
      assert.equal(manifest.sourceDirty, false);
    }
    const d = await createDisassembler();
    assert.equal(d.decode(new Uint8Array([0xc0, 3, 0x5f, 0xd6]))[0].mnemonic, 'ret');
    console.log('Consumer smoke passed: prebuilt runtime and licenses present; ret decoded');
  `);
  run(process.execPath, ['check.mjs']);
} finally { await rm(directory, { recursive: true, force: true }); }
