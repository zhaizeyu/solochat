import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'https://localhost:3101';

export default defineConfig({
  testDir: './e2e',
  timeout: 900_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    headless: true,
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off'
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
