/**
 * HUD contrast check (design-system-mapping 2.1, accessibility-checklist,
 * SD-H-09). Recomputes the worst case from src/ui/tokens.css: every HUD text
 * colour on the bg-0 plate at its opacity, composited over a white sky.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/ui/tokens.css', 'utf8');

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (m?.[1] === undefined) throw new Error(`token --${name} missing`);
  return m[1].trim();
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m?.[1] === undefined) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('HUD plate contrast (WCAG 1.4.3)', () => {
  const alpha = Number(token('hud-plate-alpha'));
  const bg0 = rgb(token('c-bg-0'));
  const plateOverWhite = bg0.map((c) => Math.round(c * alpha + 255 * (1 - alpha))) as [
    number,
    number,
    number,
  ];

  it('keeps the plate at 88 % and in sync with --hud-plate', () => {
    expect(alpha).toBe(0.88);
    expect(token('hud-plate')).toBe('rgb(14 17 22 / 88%)');
  });

  it.each(['c-text', 'c-text-2', 'c-danger', 'c-armor', 'c-accent', 'c-ok'])(
    '%s reaches 4.5:1 on the worst-case plate',
    (name) => {
      expect(contrast(rgb(token(name)), plateOverWhite)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps --c-muted out of the HUD: it measures about 4.49:1 on the worst-case plate', () => {
    expect(contrast(rgb(token('c-muted')), plateOverWhite)).toBeLessThan(4.5);
    expect(readFileSync('src/ui/hud/hud.css', 'utf8')).not.toContain('--c-muted');
  });

  it('reproduces the measured danger value of about 4.9:1', () => {
    expect(contrast(rgb(token('c-danger')), plateOverWhite)).toBeCloseTo(4.9, 0);
  });
});
