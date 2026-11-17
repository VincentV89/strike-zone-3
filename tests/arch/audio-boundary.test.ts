/**
 * The audio input boundary (SD-AU-03): audio may name only event, intent,
 * settings and weapon types from contracts, and only types from settings.
 * SimSnapshot, BotView, RadarContact and PlayerView are rejected by name, so
 * no later edit can feed hidden bot state into sound.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ALLOWED_CONTRACTS = new Set([
  'SimEvent',
  'UiIntent',
  'SettingsIntent',
  'WeaponId',
  'Settings',
]);
const FORBIDDEN = ['SimSnapshot', 'BotView', 'RadarContact', 'PlayerView'];

interface NamedImport {
  file: string;
  specifier: string;
  names: string[];
  typeOnly: boolean;
}

function importsOf(file: string, text: string): NamedImport[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const out: NamedImport[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
    const mod = st.moduleSpecifier;
    if (mod === undefined || !ts.isStringLiteral(mod)) continue;
    const names: string[] = [];
    let typeOnly: boolean;
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      typeOnly = clause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        const elements = bindings.elements;
        for (const el of elements) names.push((el.propertyName ?? el.name).text);
        if (!typeOnly && elements.length > 0 && elements.every((el) => el.isTypeOnly))
          typeOnly = true;
      }
    } else {
      typeOnly = st.isTypeOnly;
      const clause = st.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const el of clause.elements) names.push((el.propertyName ?? el.name).text);
      }
    }
    out.push({ file, specifier: mod.text, names, typeOnly });
  }
  return out;
}

const DIR = 'src/audio';
const all = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts'))
  .flatMap((f) => importsOf(f, readFileSync(join(DIR, f), 'utf8')));

describe('audio input boundary (SD-AU-03)', () => {
  it('imports only allowlisted names from contracts', () => {
    const fromContracts = all.filter((i) => i.specifier.startsWith('../contracts'));
    expect(fromContracts.length).toBeGreaterThan(0);
    for (const i of fromContracts) {
      for (const n of i.names)
        expect({ file: i.file, name: n, ok: ALLOWED_CONTRACTS.has(n) }).toMatchObject({ ok: true });
      expect(i.typeOnly).toBe(true);
    }
  });

  it('never names snapshot, bot or radar types anywhere in src/audio', () => {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith('.ts'))) {
      const text = readFileSync(join(DIR, f), 'utf8');
      for (const name of FORBIDDEN)
        expect({ f, name, found: new RegExp(`\\b${name}\\b`).test(text) }).toMatchObject({
          found: false,
        });
    }
  });

  it('imports settings only as types through src/settings/index.ts', () => {
    for (const i of all.filter((x) => x.specifier.startsWith('../settings'))) {
      expect(i.specifier === '../settings' || i.specifier === '../settings/index').toBe(true);
      expect(i.typeOnly).toBe(true);
    }
  });

  it('imports nothing outside core, contracts, settings and its own folder', () => {
    for (const i of all) {
      expect(/^(\.\/|\.\.\/(core|contracts|settings)(\/|$))/.test(i.specifier)).toBe(true);
    }
  });
});
