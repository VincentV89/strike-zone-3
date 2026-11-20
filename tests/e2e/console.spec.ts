/**
 * Browser console check (story-browser-console-clean, Flow V2, BR-VE-32..35).
 * Runs against the dist-test/ bundle with the pointer-lock bypass seam:
 * E2E-01 load, E2E-02 one round reaches an outcome, E2E-03 Play Again
 * without a reload, E2E-04 zero page errors and console errors, on both maps
 * with seed 42 and 5 bots. E2E-05 opens the deployed URL (no seams) when
 * reports/cdk-outputs.json exists. Results go to reports/e2e.json.
 *
 * WebGL here is SwiftShader: no frame rate from this run is ever reported.
 */
import { expect, test, type Page } from '@playwright/test';
import { readJsonBounded } from '../../scripts/verification/read.ts';
import { validateOutputs } from '../../scripts/verification/outputs.ts';
import { stableJson } from '../../scripts/verification/render.ts';
import type { E2eCase } from '../../scripts/verification/types.ts';
import { writeMasked } from '../../scripts/verification/write.ts';

const MAPS = ['desert-compound', 'industrial-warehouse'] as const;
const STEP_TIMEOUT = 30_000;
const FAULT_CODES = new Set(['app/frame-fault', 'app/frame-fault-tripped']);
/** Asset and CSP signals that must not fire with the production headers (BR-G-84). */
const ASSET_CODE = /^(render\/asset-|render\/texture-budget|app\/csp-violation)/;
/** WebGL RGBA (uncompressed) format id; textures must transcode to a GPU format. */
const RGBA_FORMAT = 1023;

interface Seams {
  state(): string;
  renderStats(): Record<string, unknown>;
  setSeed(seed: number): void;
  fastForward(ticks: number): void;
  readonly marker: string;
}

const cases: E2eCase[] = [];
let browserName = 'chromium-headless-shell';

interface Watch {
  readonly errors: string[];
  readonly warnCodes: string[];
}

function watch(page: Page): Watch {
  const w: Watch = { errors: [], warnCodes: [] };
  page.on('pageerror', (err) =>
    w.errors.push(`pageerror: ${err.name}: ${err.message}`.slice(0, 300)),
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') w.errors.push(`console.error: ${msg.text()}`.slice(0, 300));
    const m = /^\[strikezone\] ([a-z0-9-]+\/[a-z0-9-]+)/.exec(msg.text());
    if (msg.type() === 'warning' && m?.[1] !== undefined) w.warnCodes.push(m[1]);
  });
  return w;
}

async function state(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __strikezone: Seams }).__strikezone.state());
}

async function waitState(page: Page, wanted: readonly string[]): Promise<string> {
  let last = '';
  await expect
    .poll(
      async () => {
        last = await state(page);
        return wanted.includes(last);
      },
      { timeout: STEP_TIMEOUT, intervals: [100, 250, 500] },
    )
    .toBe(true);
  return last;
}

async function fastForward(page: Page, ticks: number): Promise<void> {
  await page.evaluate((n) => {
    (window as unknown as { __strikezone: Seams }).__strikezone.fastForward(n);
  }, ticks);
}

function record(id: string, map: string, pass: boolean, w: Watch): void {
  cases.push({ id, map, pass, errors: [...w.errors], warnCodes: [...new Set(w.warnCodes)].sort() });
}

test.afterAll(() => {
  const order = (c: E2eCase): string => `${c.id} ${c.map}`;
  const sorted = [...cases].sort((a, b) => (order(a) < order(b) ? -1 : 1));
  writeMasked('.', 'reports/e2e.json', stableJson({ browser: browserName, cases: sorted }));
});

for (const map of MAPS) {
  test(`${map}: load, one round, Play Again, zero page errors`, async ({ page, browser }) => {
    browserName = `chromium ${browser.version()}`;
    const w = watch(page);
    let loaded = false;
    let outcome = false;
    let restarted = false;
    try {
      // E2E-01 load
      await page.goto('/?seams=bypass-lock');
      await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: STEP_TIMEOUT });
      expect(await state(page)).toBe('menu');
      loaded = true;

      // E2E-02 one round reaches an outcome
      await page.getByTestId(`main-menu-map-${map}`).check({ force: true });
      await page.getByTestId('main-menu-bots-5').check({ force: true });
      await page.getByTestId('main-menu-difficulty-normal').check({ force: true });
      await page.evaluate(() => {
        (window as unknown as { __strikezone: Seams }).__strikezone.setSeed(42);
      });
      await page.getByTestId('main-menu-start').click();
      await waitState(page, ['ready']);
      await page.getByTestId('ready-deploy').click();
      await waitState(page, ['countdown']);
      await fastForward(page, 210);
      await waitState(page, ['live']);
      // E2E-06 the authored look loaded with the production CSP (BR-G-84).
      const rs = await page.evaluate(() =>
        (window as unknown as { __strikezone: Seams }).__strikezone.renderStats(),
      );
      expect(rs['assetFallbacks']).toBe(0);
      expect(rs['envActive']).toBe(true);
      expect(rs['skinnedBots']).toBe(5);
      expect(rs['textureFormats']).not.toContain(RGBA_FORMAT);
      // The default round is 180 s (10,800 ticks), so 11,400 ticks always end it.
      for (let i = 0; i < 19 && !['eliminated', 'end'].includes(await state(page)); i++) {
        await fastForward(page, 600);
        await page.waitForTimeout(50);
      }
      await waitState(page, ['end']);
      await expect(page.getByTestId('end-of-round-screen')).toBeVisible();
      outcome = true;

      // E2E-03 Play Again without a reload
      const marker = await page.evaluate(
        () => (window as unknown as { __strikezone: Seams }).__strikezone.marker,
      );
      await page.getByTestId('end-of-round-play-again').click();
      await waitState(page, ['countdown', 'live']);
      const after = await page.evaluate(
        () => (window as unknown as { __strikezone: Seams }).__strikezone.marker,
      );
      expect(after).toBe(marker);
      restarted = true;
    } finally {
      record('E2E-01', map, loaded, w);
      record('E2E-02', map, outcome, w);
      record('E2E-03', map, restarted, w);
      const faults = w.warnCodes.filter((c) => FAULT_CODES.has(c));
      record('E2E-04', map, loaded && w.errors.length === 0 && faults.length === 0, w);
    }
    expect(w.errors).toEqual([]);
    expect(w.warnCodes.filter((c) => FAULT_CODES.has(c))).toEqual([]);
    expect(w.warnCodes.filter((c) => ASSET_CODE.test(c))).toEqual([]);
  });
}

test('deployed URL: main menu without seams and zero page errors (E2E-05)', async ({ page }) => {
  const raw = readJsonBounded('reports/cdk-outputs.json', 1024 * 1024);
  const outputs = raw.ok ? validateOutputs(raw.value) : null;
  test.skip(
    outputs === null || !outputs.ok,
    'no validated reports/cdk-outputs.json (deploy not run)',
  );
  if (outputs === null || !outputs.ok) return;
  const w = watch(page);
  let pass = false;
  try {
    await page.goto(`${outputs.value.origin}/`);
    await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: STEP_TIMEOUT });
    const seams = await page.evaluate(
      () => typeof (window as unknown as { __strikezone?: unknown }).__strikezone,
    );
    expect(seams).toBe('undefined');
    pass = w.errors.length === 0;
  } finally {
    record('E2E-05', 'deployed', pass, w);
  }
  expect(w.errors).toEqual([]);
});
