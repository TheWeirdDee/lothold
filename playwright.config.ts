import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8798',
    channel: 'chrome',
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build && node scripts/e2e-server.ts',
    url: 'http://127.0.0.1:8798/api/health',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
