/**
 * player-combat public surface (SD-PC-03, SD-PC-04, SD-PC-08): each index
 * exports exactly the documented runtime names, nothing outside the component
 * deep-imports it, combat reads weapons as types only, and the three private
 * freeze.ts copies stay byte-identical.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as combat from '../../src/combat';
import * as player from '../../src/sim/player';
import * as weapons from '../../src/weapons';

function listTs(dir: string): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listTs(p);
    return p.endsWith('.ts')
      ? [{ path: p.split('\\').join('/'), text: readFileSync(p, 'utf8') }]
      : [];
  });
}

/** Imports from outside `module` that resolve into it but not to its index. */
function deepImports(files: readonly { path: string; text: string }[], module: string): string[] {
  const bad: string[] = [];
  for (const f of files) {
    if (f.path.startsWith(`${module}/`)) continue;
    for (const ref of ts.preProcessFile(f.text, true, true).importedFiles) {
      if (!ref.fileName.startsWith('.')) continue;
      const target = posix
        .normalize(posix.join(dirname(f.path), ref.fileName))
        .replace(/\.ts$/, '');
      const inside = target === module || target.startsWith(`${module}/`);
      const isIndex = target === module || target === `${module}/index`;
      if (inside && !isIndex) bad.push(`${f.path} -> ${ref.fileName}`);
    }
  }
  return bad;
}

describe('player-combat public surface (SD-PC-04)', () => {
  it('exports exactly the documented runtime names', () => {
    expect(Object.keys(player).sort()).toEqual(
      [
        'PLAYER_TUNING',
        'createPlayerState',
        'createPlayerStepResult',
        'eyePosition',
        'stepPlayer',
      ].sort(),
    );
    expect(Object.keys(weapons).sort()).toEqual(
      [
        'WEAPON_PROFILES',
        'createFireRequest',
        'createLoadout',
        'createLoadoutView',
        'createWeaponTrigger',
        'headDamage',
        'stepWeapon',
        'toLoadoutView',
        'triggerFromInput',
        'viewKick',
      ].sort(),
    );
    expect(Object.keys(combat).sort()).toEqual(
      [
        'ARMOR_MODEL',
        'MAX_SHOT_TARGETS',
        'applyDamage',
        'createHitboxes',
        'createShotOutcome',
        'createVitals',
        'executeShot',
        'hitboxesFor',
        'resolveShot',
      ].sort(),
    );
  });

  const src = listTs('src');
  it.each(['src/sim/player', 'src/weapons', 'src/combat'])('finds no deep import into %s', (m) => {
    expect(deepImports(src, m)).toEqual([]);
  });

  it('imports weapons from combat with import type only (combat -> weapons T)', () => {
    for (const f of src.filter((x) => x.path.startsWith('src/combat/'))) {
      const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true);
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        if (!st.moduleSpecifier.text.includes('weapons')) continue;
        expect(st.importClause?.phaseModifier, f.path).toBe(ts.SyntaxKind.TypeKeyword);
      }
    }
  });

  it('keeps the three private freeze.ts copies byte-identical', () => {
    const [a, b, c] = ['src/sim/player', 'src/weapons', 'src/combat'].map((d) =>
      readFileSync(join(d, 'freeze.ts'), 'utf8'),
    );
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('uses no Map or Set iteration and no allocating array helpers on the tick path', () => {
    const hot = src.filter((x) =>
      /^src\/(sim\/player|weapons|combat)\/(step|resolve|execute|spread)\.ts$/.test(x.path),
    );
    expect(hot).toHaveLength(5);
    for (const f of hot) {
      expect(f.text, f.path).not.toMatch(/new (Map|Set)\b/);
      expect(f.text, f.path).not.toMatch(/\.forEach\(|\.map\(|\.filter\(/);
    }
  });
});
