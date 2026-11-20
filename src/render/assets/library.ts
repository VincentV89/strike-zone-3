/**
 * Asset library (domain-entities-graphics-uplift "AssetLibrary and LibraryEntry",
 * business-logic-model §2.2, BR-G-10/11/16/17/19). Page lifetime: rounds, retries and
 * rebuilds reuse every `ready` entry with zero fetches.
 *
 * - One in-flight promise per entry; concurrent callers join it.
 * - An abort returns the entry to `absent`: no diagnostic and no fallback count.
 * - `failed` is terminal for the page (HTTP, network, decode, validation, upload, memory).
 * - GLB decodes run through one slot, yielding before and after (performance-design §2).
 * - CPU memory reserve (scalability-design §4.3, simplified): over the cap, entries of other
 *   maps are evicted first; if still over, the new entry fails with render/asset-memory.
 */
import type { MapId } from '../../contracts';
import type { Diagnostics } from '../../core';
import type {
  AssetEntry,
  AssetFailureCode,
  AssetKey,
  AssetLookup,
  AssetPort,
  AssetRuntime,
  LibraryState,
  ParsedAsset,
  ParsedModel,
  ParsedTexture,
} from './types';

export type EntryOutcome = 'ready' | 'failed' | 'aborted';

/** Kept CPU bytes: 96 MiB for the current map, 160 MiB in total (NFR-G-D2). */
export const MAP_RESERVE_BYTES = 96 * 1024 * 1024;
export const TOTAL_RESERVE_BYTES = 160 * 1024 * 1024;

const FAILURE_CODES: ReadonlySet<string> = new Set<AssetFailureCode>([
  'render/asset-fetch-failed',
  'render/asset-decode-failed',
  'render/asset-invalid',
  'render/asset-kit-failed',
  'render/asset-upload',
  'render/asset-memory',
]);

interface LibraryEntry {
  state: LibraryState;
  inflight: Promise<EntryOutcome> | null;
  value: ParsedAsset | null;
  received: number;
  bytes: number;
  maps: AssetEntry['maps'];
  lastUsed: number;
}

export interface LibraryDeps {
  readonly port: AssetPort;
  readonly diagnostics: Diagnostics;
  readonly yieldTask: () => Promise<void>;
  readonly reserve?: { readonly mapBytes: number; readonly totalBytes: number };
}

export interface AssetLibrary extends AssetLookup {
  request(
    e: AssetEntry,
    signal: AbortSignal,
    runtime: AssetRuntime,
    map: MapId,
  ): Promise<EntryOutcome>;
  state(key: AssetKey): LibraryState;
  received(key: AssetKey): number;
  /** Keys that ended `failed` (BR-G-11 assetFallbacks). */
  failedKeys(): readonly AssetKey[];
  keptBytes(): number;
  /** Fetches started, for reuse tests (0 on a rebuild). */
  readonly fetches: number;
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/** Maps any error to the closed code union (SR-G-11): never reads the message. */
export function codeFor(err: unknown, fallback: AssetFailureCode): AssetFailureCode {
  const code =
    typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' && FAILURE_CODES.has(code)
    ? (code as AssetFailureCode)
    : fallback;
}

/** A function, so checks after an await are not narrowed away. */
const aborted = (signal: AbortSignal): boolean => signal.aborted;

const forMap = (maps: AssetEntry['maps'], map: MapId): boolean =>
  maps === 'all' || maps.includes(map);

export function createAssetLibrary(deps: LibraryDeps): AssetLibrary {
  const entries = new Map<AssetKey, LibraryEntry>();
  const failed: AssetKey[] = [];
  const reserve = deps.reserve ?? { mapBytes: MAP_RESERVE_BYTES, totalBytes: TOTAL_RESERVE_BYTES };
  let decodeSlot: Promise<unknown> = Promise.resolve();
  let clock = 0;
  let fetches = 0;

  function slot(key: AssetKey, e?: AssetEntry): LibraryEntry {
    let le = entries.get(key);
    if (le === undefined) {
      le = {
        state: 'absent',
        inflight: null,
        value: null,
        received: 0,
        bytes: e?.bytes ?? 0,
        maps: e?.maps ?? 'all',
        lastUsed: 0,
      };
      entries.set(key, le);
    }
    return le;
  }

  function fail(key: AssetKey, le: LibraryEntry, code: AssetFailureCode): EntryOutcome {
    le.state = 'failed';
    le.value = null;
    failed.push(key);
    deps.diagnostics.warnOnce(code);
    return 'failed';
  }

  function keptBytes(): number {
    let n = 0;
    for (const le of entries.values()) {
      if (le.state === 'ready' && le.value?.kind === 'texture') n += le.value.bytes;
    }
    return n;
  }

  /** Bounded reserve: evict other maps' textures (LRU), then refuse (scalability §4.3). */
  function makeRoom(add: number, map: MapId): boolean {
    let total = keptBytes();
    if (total + add <= reserve.totalBytes) return mapBytes(map) + add <= reserve.mapBytes;
    const others = [...entries.entries()]
      .filter(
        ([, le]) => le.state === 'ready' && le.value?.kind === 'texture' && !forMap(le.maps, map),
      )
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [, le] of others) {
      if (total + add <= reserve.totalBytes) break;
      total -= le.value?.kind === 'texture' ? le.value.bytes : 0;
      le.state = 'absent';
      le.value = null;
    }
    return total + add <= reserve.totalBytes && mapBytes(map) + add <= reserve.mapBytes;
  }

  function mapBytes(map: MapId): number {
    let n = 0;
    for (const le of entries.values()) {
      if (le.state === 'ready' && le.value?.kind === 'texture' && forMap(le.maps, map))
        n += le.value.bytes;
    }
    return n;
  }

  async function decode(
    e: AssetEntry,
    bytes: Uint8Array,
    runtime: AssetRuntime,
  ): Promise<ParsedAsset> {
    if (e.kind !== 'model') return runtime.parse(e, bytes);
    // Single GLB decode slot; yields so the loading bar can repaint (performance-design §2).
    const run = decodeSlot.then(async () => {
      await deps.yieldTask();
      try {
        return await runtime.parse(e, bytes);
      } finally {
        await deps.yieldTask();
      }
    });
    decodeSlot = run.catch(() => undefined);
    return run;
  }

  async function start(
    e: AssetEntry,
    le: LibraryEntry,
    signal: AbortSignal,
    runtime: AssetRuntime,
    map: MapId,
  ): Promise<EntryOutcome> {
    le.state = 'fetching';
    le.received = 0;
    let stage: AssetFailureCode = 'render/asset-fetch-failed';
    try {
      fetches += 1;
      const bytes = await deps.port.fetchBytes(e.url, signal, (n) => {
        le.received = Math.max(le.received, n);
      });
      le.received = Math.max(le.received, bytes.byteLength);
      le.state = 'decoding';
      stage = 'render/asset-decode-failed';
      const value = await decode(e, bytes, runtime);
      if (aborted(signal)) {
        le.state = 'absent';
        return 'aborted';
      }
      if (value.kind === 'texture' && !makeRoom(value.bytes, map)) {
        return fail(e.key, le, 'render/asset-memory');
      }
      le.value = value;
      le.state = 'ready';
      le.lastUsed = ++clock;
      return 'ready';
    } catch (err) {
      if (isAbortError(err) || aborted(signal)) {
        le.state = 'absent';
        le.received = 0;
        return 'aborted';
      }
      return fail(e.key, le, codeFor(err, stage));
    } finally {
      le.inflight = null;
    }
  }

  async function request(
    e: AssetEntry,
    signal: AbortSignal,
    runtime: AssetRuntime,
    map: MapId,
    retried = false,
  ): Promise<EntryOutcome> {
    const le = slot(e.key, e);
    if (le.state === 'ready') {
      le.lastUsed = ++clock;
      return 'ready';
    }
    if (le.state === 'failed') return 'failed';
    if (signal.aborted) return 'aborted';
    const own = le.inflight === null;
    const flight = le.inflight ?? start(e, le, signal, runtime, map);
    le.inflight = flight;
    const o = await flight;
    // Another run's signal aborted the shared fetch: request once more under ours (BR-G-19).
    if (o === 'aborted' && !own && !retried && !aborted(signal)) {
      return request(e, signal, runtime, map, true);
    }
    return o;
  }

  function texture(key: AssetKey): ParsedTexture | null {
    const v = entries.get(key)?.value;
    return v?.kind === 'texture' ? v : null;
  }

  function model(key: AssetKey): ParsedModel | null {
    const v = entries.get(key)?.value;
    return v?.kind === 'model' ? v : null;
  }

  return {
    request: (e, signal, runtime, map) => request(e, signal, runtime, map),
    state: (key) => entries.get(key)?.state ?? 'absent',
    received: (key) => entries.get(key)?.received ?? 0,
    failedKeys: () => failed,
    keptBytes,
    texture,
    model,
    get fetches() {
      return fetches;
    },
  };
}
