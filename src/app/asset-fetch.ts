/**
 * AssetPort.fetchBytes (logical-components-graphics-uplift LC-01, security-design §3 V0,
 * NFR-G-D1). The renderer does no I/O; app-shell owns the fetch, the pool and the retry.
 *
 * - Instance-scoped pool of 4 concurrent fetches (bulkhead); retries keep their slot.
 * - V0 transport checks: same-origin, no redirects, HTTP 200 only, Content-Type matching
 *   the file kind (the CloudFront SPA fallback serves missing files as 200 text/html),
 *   and a byte cap of min(expected × 1.1, 8 MB) while streaming.
 * - One retry for network errors, HTTP 5xx and 429 after 500 + fnv1a(url) % 251 ms, under
 *   the same signal. 4xx, type and size failures never retry. There is no timeout; only the
 *   signal stops a fetch (BR-G-10).
 */
import type { AssetPort } from '../render/assets/types';

export const POOL_SIZE = 4;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const RETRY_BASE_MS = 500;
const RETRY_JITTER = 251;
/** Redirects fail the fetch (V0): every asset is a direct same-origin file. */
const NO_REDIRECT: RequestRedirect = 'error';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** Resolves after `ms`; the timer lives in src/app/scope.ts (SD-AS-06). */
export type Delay = (ms: number) => Promise<void>;

/** FNV-1a 32-bit hash of a string (deterministic retry jitter). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function retryDelayMs(url: string): number {
  return RETRY_BASE_MS + (fnv1a(url) % RETRY_JITTER);
}

const EXPECTED_TYPE: readonly [RegExp, string][] = [
  [/\.glb$/i, 'model/gltf-binary'],
  [/\.ktx2$/i, 'image/ktx2'],
];

/** Error with a closed name: AbortError, or a transport kind. */
class FetchFailure extends Error {
  constructor(
    readonly kind: 'http' | 'type' | 'size' | 'network',
    readonly retryable: boolean,
  ) {
    super(kind);
    this.name = 'AssetFetchError';
  }
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

/** A function, so checks after an await are not narrowed away. */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

function pathOf(url: string): string {
  const q = url.search(/[?#]/);
  return q < 0 ? url : url.slice(0, q);
}

export interface AssetFetchDeps {
  readonly fetch: FetchLike;
  readonly delay: Delay;
}

/** Builds the fetchBytes half of the AssetPort. One instance per page (main.ts). */
export function createAssetFetch(deps: AssetFetchDeps): AssetPort['fetchBytes'] {
  let active = 0;
  const waiting: (() => void)[] = [];

  /** Waits for a pool slot. An aborted waiter gives its turn to the next one (no listeners). */
  async function acquire(signal: AbortSignal): Promise<void> {
    if (active < POOL_SIZE) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
    active += 1;
    if (signal.aborted) {
      release();
      throw abortError();
    }
  }

  function release(): void {
    active -= 1;
    const next = waiting.shift();
    if (next !== undefined) next();
  }

  async function once(
    url: string,
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await deps.fetch(url, {
        signal,
        credentials: 'same-origin',
        redirect: NO_REDIRECT,
        cache: 'default',
      });
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) throw abortError();
      throw new FetchFailure('network', true);
    }
    if (res.status !== 200) {
      throw new FetchFailure('http', res.status >= 500 || res.status === 429);
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const want = EXPECTED_TYPE.find(([re]) => re.test(pathOf(url)))?.[1];
    if (
      type === 'text/html' ||
      (want !== undefined && type !== '' && type !== want && type !== 'application/octet-stream')
    ) {
      throw new FetchFailure('type', false);
    }
    const lengthHeader = Number(res.headers.get('content-length') ?? NaN);
    const cap =
      Number.isFinite(lengthHeader) && lengthHeader > 0
        ? Math.min(MAX_ASSET_BYTES, Math.ceil(lengthHeader * 1.1))
        : MAX_ASSET_BYTES;
    const body = res.body;
    if (body === null) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > cap) throw new FetchFailure('size', false);
      onBytes(buf.byteLength);
      return buf;
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > cap) {
          await reader.cancel();
          throw new FetchFailure('size', false);
        }
        chunks.push(value);
        onBytes(received);
      }
    } catch (err) {
      if (err instanceof FetchFailure) throw err;
      if (signal.aborted) throw abortError();
      throw new FetchFailure('network', true);
    }
    const out = new Uint8Array(received);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out;
  }

  return async function fetchBytes(url, signal, onBytes) {
    if (signal.aborted) throw abortError();
    await acquire(signal);
    try {
      try {
        return await once(url, signal, onBytes);
      } catch (err) {
        if (!(err instanceof FetchFailure) || !err.retryable || isAborted(signal)) throw err;
        await deps.delay(retryDelayMs(url));
        if (isAborted(signal)) throw abortError();
        return await once(url, signal, onBytes);
      }
    } finally {
      release();
    }
  };
}

/** Memoises a promise factory; a rejection stays memoised for the page (BR-G-12). */
export function memo<T>(make: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= make();
    return p;
  };
}
