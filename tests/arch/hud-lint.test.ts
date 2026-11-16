/**
 * Probes for the hud ESLint blocks (security-design-hud SD-H-02, SD-H-03,
 * SD-H-06 and the flat-config override rule). Linted at virtual paths, so the
 * probe files never exist under src/.
 */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
const HUD = 'src/ui/hud/__probe__.ts';
const UI = 'src/ui/__probe__.ts';

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  const messages = result?.messages ?? [];
  const fatal = messages.find((m) => m.fatal === true);
  if (fatal !== undefined) throw new Error(`ESLint could not parse the probe: ${fatal.message}`);
  return messages.map((m) => m.ruleId ?? 'unknown');
}

describe('hud lint rules', () => {
  it('still rejects innerHTML and non-allowlisted env reads under src/ui/hud (override trap)', async () => {
    const ids = await ruleIds(
      'export function f(el: HTMLElement, x: string): void {\n  el.innerHTML = x;\n}\nexport const v = import.meta.env.VITE_X as unknown;\n',
      HUD,
    );
    expect(ids).toContain('no-restricted-properties');
    expect(ids).toContain('no-restricted-syntax');
  });

  it('rejects style, on* and computed attribute names in src/ui (SD-H-02)', async () => {
    const ids = await ruleIds(
      [
        'export function f(el: Element, n: string): void {',
        "  el.setAttribute('style', 'color: red');",
        "  el.setAttribute('onclick', 'x()');",
        '  el.setAttribute(n, "1");',
        "  el.setAttributeNS(null, 'style', 'x');",
        '}',
        '',
      ].join('\n'),
      UI,
    );
    expect(ids.filter((id) => id === 'no-restricted-syntax')).toHaveLength(4);
  });

  it('rejects URL attributes and cssText in src/ui/hud (SD-H-02)', async () => {
    const ids = await ruleIds(
      [
        'export function f(el: SVGElement): void {',
        "  el.setAttribute('href', '#x');",
        "  el.setAttribute('xlink:href', '#x');",
        "  el.style.cssText = 'color: red';",
        '}',
        '',
      ].join('\n'),
      HUD,
    );
    expect(ids.filter((id) => id === 'no-restricted-syntax')).toHaveLength(3);
  });

  it('rejects network, storage, timers, listeners and layout reads in src/ui/hud (SD-H-03)', async () => {
    const ids = await ruleIds(
      [
        'export async function f(el: HTMLElement): Promise<number> {',
        "  await fetch('/x');",
        "  localStorage.setItem('a', 'b');",
        '  setTimeout(() => undefined, 1);',
        '  window.requestAnimationFrame(() => undefined);',
        "  el.addEventListener('click', () => undefined);",
        '  return el.getBoundingClientRect().width + el.offsetWidth;',
        '}',
        '',
      ].join('\n'),
      HUD,
    );
    expect(ids.filter((id) => id === 'no-restricted-globals').length).toBeGreaterThanOrEqual(3);
    expect(ids.filter((id) => id === 'no-restricted-properties').length).toBeGreaterThanOrEqual(4);
  });

  it('allows literal, non-URL attributes, CSSOM custom properties and matchMedia in the hud', async () => {
    expect(
      await ruleIds(
        [
          'export function f(el: SVGElement): boolean {',
          "  el.setAttribute('viewBox', '0 0 1 1');",
          "  el.style.setProperty('--o', '0.5');",
          "  el.classList.toggle('is-visible', true);",
          "  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
          '}',
          '',
        ].join('\n'),
        HUD,
      ),
    ).toEqual([]);
  });

  it('bans DOM test libraries from src/, including the sim ring (SD-H-06)', async () => {
    const code = "import { Window } from 'happy-dom';\nexport const w = new Window();\n";
    expect(await ruleIds(code, 'src/app/__probe__.ts')).toContain('no-restricted-imports');
    expect(await ruleIds(code, 'src/core/__probe__.ts')).toContain('no-restricted-imports');
    expect(await ruleIds("export { JSDOM } from 'jsdom';\n", 'src/app/__probe__.ts')).toContain(
      'no-restricted-imports',
    );
  });
});
