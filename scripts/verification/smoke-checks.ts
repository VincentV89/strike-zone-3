/**
 * Post-deploy smoke checks SM-1..SM-9, SM-4b and SM-4c (monitoring-design-hosting-infra,
 * business-logic-model-verification Flow V6, SD-VE-05, monitoring-design-graphics-uplift).
 * Every URL is built from the validated outputs plus fixed paths; requests carry
 * no credentials.
 */
import { describeStackCall, parseStackStatus, type AwsCall, type AwsRun } from './aws.ts';
import type { DeployOutputs, SmokeCheckResult, SmokeId } from './types.ts';

export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  /** Raw body bytes; SM-4c needs it. Node's fetch Response provides it. */
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export interface FetchInitLike {
  readonly method: 'GET' | 'HEAD';
  readonly redirect: 'manual';
  readonly credentials: 'omit';
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface ExpectedHeaders {
  readonly csp: string;
  readonly permissionsPolicy: string;
}

export interface SmokeDeps {
  readonly fetch: FetchLike;
  readonly sleep: (ms: number) => Promise<void>;
  /** Null when the aws CLI is unavailable (SM-9 is then not verified). */
  readonly aws: ((call: AwsCall) => Promise<AwsRun>) | null;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
}

export interface SmokeTarget {
  readonly outputs: DeployOutputs;
  readonly region: string;
  readonly expected: ExpectedHeaders;
  /** Content of reports/redeploy.log, or null when it does not exist (SM-8). */
  readonly redeployLog: string | null;
  /**
   * Binary assets of the local verified dist/assets (SM-4c), or null when
   * dist/ is absent. Absent or null means SM-4c is not verified.
   */
  readonly binaryAssets?: readonly LocalBinaryAsset[] | null;
}

/** A hashed binary asset of the verified bundle: its URL path and byte size. */
export interface LocalBinaryAsset {
  readonly path: string;
  readonly size: number;
}

/**
 * The served type and leading bytes of each binary asset kind. The types must
 * equal BINARY_TYPES in infra/lib/strikezone-stack.ts (tests/infra keeps them
 * equal); this file may not import infra (BR-VE-47).
 */
export const BINARY_ASSET_KINDS: readonly {
  readonly ext: string;
  readonly contentType: string;
  readonly magic: readonly number[];
}[] = Object.freeze([
  { ext: '.glb', contentType: 'model/gltf-binary', magic: [0x67, 0x6c, 0x54, 0x46] },
  {
    ext: '.ktx2',
    contentType: 'image/ktx2',
    magic: [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { ext: '.wasm', contentType: 'application/wasm', magic: [0x00, 0x61, 0x73, 0x6d] },
]);

const kindOf = (name: string): (typeof BINARY_ASSET_KINDS)[number] | undefined =>
  BINARY_ASSET_KINDS.find((k) => name.endsWith(k.ext));

/** Picks the binary assets (by extension, safe names only) from a dist/assets listing. */
export function binaryAssetsOf(
  entries: readonly { readonly name: string; readonly size: number }[],
): LocalBinaryAsset[] {
  return entries
    .filter((e) => /^[A-Za-z0-9._-]+$/.test(e.name) && kindOf(e.name) !== undefined)
    .map((e) => ({ path: `/assets/${e.name}`, size: e.size }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

interface Got {
  readonly status: number;
  readonly header: (name: string) => string;
  readonly body: string;
}

export interface GotBytes {
  readonly status: number;
  readonly header: (name: string) => string;
  readonly bytes: Uint8Array | null;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const HSTS = 'max-age=31536000';
export const DEEP_ROUTE = '/some/deep/route';
export const MISSING_ASSET = '/assets/does-not-exist.js';

async function get(
  deps: SmokeDeps,
  url: string,
  extraHeaders?: Readonly<Record<string, string>>,
): Promise<Got> {
  const res = await deps.fetch(url, {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    ...(extraHeaders === undefined ? {} : { headers: extraHeaders }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
  });
  const body = await res.text();
  return { status: res.status, header: (n) => (res.headers.get(n) ?? '').trim(), body };
}

async function getBytes(deps: SmokeDeps, url: string): Promise<GotBytes> {
  const res = await deps.fetch(url, {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
  });
  const bytes = res.arrayBuffer === undefined ? null : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, header: (n) => (res.headers.get(n) ?? '').trim(), bytes };
}

/** Why one served binary asset is wrong, or null when it is right (SM-4c). */
export function binaryAssetProblem(asset: LocalBinaryAsset, r: GotBytes): string | null {
  const kind = kindOf(asset.path);
  if (kind === undefined) return 'unknown kind';
  if (r.status !== 200) return String(r.status);
  const type = r.header('content-type');
  if (type !== kind.contentType) return `content-type ${type === '' ? 'none' : type}`;
  if (r.header('cache-control') !== IMMUTABLE) return 'cache-control';
  if (r.header('x-content-type-options') !== 'nosniff') return 'nosniff';
  if (r.bytes === null) return 'no body bytes';
  if (r.bytes.byteLength !== asset.size)
    return `length ${String(r.bytes.byteLength)} != ${String(asset.size)}`;
  if (!kind.magic.every((b, i) => r.bytes?.[i] === b)) return 'magic bytes';
  return null;
}

type CheckFn = () => Promise<{ pass: boolean; observed: string; notVerified?: true }>;

async function withRetry(deps: SmokeDeps, fn: CheckFn): Promise<Awaited<ReturnType<CheckFn>>> {
  const once = async (): Promise<Awaited<ReturnType<CheckFn>>> => {
    try {
      return await fn();
    } catch (e) {
      return { pass: false, observed: `request failed: ${e instanceof Error ? e.name : 'error'}` };
    }
  };
  const first = await once();
  if (first.pass || first.notVerified === true) return first;
  await deps.sleep(deps.retryDelayMs ?? 5_000);
  return once();
}

/** Same-origin asset paths from <script src> and <link href>; data: URIs are skipped. */
export function assetPathsOf(html: string): { safe: string[]; unsafe: string[] } {
  const safe: string[] = [];
  const unsafe: string[] = [];
  const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]*)"/gi;
  for (const m of html.matchAll(re)) {
    const v = m[1] ?? '';
    if (v.startsWith('data:')) continue;
    if (/^\/assets\/[A-Za-z0-9._-]+$/.test(v) && !v.includes('..')) safe.push(v);
    else unsafe.push(v);
  }
  return { safe: [...new Set(safe)], unsafe };
}

function result(
  id: SmokeId,
  request: string,
  expected: string,
  r: { pass: boolean; observed: string; notVerified?: true },
): SmokeCheckResult {
  return {
    id,
    request,
    expected,
    observed: r.observed,
    pass: r.pass,
    ...(r.notVerified ? { notVerified: true } : {}),
  };
}

export async function runSmokeChecks(
  target: SmokeTarget,
  deps: SmokeDeps,
): Promise<SmokeCheckResult[]> {
  const { origin, host, bucket } = target.outputs;
  const out: SmokeCheckResult[] = [];
  const add = async (
    id: SmokeId,
    request: string,
    expected: string,
    fn: CheckFn,
  ): Promise<void> => {
    out.push(result(id, request, expected, await withRetry(deps, fn)));
  };

  await add(
    'SM-1',
    `GET http://${host}/ (no redirect follow)`,
    `301, location https://${host}/`,
    async () => {
      const r = await get(deps, `http://${host}/`);
      const loc = r.header('location');
      return {
        pass: r.status === 301 && loc === `https://${host}/`,
        observed: `${String(r.status)} ${loc}`,
      };
    },
  );

  let root: Got | null = null;
  await add(
    'SM-2',
    `GET ${origin}/`,
    '200 text/html, cache-control no-cache, app root element',
    async () => {
      const r = await get(deps, `${origin}/`);
      root = r;
      const ok =
        r.status === 200 &&
        r.header('content-type').startsWith('text/html') &&
        r.header('cache-control').includes('no-cache') &&
        r.body.includes('id="app"');
      return {
        pass: ok,
        observed: `${String(r.status)} ${r.header('content-type')}; cache-control ${r.header('cache-control')}`,
      };
    },
  );

  await add(
    'SM-3',
    'headers on SM-2',
    'CSP and Permissions-Policy byte-exact; HSTS, nosniff, DENY, no-referrer',
    () => {
      const r: Got | null = root;
      if (r === null) return Promise.resolve({ pass: false, observed: 'SM-2 did not respond' });
      const wrong: string[] = [];
      if (r.header('content-security-policy') !== target.expected.csp)
        wrong.push('content-security-policy');
      if (r.header('permissions-policy') !== target.expected.permissionsPolicy)
        wrong.push('permissions-policy');
      if (r.header('strict-transport-security') !== HSTS) wrong.push('strict-transport-security');
      if (r.header('x-content-type-options') !== 'nosniff') wrong.push('x-content-type-options');
      if (r.header('x-frame-options') !== 'DENY') wrong.push('x-frame-options');
      if (r.header('referrer-policy') !== 'no-referrer') wrong.push('referrer-policy');
      return Promise.resolve({
        pass: wrong.length === 0,
        observed: wrong.length === 0 ? 'all match' : `mismatch: ${wrong.join(', ')}`,
      });
    },
  );

  const html: string = (root as Got | null)?.body ?? '';
  const assets = assetPathsOf(html);
  const firstJs = assets.safe.find((p) => p.endsWith('.js'));

  await add(
    'SM-4',
    `GET ${origin}${firstJs ?? '/assets/<entry>.js'} with Accept-Encoding br, gzip`,
    `200, ${IMMUTABLE}, br or gzip, CSP`,
    async () => {
      if (firstJs === undefined) return { pass: false, observed: 'no /assets/*.js in index.html' };
      const r = await get(deps, `${origin}${firstJs}`, { 'Accept-Encoding': 'br, gzip' });
      const enc = r.header('content-encoding');
      const ok =
        r.status === 200 &&
        r.header('cache-control') === IMMUTABLE &&
        (enc === 'br' || enc === 'gzip') &&
        r.header('content-security-policy') === target.expected.csp;
      return {
        pass: ok,
        observed: `${String(r.status)}; ${r.header('cache-control')}; encoding ${enc}`,
      };
    },
  );

  await add(
    'SM-4b',
    'GET every <script src> and <link href> of index.html',
    '200 for each /assets/ path',
    async () => {
      if (assets.unsafe.length > 0)
        return { pass: false, observed: `unsafe-asset-path: ${assets.unsafe.join(', ')}` };
      if (assets.safe.length === 0) return { pass: false, observed: 'no asset referenced' };
      const bad: string[] = [];
      for (const p of assets.safe) {
        const r = await get(deps, `${origin}${p}`);
        if (r.status !== 200) bad.push(`${p} ${String(r.status)}`);
      }
      return {
        pass: bad.length === 0,
        observed: bad.length === 0 ? `${String(assets.safe.length)} assets 200` : bad.join(', '),
      };
    },
  );

  await add(
    'SM-4c',
    'GET every .glb, .ktx2 and .wasm of the local verified dist/assets',
    '200, exact content-type, immutable, nosniff, local length, magic bytes',
    async () => {
      const list = target.binaryAssets;
      if (list === undefined || list === null)
        return {
          pass: false,
          observed: 'not verified: local dist/assets absent',
          notVerified: true as const,
        };
      if (list.length === 0) return { pass: false, observed: 'no binary asset in dist/assets' };
      const bad: string[] = [];
      for (const a of list) {
        const problem = binaryAssetProblem(a, await getBytes(deps, `${origin}${a.path}`));
        if (problem !== null) bad.push(`${a.path} ${problem}`);
      }
      return {
        pass: bad.length === 0,
        observed:
          bad.length === 0
            ? `${String(list.length)} binary assets ok`
            : `${String(bad.length)} wrong: ${bad.slice(0, 5).join(', ')}`,
      };
    },
  );

  await add('SM-5', `GET ${origin}${DEEP_ROUTE}`, '200, same body as SM-2', async () => {
    const r = await get(deps, `${origin}${DEEP_ROUTE}`);
    return {
      pass: r.status === 200 && r.body === html && html !== '',
      observed: `${String(r.status)}, body ${r.body === html ? 'same' : 'differs'}`,
    };
  });

  await add('SM-6', `GET ${origin}${MISSING_ASSET}`, '200 index.html (SPA mapping)', async () => {
    const r = await get(deps, `${origin}${MISSING_ASSET}`);
    return {
      pass: r.status === 200 && r.body === html && html !== '',
      observed: `${String(r.status)}, body ${r.body === html ? 'index.html' : 'other'}`,
    };
  });

  await add(
    'SM-7',
    `GET https://${bucket}.s3.${target.region}.amazonaws.com/index.html`,
    '403 (bucket is private)',
    async () => {
      const r = await get(deps, `https://${bucket}.s3.${target.region}.amazonaws.com/index.html`);
      return { pass: r.status === 403, observed: String(r.status) };
    },
  );

  await add(
    'SM-8',
    'second cdk deploy --all with no changes (reports/redeploy.log)',
    '"no changes"',
    () => {
      const log = target.redeployLog;
      if (log === null)
        return Promise.resolve({
          pass: false,
          observed: 'not verified: reports/redeploy.log absent',
          notVerified: true as const,
        });
      const ok = /\(no changes\)|no changes/i.test(log);
      return Promise.resolve({ pass: ok, observed: ok ? 'no changes' : 'changes deployed' });
    },
  );

  await add(
    'SM-9',
    'aws cloudformation describe-stacks --stack-name StrikeZone',
    'CREATE_COMPLETE or UPDATE_COMPLETE',
    async () => {
      if (deps.aws === null)
        return {
          pass: false,
          observed: 'not verified: aws CLI unavailable',
          notVerified: true as const,
        };
      const run = await deps.aws(describeStackCall('StrikeZone'));
      const status = run.ok ? parseStackStatus(run.stdout) : null;
      if (status === null)
        return { pass: false, observed: `describe-stacks ${run.error ?? 'gave no status'}` };
      return {
        pass: status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE',
        observed: status,
      };
    },
  );

  return out;
}

/** "Deployed and verified" needs SM-1..SM-7, SM-4b, SM-4c and SM-9 (BR-VE-45). */
export const VERIFIED_SET: readonly SmokeId[] = [
  'SM-1',
  'SM-2',
  'SM-3',
  'SM-4',
  'SM-4b',
  'SM-4c',
  'SM-5',
  'SM-6',
  'SM-7',
  'SM-9',
];

export function isDeployedAndVerified(checks: readonly SmokeCheckResult[]): boolean {
  return VERIFIED_SET.every((id) => checks.some((c) => c.id === id && c.pass));
}

/** Operator commands for blocked mode (BR-VE-44). */
export const OPERATOR_COMMANDS: readonly string[] = [
  'aws sts get-caller-identity',
  'npx cdk bootstrap',
  'npm ci && npm run verify',
  'npx cdk diff',
  'npx cdk deploy --all --outputs-file reports/cdk-outputs.json',
  'npx cdk deploy --all > reports/redeploy.log',
  'npm run smoke',
  'npm run report',
];
