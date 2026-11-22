/**
 * Post-deploy browser smoke (ci-pipeline, QG-07): opens the deployed
 * production bundle (no test seams), clicks Start Game and the Ready gate,
 * and checks that a match really starts: the countdown shows with pointer
 * lock held, then gives way to the live HUD, with zero page errors.
 *
 * Target: the validated DistributionUrl in reports/cdk-outputs.json, or
 * SZ_SMOKE_ORIGIN for a local dry run against `vite preview` (127.0.0.1 only).
 * Run with `npm run smoke:browser`. Result goes to reports/browser-smoke.json.
 *
 * WebGL here is SwiftShader: no frame rate from this run is ever reported.
 */
import { expect, test } from '@playwright/test';
import { validateOutputs } from '../../scripts/verification/outputs.ts';
import { readJsonBounded } from '../../scripts/verification/read.ts';
import { stableJson } from '../../scripts/verification/render.ts';
import { writeMasked } from '../../scripts/verification/write.ts';

const LOCAL_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
const FAULT_CODES = new Set(['app/frame-fault', 'app/frame-fault-tripped']);
const ASSET_CODE = /^(render\/asset-|render\/texture-budget|app\/csp-violation)/;
const LOAD_TIMEOUT = 120_000;
// The countdown is 3.5 s of game time, but on software WebGL (SwiftShader) the
// default Medium preset with the authored assets renders at 0.1-0.8 FPS, so
// reaching live took longer than 120 s in the 2026-11-22 dry run (DE-G-Q1 = C).
const LIVE_TIMEOUT = 300_000;

function resolveOrigin(): string | null {
  const local = process.env.SZ_SMOKE_ORIGIN;
  if (typeof local === 'string' && local.length > 0) {
    return LOCAL_ORIGIN.test(local) ? local : null;
  }
  const raw = readJsonBounded('reports/cdk-outputs.json', 1024 * 1024);
  if (!raw.ok) return null;
  const outputs = validateOutputs(raw.value);
  return outputs.ok ? outputs.value.origin.replace(/\/$/, '') : null;
}

test('deployed game: Start Game starts a match (countdown, then live HUD)', async ({
  page,
  browser,
}) => {
  const origin = resolveOrigin();
  const errors: string[] = [];
  const warnCodes: string[] = [];
  const steps: Record<string, boolean> = {
    menu: false,
    noSeams: false,
    ready: false,
    countdown: false,
    pointerLock: false,
    live: false,
  };
  page.on('pageerror', (err) =>
    errors.push(`pageerror: ${err.name}: ${err.message}`.slice(0, 300)),
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`.slice(0, 300));
    const m = /^\[strikezone\] ([a-z0-9-]+\/[a-z0-9-]+)/.exec(msg.text());
    if (msg.type() === 'warning' && m?.[1] !== undefined) warnCodes.push(m[1]);
  });
  try {
    expect(origin, 'no validated DistributionUrl and no local SZ_SMOKE_ORIGIN').not.toBeNull();
    if (origin === null) return;

    await page.goto(`${origin}/`);
    await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30_000 });
    steps.menu = true;
    const seams = await page.evaluate(
      () => typeof (window as unknown as { __strikezone?: unknown }).__strikezone,
    );
    expect(seams).toBe('undefined');
    steps.noSeams = true;

    await page.getByTestId('main-menu-bots-5').check({ force: true });
    await page.getByTestId('main-menu-start').click();
    await expect(page.getByTestId('ready-screen')).toBeVisible({ timeout: LOAD_TIMEOUT });
    steps.ready = true;

    await page.getByTestId('ready-deploy').click();
    await expect(page.getByTestId('countdown-screen')).toBeVisible({ timeout: 30_000 });
    steps.countdown = true;
    const locked = await page.evaluate(() => document.pointerLockElement?.tagName ?? null);
    expect(locked).toBe('CANVAS');
    steps.pointerLock = true;

    await expect(page.getByTestId('countdown-screen')).toBeHidden({ timeout: LIVE_TIMEOUT });
    await expect(page.getByTestId('hud-root')).toBeVisible();
    await expect(page.getByTestId('pause-dialog')).toBeHidden();
    await expect(page.getByTestId('ready-lock-refused')).toBeHidden();
    await expect(page.getByTestId('loading-screen')).toBeHidden();
    steps.live = true;

    await page.screenshot({ path: 'reports/playwright/deployed-live.png' });
  } finally {
    // BR-G-84: asset fallbacks and CSP blocks fail the deployed smoke too.
    const faults = [...new Set(warnCodes)].filter((c) => FAULT_CODES.has(c) || ASSET_CODE.test(c));
    const pass = Object.values(steps).every(Boolean) && errors.length === 0 && faults.length === 0;
    writeMasked(
      '.',
      'reports/browser-smoke.json',
      stableJson({
        browser: `chromium ${browser.version()}`,
        url: origin ?? 'unresolved',
        pass,
        steps,
        errors,
        warnCodes: [...new Set(warnCodes)].sort(),
      }),
    );
  }
  expect(errors).toEqual([]);
  expect([...new Set(warnCodes)].filter((c) => FAULT_CODES.has(c) || ASSET_CODE.test(c))).toEqual(
    [],
  );
});
