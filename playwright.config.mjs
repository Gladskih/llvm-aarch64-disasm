import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test', testMatch: 'browser.spec.mjs',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium' },
  webServer: { command: 'node test/server.mjs', url: 'http://127.0.0.1:4173/test/browser.html' },
});
