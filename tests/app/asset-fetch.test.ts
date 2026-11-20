/**
 * AssetPort.fetchBytes (LC-01, security-design §3 V0, NFR-G-D1): pool of 4, one jittered
 * retry for network/5xx/429 only, V0 transport checks (status, type, size), abort.
 */
import { describe, expect, it } from 'vitest';
import {
  createAssetFetch,
  fnv1a,
  memo,
  POOL_SIZE,
  retryDelayMs,
  type FetchLike,
} from '../../src/app/asset-fetch';

function response(
  status: number,
  body: Uint8Array,
  headers: Record<string, string> = {},
  stream = true,
): Response {
  const h = new Headers({ 'content-length': String(body.byteLength), ...headers });
  if (!stream) return new Response(body.slice().buffer, { status, headers: h });
  const rs = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(body.subarray(0, Math.ceil(body.byteLength / 2)));
      c.enqueue(body.subarray(Math.ceil(body.byteLength / 2)));
      c.close();
    },
  });
  return new Response(rs, { status, headers: h });
}

function rig(script: (url: string, n: number) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const delays: number[] = [];
  const f: FetchLike = (url, init) => {
    calls.push({ url, init });
    return script(url, calls.length);
  };
  const fetchBytes = createAssetFetch({
    fetch: f,
    delay: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  return { fetchBytes, calls, delays };
}

const live = (): AbortSignal => new AbortController().signal;
const bytes = new Uint8Array([1, 2, 3, 4, 5]);

describe('asset fetch', () => {
  it('streams the body with monotonic progress, same-origin and no redirects', async () => {
    const r = rig(() =>
      Promise.resolve(response(200, bytes, { 'content-type': 'model/gltf-binary' })),
    );
    const seen: number[] = [];
    const out = await r.fetchBytes('/assets/a.glb', live(), (n) => seen.push(n));
    expect([...out]).toEqual([...bytes]);
    expect(seen).toEqual([3, 5]);
    expect(r.calls[0]?.init).toMatchObject({ credentials: 'same-origin', redirect: 'error' });
  });

  it('reads a body without a stream', async () => {
    const r = rig(() => Promise.resolve(response(200, bytes, {}, false)));
    const out = await r.fetchBytes('/assets/a.ktx2', live(), () => undefined);
    expect(out.byteLength).toBe(5);
  });

  it('retries once after 500 + fnv1a(url) % 251 ms for 5xx, 429 and network errors (NFR-G-D1)', async () => {
    for (const first of [503, 429, 'net'] as const) {
      const r = rig((_u, n) =>
        n === 1
          ? first === 'net'
            ? Promise.reject(new TypeError('failed'))
            : Promise.resolve(response(first, new Uint8Array(0)))
          : Promise.resolve(response(200, bytes)),
      );
      const out = await r.fetchBytes('/assets/x.ktx2', live(), () => undefined);
      expect(out.byteLength).toBe(5);
      expect(r.calls).toHaveLength(2);
      expect(r.delays).toEqual([retryDelayMs('/assets/x.ktx2')]);
    }
    expect(retryDelayMs('/a')).toBe(500 + (fnv1a('/a') % 251));
  });

  it('never retries 4xx, a wrong type (the SPA fallback) or an oversize body', async () => {
    const cases: Response[] = [
      response(404, new Uint8Array(0)),
      response(200, bytes, { 'content-type': 'text/html' }),
      response(200, bytes, { 'content-type': 'image/png' }),
      response(200, new Uint8Array(100), { 'content-length': '10' }),
    ];
    for (const res of cases) {
      const r = rig(() => Promise.resolve(res));
      await expect(r.fetchBytes('/assets/a.glb', live(), () => undefined)).rejects.toThrow();
      expect(r.calls).toHaveLength(1);
      expect(r.delays).toEqual([]);
    }
  });

  it('fails after the single retry', async () => {
    const r = rig(() => Promise.resolve(response(502, new Uint8Array(0))));
    await expect(r.fetchBytes('/assets/a.glb', live(), () => undefined)).rejects.toThrow();
    expect(r.calls).toHaveLength(2);
  });

  it('rejects with AbortError on abort, before or during the fetch', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const r = rig(() => Promise.resolve(response(200, bytes)));
    await expect(r.fetchBytes('/a.glb', ctl.signal, () => undefined)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const ctl2 = new AbortController();
    const r2 = rig(() => {
      ctl2.abort();
      return Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }));
    });
    await expect(r2.fetchBytes('/a.glb', ctl2.signal, () => undefined)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it(`runs at most ${String(POOL_SIZE)} fetches at once and hands slots on`, async () => {
    let active = 0;
    let peak = 0;
    const opens: (() => void)[] = [];
    const r = rig(
      () =>
        new Promise<Response>((res) => {
          active += 1;
          peak = Math.max(peak, active);
          opens.push(() => {
            active -= 1;
            res(response(200, bytes));
          });
        }),
    );
    const all = Array.from({ length: 10 }, (_, i) =>
      r.fetchBytes(`/a${String(i)}.glb`, live(), () => undefined),
    );
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 0));
      opens.shift()?.();
    }
    await Promise.all(all);
    expect(peak).toBe(POOL_SIZE);
    expect(r.calls).toHaveLength(10);
  });

  it('a waiter aborted while queued releases its slot without fetching', async () => {
    const opens: (() => void)[] = [];
    const r = rig(
      () =>
        new Promise<Response>((res) =>
          opens.push(() => {
            res(response(200, bytes));
          }),
        ),
    );
    const held = Array.from({ length: POOL_SIZE }, () =>
      r.fetchBytes('/a.glb', live(), () => undefined),
    );
    const ctl = new AbortController();
    const queued = r.fetchBytes('/b.glb', ctl.signal, () => undefined);
    ctl.abort();
    await new Promise((res) => setTimeout(res, 0));
    for (const o of opens.splice(0)) o();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.all(held);
    expect(r.calls.some((c) => c.url === '/b.glb')).toBe(false);
  });

  it('memo keeps one promise, including a rejection (BR-G-12)', async () => {
    let n = 0;
    const m = memo(() => {
      n += 1;
      return Promise.reject(new Error('404'));
    });
    await expect(m()).rejects.toThrow();
    await expect(m()).rejects.toThrow();
    expect(n).toBe(1);
  });
});
