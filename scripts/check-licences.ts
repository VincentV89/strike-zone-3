/**
 * check:licences — licence, pinning, asset, secret and dist checks
 * (story-licence-asset-audit; security-design SD-F-01..10; BR-F-37..40).
 *
 * Runs four phases in one process and always runs all of them:
 *   1. dependencies: lockfile, exact pins, registry source + integrity, SPDX licences
 *   2. assets: every binary asset is attested in assets-provenance.json
 *   3. source secret and policy scan (filesystem walk, no git)
 *   4. dist/ scan (secret rules, VITE_, index.html shape, eval / new Function in assets JS)
 *
 * Offline: reads files only. Writes reports/licences.json in a `finally`
 * block on every run and exits 1 when any phase has a failure.
 *
 * Usage: node scripts/check-licences.ts [--require-dist] [--root <dir>]
 * Runs under Node 24 native type stripping, so only erasable syntax is used.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import parseSpdx, { type SpdxNode } from 'spdx-expression-parse';
import satisfies from 'spdx-satisfies';

export const ALLOWED_LICENCES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'ISC',
];

const WALK_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-test', // app-shell test bundle (SD-AS-03), never deployed
  'cdk.out',
  'coverage',
  'reports',
  '.kiro-data',
  '.aidlc',
  '.kiro', // runtime-owned agent harness config, like .aidlc
]);
const SECRET_IGNORED_DIRS = new Set(['.aws']);
const ASSET_EXTENSIONS = new Set(
  'png jpg jpeg gif webp bmp ktx2 basis hdr exr glb gltf fbx obj dae wav mp3 ogg flac m4a ttf otf woff woff2 wasm'.split(
    ' ',
  ),
);
const REQUIRED_IGNORE_LINES = [
  'node_modules/',
  'dist/',
  'dist-test/',
  'cdk.out/',
  'coverage/',
  '.kiro-data/',
  '.env*',
  '*.pem',
  '.aws/',
  'cdk.context.json',
];
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TRUSTED_REGISTRY = 'https://registry.npmjs.org/';
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export interface SecretRule {
  id: string;
  pattern: RegExp;
  distOnly: boolean;
}

// Patterns are assembled from fragments so this file never contains a
// literal the scanner would flag (SD-F-04).
export const SECRET_RULES: readonly SecretRule[] = [
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, distOnly: false },
  {
    id: 'aws-secret-key-name',
    pattern: new RegExp('aws_secret' + '_access_key', 'i'),
    distOnly: false,
  },
  {
    id: 'aws-session-token-name',
    pattern: new RegExp('aws_session' + '_token', 'i'),
    distOnly: false,
  },
  {
    id: 'private-key-header',
    pattern: new RegExp('-----BEGIN [A-Z ]*' + 'PRIVATE KEY-----'),
    distOnly: false,
  },
  { id: 'vite-env-var', pattern: new RegExp('VITE' + '_'), distOnly: true },
];

export interface Failure {
  phase: 1 | 2 | 3 | 4;
  rule: string;
  detail: string;
}

export interface LicenceFinding {
  name: string;
  version: string;
  licence: string | null;
  ok: boolean;
  reason?: string;
}

export interface SecretFinding {
  rule: string;
  file: string;
  line: number;
  preview: string;
}

export interface Report {
  checkedAt: string;
  allowedLicences: string[];
  productionPackageCount: number;
  packages: LicenceFinding[];
  assets: { path: string; attested: boolean }[];
  secrets: SecretFinding[];
  policy: { rule: string; detail: string }[];
  dist: {
    scanned: boolean;
    reason?: string;
    findings: { rule: string; file: string; line: number }[];
  };
  skipped: { binary: number; oversize: number };
  failures: Failure[];
  error?: string;
}

interface LockEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: unknown;
  licenses?: unknown;
  dev?: boolean;
  devOptional?: boolean;
  link?: boolean;
  inBundle?: boolean;
}

function emptyReport(): Report {
  return {
    checkedAt: new Date().toISOString(),
    allowedLicences: ALLOWED_LICENCES,
    productionPackageCount: 0,
    packages: [],
    assets: [],
    secrets: [],
    policy: [],
    dist: { scanned: false, findings: [] },
    skipped: { binary: 0, oversize: 0 },
    failures: [],
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function maskPreview(match: string): string {
  return `${match.slice(0, 4)}****`;
}

// ---------------------------------------------------------------- phase 1

function hasException(node: SpdxNode): boolean {
  if ('license' in node) return node.exception !== undefined;
  return hasException(node.left) || hasException(node.right);
}

/** Evaluates an SPDX expression against the allowlist (BR-F-37). */
export function evaluateLicence(expression: string | null): { ok: boolean; reason?: string } {
  if (expression === null || expression.trim() === '')
    return { ok: false, reason: 'licence-unknown' };
  const text = expression.trim();
  if (/^UNLICENSED$/i.test(text) || /^SEE LICEN[CS]E IN/i.test(text)) {
    return { ok: false, reason: 'licence-not-allowed' };
  }
  let parsed: SpdxNode;
  try {
    parsed = parseSpdx(text);
  } catch {
    return { ok: false, reason: 'licence-unknown' };
  }
  if (hasException(parsed)) return { ok: false, reason: 'licence-exception' };
  return satisfies(text, ALLOWED_LICENCES)
    ? { ok: true }
    : { ok: false, reason: 'licence-not-allowed' };
}

function licenceOf(root: string, key: string, entry: LockEntry): string | null {
  if (typeof entry.license === 'string') return entry.license;
  const pkgPath = join(root, key, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    if (isRecord(pkg)) {
      if (typeof pkg['license'] === 'string') return pkg['license'];
      const legacy = pkg['licenses'];
      if (Array.isArray(legacy) && legacy.length > 0) {
        const types = legacy.map((l) =>
          isRecord(l) && typeof l['type'] === 'string' ? l['type'] : null,
        );
        if (types.every((t) => t !== null)) {
          return types.length === 1 ? (types[0] ?? null) : `(${types.join(' OR ')})`;
        }
      }
    }
  }
  return null;
}

function checkPins(root: string, report: Report): void {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    report.failures.push({
      phase: 1,
      rule: 'package-json-missing',
      detail: 'package.json not found',
    });
    return;
  }
  const pkg = readJson(pkgPath);
  if (!isRecord(pkg)) return;
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = pkg[field];
    if (!isRecord(deps)) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || !EXACT_SEMVER.test(spec)) {
        report.failures.push({
          phase: 1,
          rule: 'unpinned',
          detail: `${field} ${name}@${String(spec)}`,
        });
      }
    }
  }
}

function packageNameOf(key: string): string {
  const idx = key.lastIndexOf('node_modules/');
  return idx === -1 ? key : key.slice(idx + 'node_modules/'.length);
}

function checkLockEntry(root: string, key: string, entry: LockEntry, report: Report): void {
  const name = packageNameOf(key);
  const version = entry.version ?? '?';
  // Bundled dependencies ship inside their parent's tarball, which carries the integrity hash.
  const sourceChecked = entry.inBundle !== true;
  if (
    sourceChecked &&
    (!entry.resolved?.startsWith(TRUSTED_REGISTRY) || !entry.integrity?.startsWith('sha512-'))
  ) {
    report.failures.push({
      phase: 1,
      rule: 'untrusted-source',
      detail: `${name}@${version} resolved=${entry.resolved ?? 'none'}`,
    });
  }
  if (entry.dev === true || entry.devOptional === true) return;
  report.productionPackageCount += 1;
  const licence = licenceOf(root, key, entry);
  const verdict = evaluateLicence(licence);
  const finding: LicenceFinding = { name, version, licence, ok: verdict.ok };
  if (verdict.reason !== undefined) finding.reason = verdict.reason;
  report.packages.push(finding);
  if (!verdict.ok) {
    report.failures.push({
      phase: 1,
      rule: verdict.reason ?? 'licence-not-allowed',
      detail: `${name}@${version} licence=${licence ?? 'none'}`,
    });
  }
}

function phaseDependencies(root: string, report: Report): void {
  checkPins(root, report);
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) {
    report.failures.push({
      phase: 1,
      rule: 'lockfile-missing',
      detail: 'package-lock.json not found',
    });
    return;
  }
  const lock = readJson(lockPath);
  if (!isRecord(lock) || lock['lockfileVersion'] !== 3 || !isRecord(lock['packages'])) {
    report.failures.push({
      phase: 1,
      rule: 'lockfile-missing',
      detail: 'lockfileVersion 3 with packages required',
    });
    return;
  }
  for (const [key, raw] of Object.entries(lock['packages'])) {
    if (key === '' || !isRecord(raw)) continue;
    const entry = raw as LockEntry;
    if (entry.link === true) continue;
    checkLockEntry(root, key, entry, report);
  }
}

// ---------------------------------------------------------------- walking

interface WalkOptions {
  skipSecretIgnored: boolean;
}

function isSecretIgnoredFile(name: string): boolean {
  return name.startsWith('.env') || name.endsWith('.pem');
}

function walk(root: string, dir: string, opts: WalkOptions, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (stat.isDirectory()) {
      if (WALK_EXCLUDED_DIRS.has(name)) continue;
      if (opts.skipSecretIgnored && SECRET_IGNORED_DIRS.has(name)) continue;
      walk(root, full, opts, out);
    } else if (stat.isFile()) {
      if (opts.skipSecretIgnored && isSecretIgnoredFile(name)) continue;
      out.push(toPosix(relative(root, full)));
    }
  }
  return out;
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

// ---------------------------------------------------------------- phase 2

function readProvenance(root: string, report: Report): Map<string, boolean> | null {
  const path = join(root, 'assets-provenance.json');
  let data: unknown;
  try {
    data = readJson(path);
  } catch {
    data = null;
  }
  if (!Array.isArray(data)) {
    report.policy.push({
      rule: 'provenance-file-invalid',
      detail: 'assets-provenance.json must be a JSON array',
    });
    report.failures.push({
      phase: 2,
      rule: 'provenance-file-invalid',
      detail: 'assets-provenance.json',
    });
    return null;
  }
  const attested = new Map<string, boolean>();
  for (const e of data) {
    if (!isRecord(e) || typeof e['path'] !== 'string') continue;
    attested.set(toPosix(e['path']), provenanceEntryValid(e));
  }
  return attested;
}

/** CC0 sources must come from these hosts, matched on the parsed hostname (SR-G-20). */
export const CC0_HOSTS: readonly string[] = [
  'polyhaven.com',
  'ambientcg.com',
  'kenney.nl',
  'quaternius.com',
];

/**
 * ProvenanceEntry v2 (BR-G-80, RULE CHANGE): `original` or `procedural` with an author, or
 * `cc0` with licence CC0-1.0, an author and an https source on an allow-listed host.
 */
export function provenanceEntryValid(e: Record<string, unknown>): boolean {
  const origin = e['origin'];
  const author = e['author'];
  if (typeof author !== 'string' || author.trim() === '') return false;
  if (origin === 'original' || origin === 'procedural') return true;
  if (origin !== 'cc0' || e['licence'] !== 'CC0-1.0' || typeof e['source'] !== 'string')
    return false;
  let url: URL;
  try {
    url = new URL(e['source']);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^www\./, '');
  return url.protocol === 'https:' && CC0_HOSTS.includes(host);
}

function phaseAssets(root: string, report: Report): void {
  const attested = readProvenance(root, report) ?? new Map<string, boolean>();
  const files = walk(root, root, { skipSecretIgnored: false }, []);
  const seen = new Set<string>();
  for (const file of files) {
    if (!ASSET_EXTENSIONS.has(extensionOf(file))) continue;
    seen.add(file);
    const ok = attested.get(file) === true;
    report.assets.push({ path: file, attested: ok });
    if (!ok) report.failures.push({ phase: 2, rule: 'asset-unattested', detail: file });
  }
  // Parity (SR-G-20): an entry whose file is gone is stale.
  for (const path of attested.keys()) {
    if (!seen.has(path))
      report.failures.push({ phase: 2, rule: 'provenance-orphan', detail: path });
  }
}

// ---------------------------------------------------------------- phases 3 and 4

function readText(full: string, report: Report): string | null {
  const size = statSync(full).size;
  if (size > MAX_TEXT_BYTES) {
    report.skipped.oversize += 1;
    return null;
  }
  const buf = readFileSync(full);
  if (buf.subarray(0, 8192).includes(0)) {
    report.skipped.binary += 1;
    return null;
  }
  return buf.toString('utf8');
}

function scanText(
  text: string,
  includeDistOnly: boolean,
): { rule: string; line: number; preview: string }[] {
  const hits: { rule: string; line: number; preview: string }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, i) => {
    for (const rule of SECRET_RULES) {
      if (rule.distOnly && !includeDistOnly) continue;
      const m = rule.pattern.exec(lineText);
      if (m !== null) hits.push({ rule: rule.id, line: i + 1, preview: maskPreview(m[0]) });
    }
  });
  return hits;
}

function checkIgnoreFile(root: string, report: Report): void {
  const path = join(root, '.gitignore');
  const lines = existsSync(path)
    ? new Set(
        readFileSync(path, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim()),
      )
    : new Set<string>();
  for (const required of REQUIRED_IGNORE_LINES) {
    if (lines.has(required)) continue;
    report.policy.push({ rule: 'ignore-entry-missing', detail: required });
    report.failures.push({
      phase: 3,
      rule: 'ignore-entry-missing',
      detail: `.gitignore lacks ${required}`,
    });
  }
}

function phaseSourceScan(root: string, report: Report): void {
  checkIgnoreFile(root, report);
  for (const file of walk(root, root, { skipSecretIgnored: true }, [])) {
    const text = readText(join(root, file), report);
    if (text === null) continue;
    for (const hit of scanText(text, false)) {
      report.secrets.push({ ...hit, file });
      report.failures.push({
        phase: 3,
        rule: hit.rule,
        detail: `${file}:${String(hit.line)} ${hit.preview}`,
      });
    }
  }
}

/** Text checks on dist/index.html (SEC-F-12). */
export function htmlShapeFindings(html: string): { rule: string; line: number }[] {
  const out: { rule: string; line: number }[] = [];
  html.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    for (const m of text.matchAll(/<script\b[^>]*>/gi)) {
      if (!/\bsrc\s*=/i.test(m[0])) out.push({ rule: 'inline-script', line });
    }
    if (/<style\b/i.test(text) || /\sstyle\s*=/i.test(text))
      out.push({ rule: 'inline-style', line });
    if (/\s(?:src|href)\s*=\s*["']?(?:https?:|\/\/)/i.test(text))
      out.push({ rule: 'external-resource', line });
    if (/\son[a-z]+\s*=/i.test(text)) out.push({ rule: 'inline-handler', line });
  });
  return out;
}

/**
 * Dynamic-code checks on bundled JavaScript (security-design-presentation-3d
 * SEC-P-03): the CSP has no 'unsafe-eval', so eval( or new Function in
 * dist/assets/*.js would break at runtime and is a failure.
 */
const DYNAMIC_CODE_RULES: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'dist-eval', pattern: /\beval\s*\(/ },
  { rule: 'dist-new-function', pattern: /\bnew\s+Function\b/ },
];

export function dynamicCodeFindings(js: string): { rule: string; line: number }[] {
  const out: { rule: string; line: number }[] = [];
  js.split(/\r?\n/).forEach((text, i) => {
    for (const r of DYNAMIC_CODE_RULES) {
      if (r.pattern.test(text)) out.push({ rule: r.rule, line: i + 1 });
    }
  });
  return out;
}

function phaseDist(root: string, requireDist: boolean, report: Report): void {
  const distDir = join(root, 'dist');
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    report.dist = { scanned: false, reason: 'dist-missing', findings: [] };
    if (requireDist) {
      report.failures.push({
        phase: 4,
        rule: 'dist-missing',
        detail: 'dist/ not found; run npm run build',
      });
    } else {
      console.warn(
        'check:licences: dist/ not found, phase 4 skipped (pass --require-dist to fail)',
      );
    }
    return;
  }
  report.dist = { scanned: true, findings: [] };
  const files = walk(distDir, distDir, { skipSecretIgnored: false }, []);
  for (const rel of files) {
    const file = `dist/${rel}`;
    const text = readText(join(distDir, rel), report);
    if (text === null) continue;
    const hits = [
      ...scanText(text, true),
      ...(rel === 'index.html' ? htmlShapeFindings(text).map((h) => ({ ...h, preview: '' })) : []),
      ...(/^assets\/[^/]+\.js$/.test(rel)
        ? dynamicCodeFindings(text).map((h) => ({ ...h, preview: '' }))
        : []),
    ];
    for (const hit of hits) {
      report.dist.findings.push({ rule: hit.rule, file, line: hit.line });
      report.failures.push({ phase: 4, rule: hit.rule, detail: `${file}:${String(hit.line)}` });
    }
  }
}

// ---------------------------------------------------------------- driver

export interface RunOptions {
  root: string;
  requireDist: boolean;
  reportPath?: string;
}

function runPhase(phase: Failure['phase'], report: Report, body: () => void): void {
  try {
    body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.failures.push({ phase, rule: 'phase-error', detail: message });
  }
}

/** Runs every phase, always writes the report, and returns it. */
export function runChecks(opts: RunOptions): Report {
  const root = resolve(opts.root);
  const reportPath = opts.reportPath ?? join(root, 'reports', 'licences.json');
  const report = emptyReport();
  try {
    runPhase(1, report, () => {
      phaseDependencies(root, report);
    });
    runPhase(2, report, () => {
      phaseAssets(root, report);
    });
    runPhase(3, report, () => {
      phaseSourceScan(root, report);
    });
    runPhase(4, report, () => {
      phaseDist(root, opts.requireDist, report);
    });
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.failures.push({ phase: 1, rule: 'checker-error', detail: report.error });
  } finally {
    mkdirSync(join(reportPath, '..'), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function printSummary(report: Report): void {
  console.log('check:licences');
  console.log(`  production packages : ${String(report.productionPackageCount)}`);
  for (const p of report.packages) {
    console.log(`    ${p.ok ? 'ok  ' : 'FAIL'} ${p.name}@${p.version}  ${p.licence ?? '(none)'}`);
  }
  console.log(`  assets checked      : ${String(report.assets.length)}`);
  console.log(`  secret findings     : ${String(report.secrets.length)}`);
  console.log(
    `  dist scanned        : ${String(report.dist.scanned)}${report.dist.reason ? ` (${report.dist.reason})` : ''}`,
  );
  console.log(
    `  skipped files       : binary ${String(report.skipped.binary)}, oversize ${String(report.skipped.oversize)}`,
  );
  if (report.failures.length === 0) {
    console.log('  result              : PASS');
    return;
  }
  console.log(`  result              : FAIL (${String(report.failures.length)})`);
  for (const f of report.failures)
    console.log(`    phase ${String(f.phase)} ${f.rule}: ${f.detail}`);
}

function parseArgs(argv: readonly string[]): RunOptions {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx !== -1 ? (argv[rootIdx + 1] ?? '.') : '.';
  return { root, requireDist: argv.includes('--require-dist') };
}

if (import.meta.main) {
  const report = runChecks(parseArgs(process.argv.slice(2)));
  printSummary(report);
  if (report.failures.length > 0) process.exitCode = 1;
}
