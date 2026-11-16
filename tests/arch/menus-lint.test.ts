/**
 * Lint probes for menus-settings (SEC-MS-01, -02, -08, -10; SD-MS-03, -06).
 * Each probe also checks that inherited foundation bans still fire, which
 * catches the flat-config override trap.
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

const count = (ids: string[], id: string): number => ids.filter((x) => x === id).length;

const UI_PROBES = [
  'src/ui/__probe__.ts',
  'src/ui/screens/__probe__.ts',
  'src/ui/components/__probe__.ts',
];

describe.each(UI_PROBES)('UI attribute bans at %s', (path) => {
  it('rejects style, on* and computed setAttribute names, and keeps innerHTML and env bans', async () => {
    const ids = await ruleIds(
      [
        'export function f(el: HTMLElement, n: string): void {',
        "  el.setAttribute('style', 'color:red');",
        "  el.setAttribute('onclick', 'x()');",
        "  el.setAttribute(n, 'x');",
        "  el.setAttributeNS(null, 'style', 'x');",
        "  el.innerHTML = '<b>';",
        '}',
        'export const v = import.meta.env.VITE_X as unknown;',
        '',
      ].join('\n'),
      path,
    );
    expect(count(ids, 'no-restricted-syntax')).toBe(5);
    expect(ids).toContain('no-restricted-properties');
  });

  it('allows literal safe attributes', async () => {
    const ids = await ruleIds(
      "export function f(el: HTMLElement): void {\n  el.setAttribute('aria-label', 'x');\n}\n",
      path,
    );
    expect(ids).toEqual([]);
  });
});

describe.each([
  'src/ui/screens/__probe__.ts',
  'src/ui/components/__probe__.ts',
  'src/persistence/__probe__.ts',
])('menus-settings bans at %s', (path) => {
  it('rejects network, storage, timers, listeners, import() and inherited bans', async () => {
    const ids = await ruleIds(
      [
        "export const a = fetch('/x');",
        "export const b = localStorage.getItem('k');",
        "export const c = window.localStorage.getItem('k');",
        'export const d = setTimeout(() => undefined, 1);',
        "export const e = navigator.sendBeacon('/x');",
        "document.addEventListener('keydown', () => undefined);",
        "export const g = import('./x');",
        "document.write('x');",
        '',
      ].join('\n'),
      path,
    );
    expect(count(ids, 'no-restricted-globals')).toBe(3); // fetch, localStorage, setTimeout
    expect(count(ids, 'no-restricted-properties')).toBe(3); // window.localStorage, sendBeacon, document.write
    expect(count(ids, 'no-restricted-syntax')).toBe(2); // addEventListener, import()
  });

  it('rejects test DOM library imports (SEC-MS-10)', async () => {
    const ids = await ruleIds(
      "import { Window } from 'happy-dom';\nexport const w = new Window();\n",
      path,
    );
    expect(ids).toContain('no-restricted-imports');
  });
});

describe('JSON.parse placement', () => {
  it('is banned in screens and components', async () => {
    for (const path of ['src/ui/screens/__probe__.ts', 'src/ui/components/__probe__.ts']) {
      const ids = await ruleIds("export const x: unknown = JSON.parse('1');\n", path);
      expect(ids).toEqual(['no-restricted-properties']);
    }
  });

  it('is allowed in persistence', async () => {
    expect(
      await ruleIds("export const x: unknown = JSON.parse('1');\n", 'src/persistence/__probe__.ts'),
    ).toEqual([]);
  });
});

describe('sim ring keeps its import bans', () => {
  it('rejects three and happy-dom in src/core', async () => {
    const ids = await ruleIds(
      "import { Scene } from 'three';\nimport { Window } from 'happy-dom';\nexport const s = [Scene, Window];\n",
      'src/core/__probe__.ts',
    );
    expect(count(ids, 'no-restricted-imports')).toBe(2);
  });
});
