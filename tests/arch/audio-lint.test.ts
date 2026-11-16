/**
 * Probes for the audio ESLint blocks (security-design-audio SD-AU-04). The
 * inherited-ban assertions catch the flat-config override trap: if a block
 * drops a spread list, they fail.
 */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
const PROBE = 'src/audio/__probe__.ts';
const CONTEXT = 'src/audio/context.ts';

async function messages(
  code: string,
  filePath: string,
): Promise<{ ruleId: string; line: number }[]> {
  const [result] = await eslint.lintText(code, { filePath });
  const msgs = result?.messages ?? [];
  const fatal = msgs.find((m) => m.fatal === true);
  if (fatal !== undefined) throw new Error(`ESLint could not parse the probe: ${fatal.message}`);
  return msgs.map((m) => ({ ruleId: m.ruleId ?? 'unknown', line: m.line }));
}

/** Lints each line as its own probe and returns the rule ids that fired. */
async function rulesPerLine(lines: readonly string[], filePath: string): Promise<string[][]> {
  const body = [
    'export async function probe(ctx: BaseAudioContext, el: HTMLElement): Promise<unknown> {',
    ...lines.map((l) => `  ${l}`),
    '  return el;',
    '}',
    '',
  ].join('\n');
  const found = await messages(body, filePath);
  return lines.map((_, i) => found.filter((m) => m.line === i + 2).map((m) => m.ruleId));
}

describe('audio lint Block A (src/audio/**)', () => {
  const banned: [string, string][] = [
    ["el.innerHTML = 'x';", 'no-restricted-properties'],
    ['void (import.meta.env.VITE_X as unknown);', 'no-restricted-syntax'],
    ["await fetch('/x');", 'no-restricted-globals'],
    ['void new Audio();', 'no-restricted-globals'],
    ['void Date.now();', 'no-restricted-globals'],
    ['setTimeout(() => undefined, 1);', 'no-restricted-globals'],
    ['void performance.now();', 'no-restricted-globals'],
    ['void Math.random();', 'no-restricted-properties'],
    ["globalThis.addEventListener('x', () => undefined);", 'no-restricted-globals'],
    ['void window;', 'no-restricted-globals'],
    ['void navigator.mediaDevices;', 'no-restricted-globals'],
    ['void ctx.createAnalyser();', 'no-restricted-properties'],
    ['void ctx.decodeAudioData(new ArrayBuffer(1));', 'no-restricted-properties'],
    ['void (ctx as AudioContext).audioWorklet;', 'no-restricted-properties'],
    ['void new OfflineAudioContext(1, 1, 8000);', 'no-restricted-globals'],
    ["console.log('x');", 'no-console'],
    ["await import('x');", 'no-restricted-syntax'],
  ];

  it('rejects every banned construct, including the inherited foundation bans', async () => {
    const ids = await rulesPerLine(
      banned.map(([line]) => line),
      PROBE,
    );
    banned.forEach(([line, rule], i) => {
      expect({ line, fired: ids[i]?.includes(rule) ?? false }).toEqual({ line, fired: true });
    });
  });

  it('keeps the src/** DOM test-library import ban', async () => {
    const found = await messages("import 'happy-dom';\nexport {};\n", PROBE);
    expect(found.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });
});

describe('audio lint Block B (src/audio/context.ts)', () => {
  it('accepts globalThis.AudioContext', async () => {
    const found = await messages(
      "export function make(): AudioContext {\n  return new globalThis.AudioContext();\n}\nexport const has = (): boolean => 'AudioContext' in globalThis;\n",
      CONTEXT,
    );
    expect(found).toEqual([]);
  });

  it('rejects any other globalThis member and still bans innerHTML', async () => {
    const lines = [
      "await globalThis.fetch('/x');",
      "globalThis.localStorage.setItem('a', 'b');",
      "el.innerHTML = 'x';",
      "await fetch('/x');",
    ];
    const ids = await rulesPerLine(lines, CONTEXT);
    expect(ids[0]).toContain('no-restricted-syntax');
    expect(ids[1]).toContain('no-restricted-syntax');
    expect(ids[2]).toContain('no-restricted-properties');
    expect(ids[3]).toContain('no-restricted-globals');
  });
});
