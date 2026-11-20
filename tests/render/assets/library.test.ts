/**
 * AssetLibrary (BR-G-10/11/16/19, domain-entities "AssetLibrary and LibraryEntry"):
 * join, abort → absent, foreign-abort re-request, terminal failures with one code each,
 * page-lifetime reuse and the bounded CPU reserve.
 */
import { describe, expect, it } from 'vitest';
import { createDiagnostics } from '../../../src/core';
import { codeFor, createAssetLibrary, isAbortError } from '../../../src/render/assets/library';
import type {
  AssetEntry,
  AssetPort,
  AssetRuntime,
  ParsedTexture,
} from '../../../src/render/assets/types';

function texture(bytes: number): ParsedTexture {
  return {
    kind: 'texture',
    width: 4,
    height: 4,
    mipmaps: [{ data: new Uint8Array(1), width: 4, height: 4 }],
    format: 0,
    type: 0,
    srgb: true,
    bytes,
  };
}

function entry(
  key: string,
  maps: AssetEntry['maps'] = 'all',
  kind: AssetEntry['kind'] = 'texture',
): AssetEntry {
  return { key, url: `/x/${key}`, bytes: 10, kind, maps };
}

function rig(opts: { size?: number; reserve?: { mapBytes: number; totalBytes: number } } = {}) {
  const codes: string[] = [];
  const diagnostics = createDiagnostics((c) => codes.push(c));
  const calls: string[] = [];
  let gate: Promise<void> | null = null;
  let failParse: string | null = null;
  let failFetch = false;
  const port: AssetPort = {
    async fetchBytes(url, signal, onBytes) {
      calls.push(url);
      if (gate !== null) await gate;
      if (signal.aborted) {
        const e = new Error('a');
        e.name = 'AbortError';
        throw e;
      }
      if (failFetch) throw new Error('net');
      onBytes(5);
      return new Uint8Array(10);
    },
    loadKit: () => Promise.reject(new Error('unused')),
  };
  const runtime = {
    parse: (e: AssetEntry) => {
      if (failParse !== null) {
        const err = new Error('x') as Error & { code: string };
        err.code = failParse;
        return Promise.reject(err);
      }
      return Promise.resolve(
        e.kind === 'model'
          ? { kind: 'model' as const, root: {} as never, animations: [], triangles: 0 }
          : texture(opts.size ?? 100),
      );
    },
  } as unknown as AssetRuntime;
  const yields = { n: 0 };
  const lib = createAssetLibrary({
    port,
    diagnostics,
    yieldTask: () => {
      yields.n += 1;
      return Promise.resolve();
    },
    ...(opts.reserve === undefined ? {} : { reserve: opts.reserve }),
  });
  return {
    lib,
    runtime,
    codes,
    calls,
    yields,
    setGate(p: Promise<void> | null) {
      gate = p;
    },
    setFailParse(c: string | null) {
      failParse = c;
    },
    setFailFetch(f: boolean) {
      failFetch = f;
    },
  };
}

const live = (): AbortSignal => new AbortController().signal;

describe('asset library', () => {
  it('joins concurrent requests into one fetch and reuses ready entries (BR-G-16/19)', async () => {
    const r = rig();
    const e = entry('tex-a');
    const [a, b] = await Promise.all([
      r.lib.request(e, live(), r.runtime, 'desert-compound'),
      r.lib.request(e, live(), r.runtime, 'desert-compound'),
    ]);
    expect([a, b]).toEqual(['ready', 'ready']);
    expect(r.calls).toHaveLength(1);
    expect(await r.lib.request(e, live(), r.runtime, 'desert-compound')).toBe('ready');
    expect(r.lib.fetches).toBe(1);
    expect(r.lib.texture('tex-a')?.bytes).toBe(100);
    expect(r.lib.model('tex-a')).toBeNull();
    expect(r.lib.received('tex-a')).toBe(10);
  });

  it('an abort returns the entry to absent with no diagnostic and no fallback (BR-G-10/11)', async () => {
    const r = rig();
    const e = entry('tex-b');
    const ctl = new AbortController();
    let open = (): void => undefined;
    r.setGate(new Promise<void>((res) => (open = res)));
    const p = r.lib.request(e, ctl.signal, r.runtime, 'desert-compound');
    ctl.abort();
    open();
    expect(await p).toBe('aborted');
    expect(r.lib.state('tex-b')).toBe('absent');
    expect(r.codes).toEqual([]);
    expect(r.lib.failedKeys()).toEqual([]);
    r.setGate(null);
    expect(await r.lib.request(e, live(), r.runtime, 'desert-compound')).toBe('ready');
    expect(r.calls).toHaveLength(2);
  });

  it('a joiner whose shared fetch was aborted by another run requests once more (BR-G-19)', async () => {
    const r = rig();
    const e = entry('tex-c');
    const first = new AbortController();
    let open = (): void => undefined;
    r.setGate(new Promise<void>((res) => (open = res)));
    const a = r.lib.request(e, first.signal, r.runtime, 'desert-compound');
    const b = r.lib.request(e, live(), r.runtime, 'desert-compound');
    first.abort();
    open();
    r.setGate(null);
    expect(await a).toBe('aborted');
    expect(await b).toBe('ready');
    expect(r.calls).toHaveLength(2);
  });

  it('an already aborted signal fetches nothing', async () => {
    const r = rig();
    const ctl = new AbortController();
    ctl.abort();
    expect(await r.lib.request(entry('tex-z'), ctl.signal, r.runtime, 'desert-compound')).toBe(
      'aborted',
    );
    expect(r.calls).toEqual([]);
  });

  it('fetch and decode failures are terminal, coded and reported once (BR-G-11)', async () => {
    const r = rig();
    r.setFailFetch(true);
    expect(await r.lib.request(entry('tex-d'), live(), r.runtime, 'desert-compound')).toBe(
      'failed',
    );
    r.setFailFetch(false);
    expect(await r.lib.request(entry('tex-d'), live(), r.runtime, 'desert-compound')).toBe(
      'failed',
    );
    expect(r.calls).toHaveLength(1);
    r.setFailParse('render/asset-invalid');
    await r.lib.request(entry('tex-e'), live(), r.runtime, 'desert-compound');
    r.setFailParse('not-a-code');
    await r.lib.request(entry('tex-f'), live(), r.runtime, 'desert-compound');
    expect(r.codes).toEqual([
      'render/asset-fetch-failed',
      'render/asset-invalid',
      'render/asset-decode-failed',
    ]);
    expect(r.lib.failedKeys()).toEqual(['tex-d', 'tex-e', 'tex-f']);
    expect(r.lib.state('tex-e')).toBe('failed');
  });

  it('GLB decodes run through the single slot and yield around each decode', async () => {
    const r = rig();
    await Promise.all([
      r.lib.request(entry('m1', 'all', 'model'), live(), r.runtime, 'desert-compound'),
      r.lib.request(entry('m2', 'all', 'model'), live(), r.runtime, 'desert-compound'),
    ]);
    expect(r.yields.n).toBe(4);
    expect(r.lib.model('m1')).not.toBeNull();
  });

  it('evicts other maps first, then refuses with render/asset-memory (NFR-G-D2)', async () => {
    const r = rig({ size: 40, reserve: { mapBytes: 80, totalBytes: 100 } });
    await r.lib.request(
      entry('w1', ['industrial-warehouse']),
      live(),
      r.runtime,
      'industrial-warehouse',
    );
    await r.lib.request(
      entry('w2', ['industrial-warehouse']),
      live(),
      r.runtime,
      'industrial-warehouse',
    );
    expect(r.lib.keptBytes()).toBe(80);
    expect(
      await r.lib.request(entry('d1', ['desert-compound']), live(), r.runtime, 'desert-compound'),
    ).toBe('ready');
    expect(r.lib.state('w1')).toBe('absent'); // least recently used other-map entry
    expect(r.lib.keptBytes()).toBeLessThanOrEqual(100);
    await r.lib.request(entry('d2', ['desert-compound']), live(), r.runtime, 'desert-compound');
    expect(
      await r.lib.request(entry('d3', ['desert-compound']), live(), r.runtime, 'desert-compound'),
    ).toBe('failed');
    expect(r.codes).toContain('render/asset-memory');
  });

  it('codeFor and isAbortError read only closed fields', () => {
    expect(isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError('AbortError')).toBe(false);
    expect(codeFor({ code: 'render/asset-upload' }, 'render/asset-invalid')).toBe(
      'render/asset-upload',
    );
    expect(codeFor(null, 'render/asset-invalid')).toBe('render/asset-invalid');
  });
});
