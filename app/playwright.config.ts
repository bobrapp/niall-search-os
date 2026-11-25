import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', acceptDownloads: true },
  webServer: {
    command: 'npm run preview -- --host localhost --port 4173 --strictPort',
    env: { ANTHROPIC_API_KEY: '' },
    url: 'http://localhost:4173',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'], viewport: { width: 360, height: 780 } } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
