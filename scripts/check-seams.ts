/**
 * check:seams, the last verify step (security-design-app-shell SD-AS-02,
 * performance-design-app-shell PD-AS-15). Fails when test-seam code reaches
 * dist/ or when the entry chunk is over budget, and always writes
 * reports/app-shell-bundle.json. Runs with Node 24 type stripping, so the
 * file uses erasable syntax only.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

/** Marker literals from src/dev (built only in --mode test). */
export const SEAM_MARKERS: readonly string[] = [
  '__strikezone',
  'strikezone:pointer-lock-bypass',
  'strikezone:dev-overlay',
  'installTestSeams',
];

export const ENTRY_MAX_BYTES = 800 * 1024;
export const ENTRY_MAX_BROTLI_BYTES = 200 * 1024;

export interface SeamFinding {
  readonly rule: string;
  readonly file: string;
  readonly detail: string;
}

export interface BundleReport {
  readonly generatedAt: string;
  readonly distScanned: number;
  readonly entry: {
    readonly file: string | null;
    readonly bytes: number;
    readonly brotliBytes: number;
    readonly maxBytes: number;
    readonly maxBrotliBytes: number;
  };
  readonly assetsJsBytes: number;
  readonly findings: readonly SeamFinding[];
  readonly ok: boolean;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/** The module script that dist/index.html loads, as a path relative to dist/. */
export function entryChunkOf(indexHtml: string): string | null {
  const tag = /<script\b[^>]*\btype="module"[^>]*>/i.exec(indexHtml)?.[0];
  const src = tag === undefined ? undefined : /\bsrc="([^"]+)"/i.exec(tag)?.[1];
  if (src === undefined) return null;
  return src.replace(/^\.?\//, '');
}

export function runCheckSeams(root: string): BundleReport {
  const dist = join(root, 'dist');
  const findings: SeamFinding[] = [];
  let scanned = 0;
  let entryFile: string | null = null;
  let bytes = 0;
  let brotliBytes = 0;
  let assetsJsBytes = 0;
  let report: BundleReport;
  try {
    let files: string[] = [];
    try {
      files = listFiles(dist);
    } catch {
      findings.push({ rule: 'dist-missing', file: 'dist', detail: 'run npm run build first' });
    }
    for (const abs of files) {
      const rel = relative(dist, abs).split('\\').join('/');
      scanned += 1;
      const base = rel.split('/').pop() ?? rel;
      if (rel.startsWith('assets/') && base.startsWith('dev')) {
        findings.push({ rule: 'dev-chunk', file: `dist/${rel}`, detail: 'dev chunk emitted' });
      }
      const buf = readFileSync(abs);
      if (rel.startsWith('assets/') && rel.endsWith('.js')) assetsJsBytes += buf.length;
      const text = buf.toString('latin1');
      for (const marker of SEAM_MARKERS) {
        if (text.includes(marker)) {
          findings.push({ rule: 'seam-marker', file: `dist/${rel}`, detail: marker });
        }
      }
    }
    if (files.length > 0) {
      let html = '';
      try {
        html = readFileSync(join(dist, 'index.html'), 'utf8');
      } catch {
        findings.push({ rule: 'entry-missing', file: 'dist/index.html', detail: 'not found' });
      }
      entryFile = html === '' ? null : entryChunkOf(html);
      if (html !== '' && entryFile === null) {
        findings.push({
          rule: 'entry-missing',
          file: 'dist/index.html',
          detail: 'no module script',
        });
      }
      if (entryFile !== null) {
        const code = readFileSync(join(dist, entryFile));
        bytes = code.length;
        brotliBytes = brotliCompressSync(code, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }).length;
        if (bytes > ENTRY_MAX_BYTES) {
          findings.push({
            rule: 'entry-oversize',
            file: `dist/${entryFile}`,
            detail: `${String(bytes)} bytes minified > ${String(ENTRY_MAX_BYTES)}`,
          });
        }
        if (brotliBytes > ENTRY_MAX_BROTLI_BYTES) {
          findings.push({
            rule: 'entry-oversize-brotli',
            file: `dist/${entryFile}`,
            detail: `${String(brotliBytes)} bytes brotli > ${String(ENTRY_MAX_BROTLI_BYTES)}`,
          });
        }
      }
    }
  } finally {
    report = {
      generatedAt: new Date().toISOString(),
      distScanned: scanned,
      entry: {
        file: entryFile,
        bytes,
        brotliBytes,
        maxBytes: ENTRY_MAX_BYTES,
        maxBrotliBytes: ENTRY_MAX_BROTLI_BYTES,
      },
      assetsJsBytes,
      findings,
      ok: findings.length === 0,
    };
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(
      join(root, 'reports', 'app-shell-bundle.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  return report;
}

if (import.meta.main) {
  const rootIdx = process.argv.indexOf('--root');
  const root = rootIdx === -1 ? '.' : (process.argv[rootIdx + 1] ?? '.');
  const report = runCheckSeams(root);
  console.log('check:seams');
  console.log(`  dist files scanned : ${String(report.distScanned)}`);
  console.log(
    `  entry chunk        : ${report.entry.file ?? '(none)'} ${String(report.entry.bytes)} B min, ${String(report.entry.brotliBytes)} B brotli`,
  );
  for (const f of report.findings) console.log(`  FAIL ${f.rule} ${f.file}: ${f.detail}`);
  console.log(`  result             : ${report.ok ? 'PASS' : 'FAIL'}`);
  if (!report.ok) process.exitCode = 1;
}
