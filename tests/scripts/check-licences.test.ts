import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateLicence,
  dynamicCodeFindings,
  htmlShapeFindings,
  runChecks,
  type Report,
} from '../../scripts/check-licences.ts';

const GOOD_IGNORE = [
  'node_modules/',
  'dist/',
  'dist-test/',
  'cdk.out/',
  'coverage/',
  'reports/',
  '.kiro-data/',
  '.env*',
  '*.pem',
  '.aws/',
  'cdk.context.json',
].join('\n');

const CLEAN_HTML =
  '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-abc.css">' +
  '<script type="module" crossorigin src="/assets/index-abc.js"></script></head>' +
  '<body><div id="app"></div></body></html>';

interface LockPackage {
  version: string;
  license?: string;
  dev?: boolean;
  resolved?: string;
  integrity?: string;
}

interface Fixture {
  deps?: Record<string, string>;
  devDeps?: Record<string, string>;
  lock?: Record<string, LockPackage> | null;
  gitignore?: string;
  provenance?: string;
  files?: Record<string, string>;
  distHtml?: string | null;
}

const roots: string[] = [];

function lockEntry(name: string, p: LockPackage): Record<string, unknown> {
  return {
    version: p.version,
    resolved: p.resolved ?? `https://registry.npmjs.org/${name}/-/${name}-${p.version}.tgz`,
    integrity: p.integrity ?? 'sha512-AAAA',
    ...(p.license === undefined ? {} : { license: p.license }),
    ...(p.dev === true ? { dev: true } : {}),
  };
}

function makeRepo(fx: Fixture = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'sz-licences-'));
  roots.push(root);
  const write = (rel: string, text: string): void => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  };
  const deps = fx.deps ?? { three: '0.187.0' };
  write(
    'package.json',
    JSON.stringify({ name: 'fx', dependencies: deps, devDependencies: fx.devDeps ?? {} }),
  );
  const lockPkgs =
    fx.lock === undefined ? { three: { version: '0.187.0', license: 'MIT' } } : fx.lock;
  if (lockPkgs !== null) {
    const packages: Record<string, unknown> = { '': { name: 'fx' } };
    for (const [name, p] of Object.entries(lockPkgs))
      packages[`node_modules/${name}`] = lockEntry(name, p);
    write('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages }));
  }
  write('.gitignore', fx.gitignore ?? GOOD_IGNORE);
  write('assets-provenance.json', fx.provenance ?? '[]');
  for (const [rel, text] of Object.entries(fx.files ?? {})) write(rel, text);
  if (fx.distHtml !== null) write('dist/index.html', fx.distHtml ?? CLEAN_HTML);
  return root;
}

function run(root: string, requireDist = true): Report {
  return runChecks({ root, requireDist });
}

function rules(report: Report): string[] {
  return report.failures.map((f) => f.rule);
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('evaluateLicence', () => {
  it.each([
    ['MIT', true],
    ['(MIT OR GPL-3.0)', true],
    ['(MIT AND Apache-2.0)', true],
    ['(MIT AND GPL-3.0)', false],
    ['GPL-3.0', false],
  ])('%s -> %s', (expr, ok) => {
    expect(evaluateLicence(expr).ok).toBe(ok);
  });

  it('rejects exceptions, UNLICENSED, SEE LICENSE IN and missing licences', () => {
    expect(evaluateLicence('Apache-2.0 WITH LLVM-exception').reason).toBe('licence-exception');
    expect(evaluateLicence('UNLICENSED').ok).toBe(false);
    expect(evaluateLicence('SEE LICENSE IN LICENSE.txt').ok).toBe(false);
    expect(evaluateLicence(null).reason).toBe('licence-unknown');
    expect(evaluateLicence('not a licence (').reason).toBe('licence-unknown');
  });
});

describe('check:licences phase 1 (dependencies)', () => {
  it('passes a clean repo and writes the report', () => {
    const root = makeRepo();
    const report = run(root);
    expect(report.failures).toEqual([]);
    expect(report.productionPackageCount).toBe(1);
    expect(report.dist.scanned).toBe(true);
    expect(existsSync(join(root, 'reports/licences.json'))).toBe(true);
  });

  it('fails a GPL production dependency and still writes the report (QS-SEC-1, SEC-F-17)', () => {
    const root = makeRepo({
      deps: { three: '0.187.0', gpl: '1.0.0' },
      lock: {
        three: { version: '0.187.0', license: 'MIT' },
        gpl: { version: '1.0.0', license: 'GPL-3.0' },
      },
    });
    const report = run(root);
    expect(rules(report)).toEqual(['licence-not-allowed']);
    const written = JSON.parse(readFileSync(join(root, 'reports/licences.json'), 'utf8')) as Report;
    expect(written.packages.find((p) => p.name === 'gpl')?.ok).toBe(false);
  });

  it('ignores the licence of dev dependencies', () => {
    const root = makeRepo({
      devDeps: { tool: '2.0.0' },
      lock: {
        three: { version: '0.187.0', license: 'MIT' },
        tool: { version: '2.0.0', license: 'GPL-3.0', dev: true },
      },
    });
    expect(run(root).failures).toEqual([]);
  });

  it('falls back to node_modules package.json and fails a missing licence', () => {
    const fallback = makeRepo({
      lock: { three: { version: '0.187.0' } },
      files: { 'node_modules/three/package.json': JSON.stringify({ license: 'MIT' }) },
    });
    expect(run(fallback).failures).toEqual([]);
    const missing = makeRepo({ lock: { three: { version: '0.187.0' } } });
    expect(rules(run(missing))).toEqual(['licence-unknown']);
  });

  it('fails UNLICENSED, a caret range, a missing lockfile and a git source (SEC-F-02)', () => {
    expect(
      rules(run(makeRepo({ lock: { three: { version: '0.187.0', license: 'UNLICENSED' } } }))),
    ).toEqual(['licence-not-allowed']);
    expect(rules(run(makeRepo({ deps: { three: '^0.187.0' } })))).toEqual(['unpinned']);
    expect(rules(run(makeRepo({ lock: null })))).toEqual(['lockfile-missing']);
    const gitSourced = makeRepo({
      lock: {
        three: {
          version: '0.187.0',
          license: 'MIT',
          resolved: 'git+ssh://git@example.com/three.git',
        },
      },
    });
    expect(rules(run(gitSourced))).toEqual(['untrusted-source']);
  });
});

describe('check:licences phase 2 (assets)', () => {
  it('fails an unattested binary asset and passes an attested one (QS-SEC-5)', () => {
    const unlisted = makeRepo({ files: { 'public/boom.wav': 'RIFF' } });
    expect(rules(run(unlisted))).toEqual(['asset-unattested']);
    const listed = makeRepo({
      files: { 'public/boom.wav': 'RIFF' },
      provenance: JSON.stringify([
        { path: 'public/boom.wav', origin: 'procedural', author: 'StrikeZone team' },
      ]),
    });
    expect(run(listed).failures).toEqual([]);
  });

  it('fails an invalid provenance file', () => {
    expect(rules(run(makeRepo({ provenance: '{}' })))).toEqual(['provenance-file-invalid']);
  });
});

describe('check:licences phase 3 (secrets and policy)', () => {
  // Secret-shaped strings are built at runtime so no tracked file contains one (SD-F-04).
  const fakeKeyId = 'AK' + 'IA' + 'Q'.repeat(16);

  it('finds an access key id and masks it in the report (QS-SEC-3, SD-F-05)', () => {
    const root = makeRepo({ files: { 'src/config.ts': `export const id = '${fakeKeyId}';\n` } });
    const report = run(root);
    expect(rules(report)).toEqual(['aws-access-key-id']);
    expect(report.secrets).toEqual([
      { rule: 'aws-access-key-id', file: 'src/config.ts', line: 1, preview: 'AKIA****' },
    ]);
    expect(readFileSync(join(root, 'reports/licences.json'), 'utf8')).not.toContain(fakeKeyId);
  });

  it('finds secret key names and private key headers', () => {
    const root = makeRepo({
      files: {
        'notes.txt': `${'aws_secret' + '_access_key'} = x\n${'-----BEGIN RSA ' + 'PRIVATE KEY-----'}\n`,
      },
    });
    expect(rules(run(root)).sort()).toEqual(['aws-secret-key-name', 'private-key-header']);
  });

  it('skips .env files but fails when .gitignore lacks a required entry (SD-F-03)', () => {
    const root = makeRepo({
      gitignore: GOOD_IGNORE.replace('.env*\n', ''),
      files: { '.env.local': `KEY=${fakeKeyId}\n` },
    });
    const report = run(root);
    expect(rules(report)).toEqual(['ignore-entry-missing']);
    expect(report.policy).toEqual([{ rule: 'ignore-entry-missing', detail: '.env*' }]);
  });

  it('skips binary files and counts them', () => {
    const root = makeRepo({ files: { 'blob.bin': `\u0000${fakeKeyId}` } });
    const report = run(root);
    expect(report.failures).toEqual([]);
    expect(report.skipped.binary).toBe(1);
  });
});

describe('check:licences phase 4 (dist)', () => {
  it('fails a missing dist only with --require-dist (SD-F-08)', () => {
    const root = makeRepo({ distHtml: null });
    expect(rules(run(root, true))).toEqual(['dist-missing']);
    const relaxed = run(root, false);
    expect(relaxed.failures).toEqual([]);
    expect(relaxed.dist).toEqual({ scanned: false, reason: 'dist-missing', findings: [] });
  });

  it('fails an inline script and VITE_ text in the bundle (SEC-F-09, SEC-F-12)', () => {
    const root = makeRepo({
      distHtml: CLEAN_HTML.replace('</body>', '<script>alert(1)</script></body>'),
      files: { 'dist/assets/index.js': `const k = "${'VITE' + '_X'}";` },
    });
    expect(rules(run(root)).sort()).toEqual(['inline-script', 'vite-env-var']);
  });

  it('flags inline styles, handlers and external resources in index.html', () => {
    const found = htmlShapeFindings(
      '<div style="x"></div>\n<img src="https://cdn.example/x.png">\n<body onload="f()">\n<style>a{}</style>',
    ).map((f) => f.rule);
    expect(found).toEqual(['inline-style', 'external-resource', 'inline-handler', 'inline-style']);
    expect(htmlShapeFindings(CLEAN_HTML)).toEqual([]);
  });

  it('fails eval( and new Function in dist/assets/*.js only (SEC-P-03)', () => {
    const root = makeRepo({
      files: {
        'dist/assets/index.js': 'const a = 1;\nconst f = new Function("return 1");\n',
        'dist/assets/other.js': 'x = eval ("1");',
        'dist/notes.txt': 'eval(1) is only checked in bundled JavaScript',
      },
    });
    expect(rules(run(root)).sort()).toEqual(['dist-eval', 'dist-new-function']);
    expect(dynamicCodeFindings('retrieval(1); obj.evaluate(2); newFunction()')).toEqual([]);
  });
});
