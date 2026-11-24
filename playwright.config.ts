import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    acceptDownloads: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'VITE_SUPABASE_URL=http://127.0.0.1:4173 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture_only npm run build && VITE_SUPABASE_URL=http://127.0.0.1:4173 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture_only npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
})
