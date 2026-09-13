import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const name of ['llvm-aarch64.js', 'llvm-aarch64.wasm', 'features.js', 'build-info.json']) {
  try { await copyFile(`artifacts/${name}`, `dist/${name}`); }
  catch (error) { throw new Error(`Missing prebuilt artifact ${name}. Run npm run build:wasm.`, { cause: error }); }
}
