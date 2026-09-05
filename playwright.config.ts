import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  outputDir: './prep/out/browser-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'prep/out/browser-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5184',
    viewport: { width: 1280, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.platform === 'win32' && !process.env['CI'] ? { channel: 'msedge' } : {}),
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
