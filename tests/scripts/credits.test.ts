/** docs/CREDITS.md equals the text generated from assets-provenance.json (SR-G-22). */
import { readFileSync } from 'node:fs';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { creditsFromRepo, renderCredits } from '../../scripts/assets/credits.ts';

describe('credits', () => {
  it('the committed docs/CREDITS.md is the generated text', async () => {
    const generated = await format(creditsFromRepo(), { parser: 'markdown' });
    expect(readFileSync('docs/CREDITS.md', 'utf8')).toBe(generated);
  });

  it('groups files by author, source and licence', () => {
    const text = renderCredits([
      {
        path: 'a',
        origin: 'cc0',
        licence: 'CC0-1.0',
        author: 'X',
        source: 'https://polyhaven.com/a/a',
      },
      {
        path: 'b',
        origin: 'cc0',
        licence: 'CC0-1.0',
        author: 'X',
        source: 'https://polyhaven.com/a/a',
      },
    ]);
    expect(text).toContain('| X | https://polyhaven.com/a/a | CC0-1.0 | `a`, `b` |');
  });
});
