import { test, expect } from '@playwright/test';
test('browser loads colocated WASM and a custom URL without Node shims', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/test/browser.html');
  const result = await page.evaluate(async () => {
    const { createDisassembler } = await import('/dist/index.js');
    const first = await createDisassembler();
    const second = await createDisassembler({ wasmURL: '/dist/llvm-aarch64.wasm?custom' });
    return [first, second].map(d => d.decode(new Uint8Array([0xc0, 3, 0x5f, 0xd6]))[0].mnemonic);
  });
  expect(result).toEqual(['ret', 'ret']);
  expect(errors).toEqual([]);
});
test('browser accepts supplied WASM bytes and rejects bad URLs', async ({ page }) => {
  await page.goto('/test/browser.html');
  expect(await page.evaluate(async () => {
    const { createDisassembler } = await import('/dist/index.js');
    const wasmBinary = new Uint8Array(await (await fetch('/dist/llvm-aarch64.wasm')).arrayBuffer());
    const d = await createDisassembler({ wasmBinary });
    return d.decode(new Uint8Array([0xff, 0xff, 0xff, 0xff]))[0].status;
  })).toBe('invalid');
  expect(await page.evaluate(async () => {
    const { createDisassembler } = await import('/dist/index.js');
    try { await createDisassembler({ wasmURL: '/missing.wasm' }); return false; }
    catch { return true; }
  })).toBe(true);
});
test('module workers load WASM and return structured data', async ({ page }) => {
  await page.goto('/test/browser.html');
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('/test/worker.mjs', { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      resolve({ status: data.status, target: data.target.toString(), kind: data.controlFlow });
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
  }));
  expect(result).toEqual({ status: 'success', target: '4104', kind: 'call' });
});
