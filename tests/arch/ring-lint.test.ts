/**
 * Ring-lint and hygiene probes (story-walking-skeleton AC4, QS-SEC-4).
 * Fixtures are linted with lintText at virtual paths, so they never exist
 * as real files under src/.
 */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  const messages = result?.messages ?? [];
  const fatal = messages.find((m) => m.fatal === true);
  if (fatal !== undefined) throw new Error(`ESLint could not parse the probe: ${fatal.message}`);
  return messages.map((m) => m.ruleId ?? 'unknown');
}

describe('ESLint ring rules', () => {
  it('fails a sim-ring file that imports three and touches document', async () => {
    const ids = await ruleIds(
      "import * as THREE from 'three';\nexport const t = document.title + String(THREE.REVISION);\n",
      'src/core/__probe__.ts',
    );
    expect(ids).toContain('no-restricted-imports');
    expect(ids).toContain('no-restricted-globals');
  });

  it('fails Math.random and Date in the sim ring', async () => {
    const ids = await ruleIds(
      'export const r = Math.random();\nexport const d = Date.now();\n',
      'src/core/__probe__.ts',
    );
    expect(ids).toContain('no-restricted-properties');
    expect(ids).toContain('no-restricted-globals');
  });

  it('fails a sim-ring relative import into an adapter directory', async () => {
    const ids = await ruleIds(
      "export { start } from '../app/main';\nexport { x } from '../ui/hud/vitals';\n",
      'src/core/__probe__.ts',
    );
    expect(ids.filter((id) => id === 'no-restricted-imports')).toHaveLength(2);
  });

  it('passes clean kernel-style code in the sim ring', async () => {
    expect(
      await ruleIds('export const half = (x: number): number => x / 2;\n', 'src/core/__probe__.ts'),
    ).toEqual([]);
  });
});

describe('ESLint browser hygiene rules (all of src/)', () => {
  it('fails innerHTML and eval in adapter code', async () => {
    const ids = await ruleIds(
      "export function f(el: HTMLElement, x: string): void {\n  el.innerHTML = x;\n  eval('1');\n}\n",
      'src/app/__probe__.ts',
    );
    expect(ids).toContain('no-restricted-properties');
    expect(ids).toContain('no-eval');
  });

  it('fails import.meta.env reads other than MODE, DEV and PROD', async () => {
    const ids = await ruleIds(
      'export const a = import.meta.env.VITE_SECRET as unknown;\nexport const b = import.meta.env.DEV;\n',
      'src/app/__probe__.ts',
    );
    expect(ids.filter((id) => id === 'no-restricted-syntax')).toHaveLength(1);
  });

  it('allows three in the adapter ring', async () => {
    expect(
      await ruleIds(
        "import { Scene } from 'three';\nexport const s = new Scene();\n",
        'src/app/__probe__.ts',
      ),
    ).toEqual([]);
  });
});

describe('ESLint map-data block (SD-M-01, SD-M-02)', () => {
  const probe = 'src/maps/__probe__.ts';
  const cases: [string, string][] = [
    ["export const a = fetch('x');\n", 'no-restricted-globals'],
    ["export const a = globalThis.fetch('x');\n", 'no-restricted-globals'],
    ["export const a = JSON.parse('{}') as unknown;\n", 'no-restricted-properties'],
    ['export const a = structuredClone({});\n', 'no-restricted-globals'],
    ["export const a = import('./x');\n", 'no-restricted-syntax'],
    // Inherited bans that a careless override would drop.
    ['export const a = Date.now();\n', 'no-restricted-globals'],
    ['export const a = Math.random();\n', 'no-restricted-properties'],
    ['export const a = setTimeout(() => 0);\n', 'no-restricted-globals'],
    [
      "export function f(el: { innerHTML: string }): void {\n  el.innerHTML = '';\n}\n",
      'no-restricted-properties',
    ],
    ['export const a = import.meta.env.VITE_X as unknown;\n', 'no-restricted-syntax'],
  ];

  it.each(cases)('rejects %j with exactly one %s error', async (code, rule) => {
    const ids = await ruleIds(code, probe);
    expect(ids.filter((id) => id === rule)).toHaveLength(1);
  });

  it('keeps the sim-ring import bans for src/maps', async () => {
    const ids = await ruleIds(
      "import { Scene } from 'three';\nexport const s = new Scene();\n",
      probe,
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('passes plain map data', async () => {
    expect(await ruleIds("export const M = { id: 'x', solids: [] as const };\n", probe)).toEqual(
      [],
    );
  });
});

describe('sim-ring network and global bans in physics and nav (SD-CN-01, SD-CN-02)', () => {
  const cases: [string, string][] = [
    ["export const a = fetch('x');\n", 'no-restricted-globals'],
    ['export const a = globalThis;\n', 'no-restricted-globals'],
    ['export const a = self;\n', 'no-restricted-globals'],
    ['export const a = new WebSocket(String(1));\n', 'no-restricted-globals'],
    ['export const a = Date.now();\n', 'no-restricted-globals'],
    ['export const a = Math.random();\n', 'no-restricted-properties'],
    ['export const a = setTimeout(() => 0);\n', 'no-restricted-globals'],
    ['export const a = performance.now();\n', 'no-restricted-globals'],
    [
      "export function f(el: { innerHTML: string }): void {\n  el.innerHTML = '';\n}\n",
      'no-restricted-properties',
    ],
    ['export const a = import.meta.env.VITE_X as unknown;\n', 'no-restricted-syntax'],
    ["import { Scene } from 'three';\nexport const s = new Scene();\n", 'no-restricted-imports'],
  ];

  // player-combat probes reuse this loop and its typed program (SD-PC-02).
  for (const probe of [
    'src/physics/__probe__.ts',
    'src/nav/__probe__.ts',
    'src/sim/player/__probe__.ts',
    'src/weapons/__probe__.ts',
    'src/combat/__probe__.ts',
    // bot-ai probes (SD-AI-05)
    'src/ai/perception/__probe__.ts',
    'src/ai/locomotion/__probe__.ts',
    'src/ai/brain/__probe__.ts',
    // game-simulation and match-stats probes (TS-GS-09, SD-GS-08)
    'src/sim/__probe__.ts',
    'src/sim/stats/__probe__.ts',
  ]) {
    it.each(cases)(`rejects %j in ${probe} with exactly one %s error`, async (code, rule) => {
      const ids = await ruleIds(code, probe);
      expect(ids.filter((id) => id === rule)).toHaveLength(1);
    });

    it(`passes plain geometry code in ${probe}`, async () => {
      expect(
        await ruleIds(
          'export const len = (x: number, z: number): number => Math.hypot(x, z);\n',
          probe,
        ),
      ).toEqual([]);
    });
  }

  it('still rejects fetch in src/maps after the move, now with the sim-ring message', async () => {
    const [result] = await eslint.lintText("export const a = fetch('x');\n", {
      filePath: 'src/maps/__probe__.ts',
    });
    const messages = (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-globals');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('SEC-CN-01');
  });
});
