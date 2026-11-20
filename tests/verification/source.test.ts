/**
 * Source rules of the verification unit (SD-VE-01, 03, 05, 06, 07, 08), enforced
 * by AST because ESLint's src-only bans do not reach scripts/:
 * - only aws.ts imports child_process, and no shell is ever used
 * - only write.ts writes files
 * - no eval, new Function, dynamic import() or require()
 * - no destroy/delete/deploy/bootstrap token in any string literal
 * - classify.ts and render.ts read no env and no argv
 * - smoke.ts passes the imported hosting-infra header constants
 * - check:licences still walks docs/ and verification/
 * - the e2e server binds 127.0.0.1 only
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesUnder(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

const UNIT_FILES = [
  ...filesUnder('scripts/verification'),
  'scripts/smoke.ts',
  'scripts/report.ts',
  ...filesUnder('tests/e2e'),
  'playwright.config.ts',
].sort();

interface Facts {
  imports: string[];
  calls: string[];
  idCalls: string[];
  strings: string[];
  newFunction: boolean;
  dynamicImport: boolean;
  shellTrue: boolean;
  processReads: string[];
}

function facts(file: string): Facts {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const f: Facts = {
    imports: [],
    calls: [],
    idCalls: [],
    strings: [],
    newFunction: false,
    dynamicImport: false,
    shellTrue: false,
    processReads: [],
  };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier))
      f.imports.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) f.dynamicImport = true;
      const callee = n.expression;
      if (ts.isIdentifier(callee)) {
        f.calls.push(callee.text);
        f.idCalls.push(callee.text);
      } else if (ts.isPropertyAccessExpression(callee)) f.calls.push(callee.name.text);
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Function')
      f.newFunction = true;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) f.strings.push(n.text);
    if (
      ts.isPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'shell' &&
      n.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      f.shellTrue = true;
    }
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'process'
    ) {
      f.processReads.push(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return f;
}

const FACTS = new Map(UNIT_FILES.map((f) => [f, facts(f)]));
const get = (f: string): Facts => {
  const x = FACTS.get(f);
  if (x === undefined) throw new Error(`missing ${f}`);
  return x;
};

describe('verification source rules', () => {
  it('scans every unit file', () => {
    expect(UNIT_FILES).toContain('scripts/verification/aws.ts');
    expect(UNIT_FILES).toContain('tests/e2e/console.spec.ts');
    expect(UNIT_FILES.length).toBeGreaterThanOrEqual(17);
  });

  it('imports node:child_process only in scripts/verification/aws.ts (SD-VE-03)', () => {
    const importers = UNIT_FILES.filter((f) =>
      get(f).imports.some((i) => i === 'node:child_process' || i === 'child_process'),
    );
    expect(importers).toEqual(['scripts/verification/aws.ts']);
  });

  it('uses no shell: no exec, execSync, spawnSync or shell: true anywhere', () => {
    for (const f of UNIT_FILES) {
      const x = get(f);
      expect(x.shellTrue, f).toBe(false);
      for (const bad of ['exec', 'execSync', 'spawnSync', 'execFileSync'])
        expect(x.idCalls, `${f}: ${bad}`).not.toContain(bad);
    }
  });

  it('writes files only in scripts/verification/write.ts (SD-VE-01)', () => {
    const writers = UNIT_FILES.filter((f) =>
      get(f).calls.some((c) =>
        [
          'writeFileSync',
          'appendFileSync',
          'createWriteStream',
          'writeFile',
          'appendFile',
        ].includes(c),
      ),
    );
    expect(writers).toEqual(['scripts/verification/write.ts']);
  });

  it('has no eval, new Function, dynamic import() or require() (SD-VE-07)', () => {
    for (const f of UNIT_FILES) {
      const x = get(f);
      expect(x.idCalls, f).not.toContain('eval');
      expect(x.idCalls, f).not.toContain('require');
      expect(x.newFunction, f).toBe(false);
      expect(x.dynamicImport, f).toBe(false);
    }
  });

  it('has no destructive AWS or CDK token in any string literal (SEC-VE-11/12)', () => {
    const bad = /^(destroy|delete-stack|deploy|bootstrap|rm|iam)$|^(delete|put|create|update)-/;
    for (const f of UNIT_FILES) {
      const hits = get(f).strings.filter((s) => bad.test(s));
      expect(hits, f).toEqual([]);
    }
  });

  it('keeps every AwsCall tuple on the read-only allowlist', () => {
    const allowed = new Set([
      'sts',
      'get-caller-identity',
      '--output',
      'json',
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'CDKToolkit',
      'StrikeZone',
      'configure',
      'get',
      'region',
    ]);
    const src = readFileSync('scripts/verification/aws.ts', 'utf8');
    const union = /export type AwsCall =([\s\S]*?);\n/.exec(src)?.[1] ?? '';
    const tokens = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(tokens.length).toBeGreaterThan(10);
    for (const t of tokens) expect(allowed.has(t ?? ''), t).toBe(true);
  });

  it('classify.ts and render.ts read no process.env or process.argv (SD-VE-08)', () => {
    for (const f of ['scripts/verification/classify.ts', 'scripts/verification/render.ts']) {
      expect(get(f).processReads, f).toEqual([]);
    }
  });

  it('smoke.ts passes the imported hosting-infra header constants, not copies (BR-VE-47)', () => {
    const src = readFileSync('scripts/smoke.ts', 'utf8');
    expect(get('scripts/smoke.ts').imports).toContain('../infra/lib/policy.ts');
    expect(src).toContain('expected: { csp: CSP, permissionsPolicy: PERMISSIONS_POLICY }');
    const others = UNIT_FILES.filter(
      (f) => f !== 'scripts/smoke.ts' && get(f).imports.some((i) => i.includes('infra/')),
    );
    expect(others).toEqual([]);
  });

  it('check:licences phase 3 still walks docs/ and verification/ (SD-VE-01 defence in depth)', () => {
    const src = readFileSync('scripts/check-licences.ts', 'utf8');
    const set = /const WALK_EXCLUDED_DIRS = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? '';
    expect(set).toContain("'reports'");
    expect(set).not.toContain("'docs'");
    expect(set).not.toContain("'verification'");
  });

  it('the e2e server binds 127.0.0.1 and serves dist-test only (SD-VE-06)', () => {
    const cfg = readFileSync('playwright.config.ts', 'utf8');
    expect(cfg).toContain('--host 127.0.0.1');
    expect(cfg).toContain('--outDir dist-test');
    expect(cfg).not.toContain('0.0.0.0');
    expect(cfg).not.toMatch(/--host(?! 127\.0\.0\.1)/);
    const spec = readFileSync('tests/e2e/console.spec.ts', 'utf8');
    expect(spec).toContain("'/?seams=bypass-lock'");
    expect(spec).toContain("toBe('undefined')");
  });
});
