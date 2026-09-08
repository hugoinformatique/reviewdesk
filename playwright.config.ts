import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', timeout: 45000, workers: 1, use: { baseURL: 'http://127.0.0.1:4310', headless: true }, webServer: [
  { command: 'DATABASE_PATH=.data/e2e ADMIN_PASSWORD=e2e-password-long-enough PORT=4310 npm run dev', url: 'http://127.0.0.1:4310/health', reuseExistingServer: false, timeout: 120000 },
  { command: 'python3 -m http.server 4311 --bind 127.0.0.1 --directory public', url: 'http://127.0.0.1:4311/demo.html', reuseExistingServer: false, timeout: 120000 }
] });
