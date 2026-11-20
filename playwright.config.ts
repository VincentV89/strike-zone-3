/**
 * Playwright config for `npm run e2e` (FD-VE-Q1 = A, TS-VE-07, SD-VE-06).
 * It serves only the dist-test/ bundle on 127.0.0.1; dist-test/ is never
 * deployed. Browser binaries and the extracted shared libraries live under
 * $HOME/scratch, outside the workspace (see docs/MANUAL-TESTS.md, "Browser
 * test setup").
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const scratch = join(homedir(), 'scratch');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(scratch, 'ms-playwright');
const libs = process.env.SZ_CHROMIUM_LIBS ?? join(scratch, 'chromium-libs');
const libraryPath = [
  join(libs, 'usr/lib/aarch64-linux-gnu'),
  join(libs, 'lib/aarch64-linux-gnu'),
  join(libs, 'usr/lib/x86_64-linux-gnu'),
  join(libs, 'lib/x86_64-linux-gnu'),
].join(':');

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.ts',
  outputDir: 'reports/playwright',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      env: { ...process.env, LD_LIBRARY_PATH: libraryPath },
    },
  },
  webServer: {
    command:
      'npx vite preview --config vite.preview.config.ts --outDir dist-test --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
