import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}/go-valuedex/`;
const serverFile = fileURLToPath(new URL('./tests/e2e/server.mjs', import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    browserName: 'chromium',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  expect: { timeout: 10_000 },
  timeout: 45_000,
  webServer: {
    command: `"${process.execPath}" "${serverFile}"`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PLAYWRIGHT_PORT: String(port) }
  },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: /(?:desktop|collection)\.spec\.mjs/,
      use: { viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'mobile-chromium',
      testMatch: /(?:mobile|collection)\.spec\.mjs/,
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      }
    }
  ]
});
