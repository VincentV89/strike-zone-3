/** Smoke checks SM-1..SM-9, SM-4b and SM-4c, live and blocked runs (Flow V6, SD-VE-05). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AwsCall, AwsRun } from '../../scripts/verification/aws.ts';
import {
  runPrecheckCommand,
  runSmokeCommand,
  type SmokeRunDeps,
} from '../../scripts/verification/run-smoke.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { nodeListDistAssets } from '../../scripts/verification/run-smoke.ts';
import {
  assetPathsOf,
  BINARY_ASSET_KINDS,
  binaryAssetProblem,
  binaryAssetsOf,
  DEEP_ROUTE,
  isDeployedAndVerified,
  MISSING_ASSET,
  OPERATOR_COMMANDS,
  runSmokeChecks,
  type FetchInitLike,
  type FetchLike,
  type SmokeTarget,
} from '../../scripts/verification/smoke-checks.ts';
import type { DeployOutputs } from '../../scripts/verification/types.ts';
import { put, tmpRoot } from './helpers.ts';

const CSP = "default-src 'self'";
const PP = 'camera=()';
const HOST = 'd1abc.cloudfront.net';
const ORIGIN = `https://${HOST}`;
const BUCKET = 'strikezone-web-1';
const OUTPUTS: DeployOutputs = {
  origin: ORIGIN,
  host: HOST,
  distributionId: 'E1ABCDEFGH',
  bucket: BUCKET,
};
const INDEX =
  '<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,x" /><link rel="stylesheet" href="/assets/index-a.css"></head><body><div id="app"></div><script type="module" src="/assets/index-b.js"></script></body></html>';

const SECURITY = {
  'content-security-policy': CSP,
  'permissions-policy': PP,
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

type Route = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  bytes?: Uint8Array;
};

const magicOf = (ext: string): number[] => [
  ...(BINARY_ASSET_KINDS.find((k) => k.ext === ext)?.magic ?? []),
];
/** A served binary of `size` bytes that starts with the kind's magic bytes. */
const binBytes = (ext: string, size: number): Uint8Array => {
  const b = new Uint8Array(size);
  b.set(magicOf(ext));
  return b;
};
const BINARIES = [
  { path: '/assets/bot-a1.glb', size: 64, type: 'model/gltf-binary', ext: '.glb' },
  { path: '/assets/rock-b2.ktx2', size: 80, type: 'image/ktx2', ext: '.ktx2' },
  { path: '/assets/basis_transcoder-c3.wasm', size: 48, type: 'application/wasm', ext: '.wasm' },
] as const;
const binRoute = (b: (typeof BINARIES)[number]): Route => ({
  status: 200,
  headers: {
    ...SECURITY,
    'content-type': b.type,
    'cache-control': 'public, max-age=31536000, immutable',
  },
  bytes: binBytes(b.ext, b.size),
});

function site(over: Record<string, Route> = {}): {
  fetch: FetchLike;
  seen: { url: string; init: FetchInitLike }[];
} {
  const html: Route = {
    status: 200,
    headers: { ...SECURITY, 'content-type': 'text/html', 'cache-control': 'no-cache' },
    body: INDEX,
  };
  const asset: Route = {
    status: 200,
    headers: {
      ...SECURITY,
      'cache-control': 'public, max-age=31536000, immutable',
      'content-encoding': 'br',
    },
    body: 'x',
  };
  const routes: Record<string, Route> = {
    [`http://${HOST}/`]: { status: 301, headers: { location: `${ORIGIN}/` } },
    [`${ORIGIN}/`]: html,
    [`${ORIGIN}/assets/index-b.js`]: asset,
    [`${ORIGIN}/assets/index-a.css`]: asset,
    [`${ORIGIN}${DEEP_ROUTE}`]: html,
    [`${ORIGIN}${MISSING_ASSET}`]: html,
    [`https://${BUCKET}.s3.eu-west-1.amazonaws.com/index.html`]: { status: 403 },
    ...Object.fromEntries(BINARIES.map((b) => [`${ORIGIN}${b.path}`, binRoute(b)])),
    ...over,
  };
  const seen: { url: string; init: FetchInitLike }[] = [];
  return {
    seen,
    fetch: (url, init) => {
      seen.push({ url, init });
      const r = routes[url];
      if (r === undefined) return Promise.reject(new TypeError('fetch failed'));
      const headers = new Map(Object.entries(r.headers ?? {}));
      return Promise.resolve({
        status: r.status,
        headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
        text: () => Promise.resolve(r.body ?? ''),
        arrayBuffer: () =>
          Promise.resolve((r.bytes ?? new TextEncoder().encode(r.body ?? '')).slice().buffer),
      });
    },
  };
}

const target = (over: Partial<SmokeTarget> = {}): SmokeTarget => ({
  outputs: OUTPUTS,
  region: 'eu-west-1',
  expected: { csp: CSP, permissionsPolicy: PP },
  redeployLog: ' ✅  StrikeZone (no changes)\n',
  binaryAssets: BINARIES.map((b) => ({ path: b.path, size: b.size })),
  ...over,
});

const stackOk = (call: AwsCall): Promise<AwsRun> =>
  Promise.resolve({
    ok: true,
    stdout: JSON.stringify({ Stacks: [{ StackName: call[3], StackStatus: 'CREATE_COMPLETE' }] }),
  });

const noSleep = {
  calls: 0,
  fn(): Promise<void> {
    this.calls += 1;
    return Promise.resolve();
  },
};

describe('runSmokeChecks', () => {
  it('passes SM-1..SM-9, SM-4b and SM-4c against a correct deployment', async () => {
    const s = site();
    const out = await runSmokeChecks(target(), {
      fetch: s.fetch,
      sleep: () => Promise.resolve(),
      aws: stackOk,
    });
    expect(out.map((c) => [c.id, c.pass])).toEqual([
      ['SM-1', true],
      ['SM-2', true],
      ['SM-3', true],
      ['SM-4', true],
      ['SM-4b', true],
      ['SM-4c', true],
      ['SM-5', true],
      ['SM-6', true],
      ['SM-7', true],
      ['SM-8', true],
      ['SM-9', true],
    ]);
    expect(isDeployedAndVerified(out)).toBe(true);
  });

  it('sends only credential-free GET requests with manual redirects to the two validated hosts', async () => {
    const s = site();
    await runSmokeChecks(target(), {
      fetch: s.fetch,
      sleep: () => Promise.resolve(),
      aws: stackOk,
    });
    for (const { url, init } of s.seen) {
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('manual');
      expect(init.credentials).toBe('omit');
      expect(init.signal).toBeDefined();
      const host = new URL(url).host;
      expect([HOST, `${BUCKET}.s3.eu-west-1.amazonaws.com`]).toContain(host);
      if (!url.startsWith('http://')) expect(url.startsWith('https://')).toBe(true);
    }
    expect(s.seen.filter((x) => x.url.startsWith('http://'))).toHaveLength(1);
  });

  it('retries a failing check once after the delay and then fails it', async () => {
    const s = site({ [`http://${HOST}/`]: { status: 200 } });
    const sleep = { ...noSleep, calls: 0 };
    const out = await runSmokeChecks(target(), {
      fetch: s.fetch,
      sleep: () => sleep.fn(),
      aws: stackOk,
    });
    expect(out.find((c) => c.id === 'SM-1')).toMatchObject({ pass: false, observed: '200 ' });
    expect(sleep.calls).toBe(1);
    expect(s.seen.filter((x) => x.url === `http://${HOST}/`)).toHaveLength(2);
    expect(isDeployedAndVerified(out)).toBe(false);
  });

  it('reports a header mismatch by name and a network error by kind', async () => {
    const s = site({
      [`${ORIGIN}/`]: {
        status: 200,
        headers: {
          ...SECURITY,
          'content-security-policy': `${CSP}; extra`,
          'content-type': 'text/html',
          'cache-control': 'no-cache',
        },
        body: INDEX,
      },
    });
    const out = await runSmokeChecks(target(), {
      fetch: s.fetch,
      sleep: () => Promise.resolve(),
      aws: stackOk,
    });
    expect(out.find((c) => c.id === 'SM-3')?.observed).toBe('mismatch: content-security-policy');
    const down = await runSmokeChecks(target(), {
      fetch: () => Promise.reject(new TypeError('x')),
      sleep: () => Promise.resolve(),
      aws: stackOk,
    });
    expect(down.find((c) => c.id === 'SM-2')?.observed).toBe('request failed: TypeError');
    expect(down.find((c) => c.id === 'SM-3')?.observed).toBe('SM-2 did not respond');
  });

  it('marks SM-8 and SM-9 not verified without a redeploy log or the CLI', async () => {
    const s = site();
    const out = await runSmokeChecks(target({ redeployLog: null }), {
      fetch: s.fetch,
      sleep: () => Promise.resolve(),
      aws: null,
    });
    expect(out.find((c) => c.id === 'SM-8')).toMatchObject({ pass: false, notVerified: true });
    expect(out.find((c) => c.id === 'SM-9')).toMatchObject({ pass: false, notVerified: true });
    const changed = await runSmokeChecks(target({ redeployLog: 'StrikeZone: deploying...' }), {
      fetch: s.fetch,
      sleep: () => Promise.resolve(),
      aws: () =>
        Promise.resolve({ ok: true, stdout: '{"Stacks":[{"StackStatus":"ROLLBACK_COMPLETE"}]}' }),
    });
    expect(changed.find((c) => c.id === 'SM-8')?.pass).toBe(false);
    expect(changed.find((c) => c.id === 'SM-9')?.observed).toBe('ROLLBACK_COMPLETE');
  });

  it('never fetches an asset path outside /assets/ (unsafe-asset-path)', async () => {
    expect(
      assetPathsOf('<script src="/assets/a.js"></script><link href="https://evil/x.css">'),
    ).toEqual({
      safe: ['/assets/a.js'],
      unsafe: ['https://evil/x.css'],
    });
    expect(assetPathsOf('<script src="/assets/../secret.js"></script>').unsafe).toEqual([
      '/assets/../secret.js',
    ]);
    const evil = INDEX.replace('/assets/index-a.css', 'https://evil.example/x.css');
    const s = site({
      [`${ORIGIN}/`]: {
        status: 200,
        headers: { ...SECURITY, 'content-type': 'text/html', 'cache-control': 'no-cache' },
        body: evil,
      },
    });
    const out = await runSmokeChecks(target(), {
      fetch: s.fetch,
      sleep: () => Promise.resolve(),
      aws: stackOk,
    });
    expect(out.find((c) => c.id === 'SM-4b')?.observed).toContain('unsafe-asset-path');
    expect(s.seen.some((x) => x.url.includes('evil'))).toBe(false);
  });
});

describe('SM-4c binary assets (monitoring-design-graphics-uplift)', () => {
  const run = async (over: Record<string, Route>, t: Partial<SmokeTarget> = {}) => {
    const s = site(over);
    const out = await runSmokeChecks(target(t), {
      fetch: s.fetch,
      sleep: () => Promise.resolve(),
      aws: stackOk,
    });
    return out.find((c) => c.id === 'SM-4c');
  };
  const glb = BINARIES[0];
  const glbUrl = `${ORIGIN}${glb.path}`;

  it('fails when the SPA fallback serves index.html for a missing asset', async () => {
    const html: Route = {
      status: 200,
      headers: { ...SECURITY, 'content-type': 'text/html', 'cache-control': 'no-cache' },
      body: INDEX,
    };
    const r = await run({ [glbUrl]: html });
    expect(r?.pass).toBe(false);
    expect(r?.observed).toContain(`${glb.path} content-type text/html`);
  });

  it('names a wrong cache, missing nosniff, wrong length and wrong magic', () => {
    const ok = binRoute(glb);
    const got = (route: Route) => {
      const h = new Map(Object.entries(route.headers ?? {}));
      return {
        status: route.status,
        header: (n: string) => h.get(n) ?? '',
        bytes: route.bytes ?? null,
      };
    };
    const a = { path: glb.path, size: glb.size };
    expect(binaryAssetProblem(a, got(ok))).toBeNull();
    expect(
      binaryAssetProblem(
        a,
        got({ ...ok, headers: { ...ok.headers, 'cache-control': 'no-cache' } }),
      ),
    ).toBe('cache-control');
    const noSniff = { ...ok.headers };
    delete noSniff['x-content-type-options'];
    expect(binaryAssetProblem(a, got({ ...ok, headers: noSniff }))).toBe('nosniff');
    expect(binaryAssetProblem(a, got({ ...ok, bytes: binBytes('.glb', 10) }))).toBe(
      'length 10 != 64',
    );
    expect(binaryAssetProblem(a, got({ ...ok, bytes: new Uint8Array(64) }))).toBe('magic bytes');
    expect(binaryAssetProblem(a, got({ ...ok, status: 403 }))).toBe('403');
    expect(binaryAssetProblem(a, got({ ...ok, bytes: undefined }))).toBe('no body bytes');
  });

  it('is not verified without a local dist/, and fails on an empty one', async () => {
    expect(await run({}, { binaryAssets: null })).toMatchObject({
      pass: false,
      notVerified: true,
    });
    expect((await run({}, { binaryAssets: [] }))?.pass).toBe(false);
  });

  it('lists only safe-named .glb, .ktx2 and .wasm files of dist/assets, sorted', () => {
    expect(
      binaryAssetsOf([
        { name: 'z.ktx2', size: 2 },
        { name: 'index-a.js', size: 9 },
        { name: 'a.glb', size: 1 },
        { name: 'bad name.glb', size: 1 },
        { name: 't.wasm', size: 3 },
      ]),
    ).toEqual([
      { path: '/assets/a.glb', size: 1 },
      { path: '/assets/t.wasm', size: 3 },
      { path: '/assets/z.ktx2', size: 2 },
    ]);
    const root = tmpRoot();
    expect(nodeListDistAssets(root)).toBeNull();
    mkdirSync(join(root, 'dist/assets'), { recursive: true });
    writeFileSync(join(root, 'dist/assets/m-1.glb'), binBytes('.glb', 12));
    writeFileSync(join(root, 'dist/assets/index-1.js'), 'x');
    expect(nodeListDistAssets(root)).toEqual([{ path: '/assets/m-1.glb', size: 12 }]);
  });
});

describe('npm run smoke runs', () => {
  const blockedEnv = {
    PATH: '/nowhere',
    AWS_CONFIG_FILE: '/dev/null',
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
  };
  const d = (root: string, over: Partial<SmokeRunDeps> = {}): SmokeRunDeps => ({
    root,
    env: blockedEnv,
    aws: stackOk,
    fetch: site().fetch,
    sleep: () => Promise.resolve(),
    expected: { csp: CSP, permissionsPolicy: PP },
    statSize: () => null,
    ...over,
  });

  it('blocked mode names the failed probes and the operator commands within 10 s (Q-VE-04)', async () => {
    const root = tmpRoot();
    const t0 = performance.now();
    const pre = await runPrecheckCommand(d(root));
    const report = await runSmokeCommand(d(root));
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(pre.probes.every((p) => !p.pass)).toBe(true);
    expect(report.mode).toBe('blocked');
    expect(report.reason).toBe('C1, C2, C3, C4 failed');
    expect(report.missing.join(' ')).toContain('credentials (C2)');
    expect(report.commands).toEqual(OPERATOR_COMMANDS);
    const written = JSON.parse(readFileSync(join(root, 'reports/smoke.json'), 'utf8')) as {
      mode: string;
    };
    expect(written.mode).toBe('blocked');
    expect(JSON.parse(readFileSync(join(root, 'reports/precheck.json'), 'utf8'))).toMatchObject({
      probes: [{ id: 'C1', pass: false }, { id: 'C2' }, { id: 'C3' }, { id: 'C4' }],
    });
  });

  it('blocks on approval when the probes pass but no deploy has run', async () => {
    const root = tmpRoot();
    put(
      root,
      'reports/precheck.json',
      JSON.stringify({
        probes: ['C1', 'C2', 'C3', 'C4'].map((id) => ({ id, pass: true })),
        account: '123456789012',
        region: 'eu-west-1',
      }),
    );
    const r = await runSmokeCommand(d(root));
    expect(r.reason).toContain('approval-not-given');
  });

  it('blocks on bad outputs and on a missing region', async () => {
    const root = tmpRoot();
    put(
      root,
      'reports/cdk-outputs.json',
      JSON.stringify({ StrikeZone: { DistributionUrl: 'https://evil.com' } }),
    );
    expect((await runSmokeCommand(d(root))).reason).toBe('bad-outputs (DistributionUrl)');
    put(
      root,
      'reports/cdk-outputs.json',
      JSON.stringify({
        StrikeZone: { DistributionUrl: ORIGIN, DistributionId: 'E1ABCDEFGH', BucketName: BUCKET },
      }),
    );
    expect((await runSmokeCommand(d(root))).reason).toBe('C4 failed');
  });

  it('runs live with validated outputs and the precheck region', async () => {
    const root = tmpRoot();
    put(
      root,
      'reports/cdk-outputs.json',
      JSON.stringify({
        StrikeZone: { DistributionUrl: ORIGIN, DistributionId: 'E1ABCDEFGH', BucketName: BUCKET },
      }),
    );
    put(
      root,
      'reports/precheck.json',
      JSON.stringify({
        probes: ['C1', 'C2', 'C3', 'C4'].map((id) => ({ id, pass: true })),
        account: '123456789012',
        region: 'eu-west-1',
      }),
    );
    put(root, 'reports/redeploy.log', 'StrikeZone (no changes)');
    const r = await runSmokeCommand(
      d(root, { listDistAssets: () => BINARIES.map((b) => ({ path: b.path, size: b.size })) }),
    );
    expect(r.mode).toBe('live');
    expect(r.url).toBe(ORIGIN);
    expect(isDeployedAndVerified(r.checks)).toBe(true);
  });
});
