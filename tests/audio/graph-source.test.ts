/**
 * Source rules (SD-AU-01, SD-AU-07): only buildGraph reads the destination,
 * and only noise.ts calls getChannelData.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = 'src/audio';
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ name: f, text: readFileSync(join(DIR, f), 'utf8') }));

/** Code with line and block comments removed, so prose does not count. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const count = (text: string, token: RegExp): number => (code(text).match(token) ?? []).length;

describe('audio source rules', () => {
  it('reads ctx.destination only inside buildGraph in engine.ts', () => {
    for (const f of files) {
      const n = count(f.text, /\bdestination\b/g);
      if (f.name === 'context.ts') {
        // The AudioContextLike declaration only.
        expect(n).toBe(1);
      } else if (f.name === 'engine.ts') {
        const body = code(f.text);
        const start = body.indexOf('function buildGraph(');
        const end = body.indexOf('\n}\n', start);
        expect(start).toBeGreaterThan(-1);
        const inside = (body.slice(start, end).match(/\bdestination\b/g) ?? []).length;
        expect(inside).toBe(n);
        expect(n).toBe(1);
      } else {
        expect({ file: f.name, n }).toEqual({ file: f.name, n: 0 });
      }
    }
  });

  it('calls getChannelData only in noise.ts, as a write target', () => {
    for (const f of files) {
      const calls = count(f.text, /getChannelData\(/g);
      if (f.name === 'noise.ts') expect(calls).toBe(1);
      else if (f.name === 'context.ts')
        expect(calls).toBe(1); // AudioBufferLike declaration
      else expect({ file: f.name, calls }).toEqual({ file: f.name, calls: 0 });
    }
    const noise = code(files.find((f) => f.name === 'noise.ts')?.text ?? '');
    expect(noise).toMatch(/data\[i\] = /);
    expect(noise).not.toMatch(/= data\[/);
  });

  it('keeps context.ts the only reader of globalThis', () => {
    for (const f of files) {
      const n = count(f.text, /\bglobalThis\b/g);
      if (f.name === 'context.ts') expect(n).toBeGreaterThan(0);
      else expect({ file: f.name, n }).toEqual({ file: f.name, n: 0 });
    }
  });
});
