import { defineConfig } from '@playwright/test';

/**
 * Two origins on purpose: the admin on :4310 and the client preview on :4311.
 * The widget therefore talks to a genuinely different origin, so CORS, the
 * exact-origin allowlist and the bearer token are all exercised for real.
 *
 * The E2E stack uses the local dev drivers (embedded PostgreSQL on disk, uploads
 * on disk); the managed PostgreSQL and S3 paths are covered by the integration
 * suite against Docker containers.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4310', headless: true },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:4310/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: 'pglite://.data/e2e',
        STORAGE_DRIVER: 'filesystem',
        UPLOAD_DIR: '.data/e2e-uploads',
        ADMIN_PASSWORD: 'grenat-fougere-litanie-8412',
        PORT: '4310',
      },
    },
    {
      command: 'python3 -m http.server 4311 --bind 127.0.0.1 --directory public',
      url: 'http://127.0.0.1:4311/demo.html',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
