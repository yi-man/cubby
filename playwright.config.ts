import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'CUBBY_PORT=3000 bun packages/server/src/index.ts',
    port: 3000,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
