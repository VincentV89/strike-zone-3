/**
 * WCAG 2.x contrast computed from src/ui/tokens.css, the only token source
 * (TS-MS-03). Re-run whenever a token changes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/ui/tokens.css', 'utf8');

function token(name: string): string {
  const m = new RegExp(`--c-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (m?.[1] === undefined) throw new Error(`token --c-${name} missing`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

describe('menu contrast pairs (BR-MS-41)', () => {
  it.each([
    ['text', 'bg-0'],
    ['text', 'bg-1'],
    ['text', 'bg-2'],
    ['text-2', 'bg-0'],
    ['text-2', 'bg-1'],
    ['text-2', 'bg-2'],
    ['muted', 'bg-1'],
    ['muted', 'bg-2'],
    ['on-accent', 'accent'],
    ['danger', 'bg-1'],
    ['ok', 'bg-1'],
  ])('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['edge', 'bg-0'],
    ['edge', 'bg-1'],
    ['accent', 'bg-1'],
    ['accent', 'bg-0'],
  ])('control border or focus ring %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });

  it('matches a known reference ratio', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });
});

describe('motion (PERF-MS-12, PD-MS-07)', () => {
  const screens = readFileSync('src/ui/screens/screens.css', 'utf8');

  it('transitions only transform and opacity', () => {
    const transitions = [...screens.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1] ?? '');
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) {
      for (const part of t.split(',')) {
        expect(part.trim().split(/\s+/)[0]).toMatch(/^(opacity|transform)$/);
      }
    }
    expect(screens).not.toMatch(/@keyframes/);
  });

  it('sets the motion tokens to 0ms under prefers-reduced-motion', () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    for (const t of ['--motion-fast', '--motion-med', '--m-fast', '--m-fade']) {
      expect(block).toMatch(new RegExp(`${t}:\\s*0ms`));
    }
  });

  it('screens.css uses only tokens for colours (no raw hex)', () => {
    expect(screens).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
