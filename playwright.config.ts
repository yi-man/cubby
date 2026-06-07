import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const e2ePort = Number(process.env.CUBBY_E2E_PORT ?? 6330);
const e2eDataDir = join(tmpdir(), `cubby-e2e-${Date.now()}`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: 'html',
  timeout: 60000,
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `CUBBY_HOST=127.0.0.1 CUBBY_PORT=${e2ePort} CUBBY_DATA_DIR=${JSON.stringify(e2eDataDir)} CUBBY_MOCK_CODEX_PROVIDER=1 bun packages/server/src/index.ts`,
    port: e2ePort,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
