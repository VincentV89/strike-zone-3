/**
 * bot-ai structure (SD-AI-01, SD-AI-05, SD-AI-06, SD-AI-10, SD-AI-14):
 * exact public surfaces, no deep imports, type-only edges, six identical
 * freeze.ts copies, the information firewall, the harness import allowlist,
 * no src -> tests import, unchanged component-table rows and no module-level
 * mutable state.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as brain from '../../src/ai/brain';
import * as locomotion from '../../src/ai/locomotion';
import * as perception from '../../src/ai/perception';
import { COMPONENTS } from './component-table';

interface SrcFile {
  path: string;
  text: string;
}

function listTs(dir: string): SrcFile[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listTs(p);
    return p.endsWith('.ts')
      ? [{ path: p.split('\\').join('/'), text: readFileSync(p, 'utf8') }]
      : [];
  });
}

const resolveRel = (from: string, spec: string): string =>
  posix.normalize(posix.join(dirname(from), spec)).replace(/\.ts$/, '');

const src = listTs('src');
const AI = ['src/ai/perception', 'src/ai/locomotion', 'src/ai/brain'];

function imports(f: SrcFile): { spec: string; typeOnly: boolean; names: string[] }[] {
  const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true);
  const out: { spec: string; typeOnly: boolean; names: string[] }[] = [];
  for (const st of sf.statements) {
    if (
      (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      const clause = ts.isImportDeclaration(st) ? st.importClause : undefined;
      const typeOnly = ts.isImportDeclaration(st)
        ? clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
          (clause?.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.name === undefined &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly))
        : st.isTypeOnly;
      const names: string[] = [];
      if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const e of clause.namedBindings.elements) names.push((e.propertyName ?? e.name).text);
      }
      out.push({ spec: st.moduleSpecifier.text, typeOnly, names });
    }
  }
  return out;
}

describe('bot-ai public surface', () => {
  it('exports exactly the documented runtime names', () => {
    expect(Object.keys(perception).sort()).toEqual(
      [
        'MAX_SENSE_RAYS',
        'PERCEPTION_CODES',
        'PERCEPTION_TUNING',
        'createPerceptionMemory',
        'sense',
        'targetPointsFor',
      ].sort(),
    );
    expect(Object.keys(locomotion).sort()).toEqual(
      [
        'LOCOMOTION_CODES',
        'LOCOMOTION_TUNING',
        'MAX_PATH_POINTS',
        'addSeparation',
        'createBotMotion',
        'releaseMotion',
        'setGoal',
        'stepBotMotion',
      ].sort(),
    );
    expect(Object.keys(brain).sort()).toEqual(
      [
        'AIM_TUNING',
        'BRAIN_CODES',
        'BRAIN_TUNING',
        'COVER_MAX_LOS',
        'COVER_RADIUS_M',
        'DIFFICULTY_PROFILES',
        'MAX_BOTS',
        'MAX_COVER_POINTS',
        'RETREAT_PROBES',
        'SEARCH_MAX_VISITED',
        'collectPatrolNodes',
        'createAiScheduler',
        'createBotAim',
        'createBotBrain',
        'createBrainScratch',
        'createCoverRegistry',
        'getDifficultyProfile',
        'stepBotAim',
      ].sort(),
    );
  });

  it.each(AI)('finds no deep import into %s from other src files', (m) => {
    const bad: string[] = [];
    for (const f of src) {
      if (f.path.startsWith(`${m}/`)) continue;
      for (const i of imports(f)) {
        if (!i.spec.startsWith('.')) continue;
        const t = resolveRel(f.path, i.spec);
        if ((t === m || t.startsWith(`${m}/`)) && t !== m && t !== `${m}/index`)
          bad.push(`${f.path} -> ${i.spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('brain reads perception and weapons as types only (T edges, SD-AI-11)', () => {
    for (const f of src.filter((x) => x.path.startsWith('src/ai/brain/'))) {
      for (const i of imports(f)) {
        if (i.spec.includes('perception') || i.spec.includes('weapons'))
          expect(i.typeOnly, `${f.path} ${i.spec}`).toBe(true);
      }
    }
  });

  it('keeps the six private freeze.ts copies byte-identical (SD-AI-10)', () => {
    const dirs = ['src/sim/player', 'src/weapons', 'src/combat', ...AI];
    const [first, ...rest] = dirs.map((d) => readFileSync(join(d, 'freeze.ts'), 'utf8'));
    for (const r of rest) expect(r).toBe(first);
  });

  it('keeps live player data out of brain and locomotion (SD-AI-01)', () => {
    const banned = ['SenseInput', 'SimSnapshot', 'PlayerView', 'BotView', 'RadarContact'];
    for (const f of src.filter((x) => /^src\/ai\/(brain|locomotion)\//.test(x.path))) {
      for (const i of imports(f)) {
        for (const n of i.names) expect(banned, `${f.path} imports ${n}`).not.toContain(n);
        expect(i.spec).not.toMatch(/(^|\/)sim(\/|$)/);
      }
    }
  });

  it('has no module-level mutable state and no allocating helpers on the tick path', () => {
    for (const f of src.filter((x) => x.path.startsWith('src/ai/'))) {
      const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true);
      for (const st of sf.statements) {
        if (ts.isVariableStatement(st)) {
          expect(
            st.declarationList.flags & ts.NodeFlags.Const,
            `${f.path}: top-level let/var`,
          ).toBeTruthy();
        }
      }
    }
    const hot = src.filter((x) =>
      /^src\/ai\/(perception\/sense|locomotion\/(motion|separation|watchdog)|brain\/(aim|cover|search|fsm))\.ts$/.test(
        x.path,
      ),
    );
    expect(hot).toHaveLength(8);
    for (const f of hot) {
      expect(f.text, f.path).not.toMatch(/\.forEach\(|\.filter\(|\bnew (Map|Set)\b/);
    }
  });
});

describe('bot-ai test code stays out of src (SD-AI-14)', () => {
  it('limits harness imports to the allowlist (BR-AI-92)', () => {
    const allowed = [
      /^\.\.\/\.\.\/src\/(core|contracts)$/,
      /^\.\.\/\.\.\/src\/(maps|physics|nav|weapons|combat)$/,
      /^\.\.\/\.\.\/src\/ai\/(perception|locomotion|brain)$/,
      /^\.\/counting$/,
      /^node:perf_hooks$/,
    ];
    const harness = {
      path: 'tests/ai/harness.ts',
      text: readFileSync('tests/ai/harness.ts', 'utf8'),
    };
    const specs = imports(harness).map((i) => i.spec);
    expect(specs.length).toBeGreaterThan(5);
    for (const s of specs)
      expect(
        allowed.some((a) => a.test(s)),
        s,
      ).toBe(true);
    expect(specs.some((s) => s.includes('src/sim'))).toBe(false);
  });

  it('no src file imports from tests/', () => {
    for (const f of src) {
      for (const i of imports(f)) {
        if (i.spec.startsWith('.'))
          expect(resolveRel(f.path, i.spec).startsWith('tests/'), f.path).toBe(false);
      }
    }
  });

  it('leaves the bot-ai component-table rows unchanged (SD-AI-06)', () => {
    const rows = Object.fromEntries(
      COMPONENTS.filter((c) => c.id.startsWith('bot-')).map((c) => [c.id, c.deps]),
    );
    expect(rows).toEqual({
      'bot-perception': { 'core-kernel': 'R', contracts: 'T', 'collision-world': 'R' },
      'bot-locomotion': {
        'core-kernel': 'R',
        contracts: 'T',
        'collision-world': 'R',
        navigation: 'R',
      },
      'bot-brain': {
        'core-kernel': 'R',
        contracts: 'T',
        'bot-perception': 'T',
        navigation: 'R',
        'collision-world': 'R',
        weapons: 'T',
      },
    });
  });
});
