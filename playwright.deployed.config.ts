/**
 * Playwright config for `npm run smoke:browser` (ci-pipeline QG-07). It starts
 * no web server: tests/e2e/play-deployed.smoke.ts opens the deployed
 * DistributionUrl from reports/cdk-outputs.json (or SZ_SMOKE_ORIGIN on
 * 127.0.0.1 for a local dry run). In GitHub Actions the browser comes from
 * `npx playwright install --with-deps chromium-headless-shell`; in the AI-DLC
 * runtime from $HOME/scratch (docs/MANUAL-TESTS.md, "Browser test setup").
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
  testMatch: '*.smoke.ts',
  outputDir: 'reports/playwright',
  workers: 1,
  retries: 1,
  timeout: 300_000,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      env: { ...process.env, LD_LIBRARY_PATH: libraryPath },
    },
  },
});
