import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 2,
  use: {
    baseURL: 'https://the-internet.herokuapp.com',
    actionTimeout: 10000,
    trace: 'on-first-retry',
  },
});