/**
 * check:assets, the verify step after check:seams (TS-G-07, logical-components LC-17,
 * cicd-pipeline-graphics-uplift). Offline; reads dist/, assets/ and node_modules/three.
 * Always writes reports/asset-budget.json. Node 24 type stripping: erasable syntax only.
 *
 * Rules:
 * - asset-total: .glb + .ktx2 + .wasm + basis transcoder .js in dist/assets ≤ 31,457,280 B (BR-G-76).
 * - map-download: per map, the manifest entries it fetches ≤ 24 MB (PR-G-36).
 * - texture-inventory: per map ≤ 88 MiB and both maps ≤ 144 MiB at 1 B/texel (full chains).
 * - partition: every dist/assets extension is one of js, css, glb, ktx2, wasm (ID-G-02).
 * - transcoder: exactly one basis_transcoder .js and .wasm, byte-identical to three (SR-G-12).
 * - glb-images: no committed GLB carries images, textures, samplers or buffer URIs (BR-G-06).
 * - ktx2-mips: every committed KTX2 has a full mip chain (BR-G-18).
 * - kit-chunk: the lazy kit chunk exists and is ≤ 2 × 150 KB minified (PR-G-32, asserted at 2×).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

export const TOTAL_MAX_BYTES = 31_457_280;
export const MAP_MAX_BYTES = 24 * 1024 * 1024;
export const MAP_INVENTORY_MAX = 88 * 1024 * 1024;
export const BOTH_INVENTORY_MAX = 144 * 1024 * 1024;
export const KIT_MIN_TARGET = 150 * 1024;
export const PARTITION = new Set(['.js', '.css', '.glb', '.ktx2', '.wasm']);
const MAPS = ['desert-compound', 'industrial-warehouse'] as const;

export interface Finding {
  readonly rule: string;
  readonly detail: string;
}

interface ManifestRow {
  readonly key: string;
  readonly file: string;
  readonly kind: string;
  readonly maps: 'all' | readonly string[];
}

export interface AssetReport {
  readonly generatedAt: string;
  readonly totalBytes: number;
  readonly perMapBytes: Readonly<Record<string, number>>;
  readonly inventoryTexels: Readonly<Record<string, number>>;
  readonly kitChunk: {
    readonly file: string | null;
    readonly bytes: number;
    readonly brotliBytes: number;
  };
  readonly transcoderLicence: string;
  readonly files: number;
  readonly findings: readonly Finding[];
  readonly ok: boolean;
}

function list(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...list(p));
    else out.push(p);
  }
  return out;
}

/** Throws unless `bin` is a GLB; returns its JSON chunk. */
export function glbJson(bin: Uint8Array): Record<string, unknown> {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (bin.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bin.subarray(20, 20 + len))) as Record<
    string,
    unknown
  >;
}

export function glbFindings(file: string, bin: Uint8Array): Finding[] {
  let json: Record<string, unknown>;
  try {
    json = glbJson(bin);
  } catch {
    return [{ rule: 'glb-images', detail: `${file}: not a GLB` }];
  }
  const out: Finding[] = [];
  for (const k of ['images', 'textures', 'samplers']) {
    const v = json[k];
    if (Array.isArray(v) && v.length > 0)
      out.push({ rule: 'glb-images', detail: `${file}: has ${k}` });
  }
  const buffers = Array.isArray(json['buffers'])
    ? (json['buffers'] as Record<string, unknown>[])
    : [];
  if (buffers.some((b) => b['uri'] !== undefined)) {
    out.push({ rule: 'glb-images', detail: `${file}: buffer uri` });
  }
  return out;
}

export interface Ktx2Info {
  readonly width: number;
  readonly height: number;
  readonly levels: number;
}

export function ktx2Info(bin: Uint8Array): Ktx2Info | null {
  const id = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bin.byteLength < 80 || id.some((b, i) => bin[i] !== b)) return null;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return {
    width: dv.getUint32(20, true),
    height: dv.getUint32(24, true),
    levels: dv.getUint32(40, true),
  };
}

/** Texels of a full chain, i.e. what the GPU holds at 1 B/texel (scalability-design §4.4). */
export function chainTexels(w: number, h: number): number {
  let n = 0;
  let a = w;
  let b = h;
  for (;;) {
    n += a * b;
    if (a === 1 && b === 1) break;
    a = Math.max(1, a >> 1);
    b = Math.max(1, b >> 1);
  }
  return n;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && Buffer.compare(a, b) === 0;
}

const forMap = (maps: ManifestRow['maps'], map: string): boolean =>
  maps === 'all' || maps.includes(map);

export function runCheckAssets(root: string): AssetReport {
  const findings: Finding[] = [];
  const dist = join(root, 'dist', 'assets');
  const distFiles = list(dist);
  let total = 0;
  let kitFile: string | null = null;
  let kitBytes = 0;
  let kitBrotli = 0;
  const transcoders = { js: [] as string[], wasm: [] as string[] };
  if (distFiles.length === 0)
    findings.push({ rule: 'dist-missing', detail: 'run npm run build first' });
  for (const f of distFiles) {
    const name = relative(dist, f).split('\\').join('/');
    const ext = extname(name).toLowerCase();
    if (!PARTITION.has(ext))
      findings.push({ rule: 'partition', detail: `${name}: ${ext} has no deployment` });
    const size = statSync(f).size;
    const isTranscoder = name.startsWith('basis_transcoder-');
    if (ext === '.glb' || ext === '.ktx2' || ext === '.wasm' || isTranscoder) total += size;
    if (isTranscoder && ext === '.js') transcoders.js.push(f);
    if (isTranscoder && ext === '.wasm') transcoders.wasm.push(f);
    if (/^kit-[\w-]+\.js$/.test(name)) {
      kitFile = name;
      kitBytes = size;
      kitBrotli = brotliCompressSync(readFileSync(f), {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).byteLength;
    }
  }
  if (total > TOTAL_MAX_BYTES)
    findings.push({
      rule: 'asset-total',
      detail: `${String(total)} B > ${String(TOTAL_MAX_BYTES)} B`,
    });
  if (distFiles.length > 0) {
    if (kitFile === null)
      findings.push({ rule: 'kit-chunk', detail: 'no lazy kit-*.js chunk in dist/assets' });
    else if (kitBytes > 2 * KIT_MIN_TARGET)
      findings.push({ rule: 'kit-chunk', detail: `${kitFile} ${String(kitBytes)} B > 2 × 150 KB` });
    const ref = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
    for (const [kind, filesOf] of [
      ['js', transcoders.js],
      ['wasm', transcoders.wasm],
    ] as const) {
      if (filesOf.length !== 1) {
        findings.push({
          rule: 'transcoder',
          detail: `${String(filesOf.length)} basis_transcoder .${kind} files`,
        });
        continue;
      }
      const want = readFileSync(join(ref, `basis_transcoder.${kind}`));
      const got = readFileSync(filesOf[0] ?? '');
      if (!sameBytes(want, got))
        findings.push({
          rule: 'transcoder',
          detail: `basis_transcoder.${kind} differs from three`,
        });
    }
  }

  // Committed sources.
  const committed = list(join(root, 'assets'));
  const info = new Map<string, Ktx2Info>();
  for (const f of committed) {
    const rel = relative(root, f).split('\\').join('/');
    const bin = new Uint8Array(readFileSync(f));
    if (rel.endsWith('.glb')) findings.push(...glbFindings(rel, bin));
    if (rel.endsWith('.ktx2')) {
      const k = ktx2Info(bin);
      if (k === null) findings.push({ rule: 'ktx2-mips', detail: `${rel}: not KTX2` });
      else {
        info.set(rel, k);
        const full = Math.floor(Math.log2(Math.max(k.width, k.height))) + 1;
        if (k.levels !== full)
          findings.push({
            rule: 'ktx2-mips',
            detail: `${rel}: ${String(k.levels)} of ${String(full)} levels`,
          });
      }
    }
  }

  // Per-map download and inventory from the generated manifest record.
  let rows: ManifestRow[] = [];
  try {
    const m = JSON.parse(readFileSync(join(root, 'assets', '.manifest.json'), 'utf8')) as {
      manifest: ManifestRow[];
    };
    rows = m.manifest;
  } catch {
    findings.push({ rule: 'manifest', detail: 'assets/.manifest.json missing or invalid' });
  }
  const perMap: Record<string, number> = {};
  const texels: Record<string, number> = {};
  const both = new Set<string>();
  for (const map of MAPS) {
    let bytes = 0;
    let tx = 0;
    for (const r of rows) {
      if (!forMap(r.maps, map)) continue;
      try {
        bytes += statSync(join(root, r.file)).size;
      } catch {
        findings.push({ rule: 'manifest', detail: `${r.file} missing` });
      }
      const k = info.get(r.file);
      if (k !== undefined) {
        tx += chainTexels(k.width, k.height);
        both.add(r.file);
      }
    }
    perMap[map] = bytes;
    texels[map] = tx;
    if (bytes > MAP_MAX_BYTES)
      findings.push({ rule: 'map-download', detail: `${map}: ${String(bytes)} B` });
    if (tx > MAP_INVENTORY_MAX)
      findings.push({ rule: 'texture-inventory', detail: `${map}: ${String(tx)} texels` });
  }
  let bothTx = 0;
  for (const f of both) {
    const k = info.get(f);
    if (k !== undefined) bothTx += chainTexels(k.width, k.height);
  }
  texels['both'] = bothTx;
  if (bothTx > BOTH_INVENTORY_MAX)
    findings.push({ rule: 'texture-inventory', detail: `both maps: ${String(bothTx)} texels` });

  return {
    generatedAt: new Date().toISOString(),
    totalBytes: total,
    perMapBytes: perMap,
    inventoryTexels: texels,
    kitChunk: { file: kitFile, bytes: kitBytes, brotliBytes: kitBrotli },
    transcoderLicence: 'Apache-2.0 (three/examples/jsm/libs/basis/README.md)',
    files: distFiles.length,
    findings,
    ok: findings.length === 0,
  };
}

function main(): void {
  const root = process.cwd();
  let report: AssetReport | null = null;
  try {
    report = runCheckAssets(root);
  } finally {
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(
      join(root, 'reports', 'asset-budget.json'),
      `${JSON.stringify(report ?? { ok: false, findings: [{ rule: 'crash', detail: 'check:assets threw' }] }, null, 2)}\n`,
    );
  }
  const r = report;
  process.stdout.write(
    [
      'check:assets',
      `  dist assets         : ${String(r.files)} files, ${String(r.totalBytes)} B of ${String(TOTAL_MAX_BYTES)} B`,
      ...Object.entries(r.perMapBytes).map(
        ([m, b]) => `  ${m.padEnd(20)}: ${String(b)} B download`,
      ),
      `  texture inventory   : ${Object.entries(r.inventoryTexels)
        .map(([m, t]) => `${m} ${(t / 1048576).toFixed(1)} MiB`)
        .join(', ')}`,
      `  kit chunk           : ${r.kitChunk.file ?? 'none'} ${String(r.kitChunk.bytes)} B min, ${String(r.kitChunk.brotliBytes)} B brotli`,
      ...r.findings.map((f) => `  FAIL ${f.rule}: ${f.detail}`),
      `  result              : ${r.ok ? 'PASS' : 'FAIL'}`,
      '',
    ].join('\n'),
  );
  if (!r.ok) process.exitCode = 1;
}

if (import.meta.main) main();
