import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3737',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-CN'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'npm run dev -- --port 3737',
    url: 'http://localhost:3737/zh-CN',
    reuseExistingServer: true,
    timeout: 60000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
})