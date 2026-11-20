/**
 * docs/CREDITS.md generator (security-design-graphics-uplift §4, SR-G-22). Groups
 * assets-provenance.json by source. `node scripts/assets/credits.ts --write` rewrites the file;
 * tests/scripts/credits.test.ts checks the committed file equals the generated text.
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Entry {
  readonly path: string;
  readonly origin: string;
  readonly licence?: string;
  readonly author: string;
  readonly source?: string;
}

export function renderCredits(entries: readonly Entry[]): string {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = `${e.author}|${e.source ?? e.origin}|${e.licence ?? e.origin}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const rows = [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, list]) => {
      const e = list[0] as Entry;
      const files = list.map((x) => `\`${x.path}\``).join(', ');
      return `| ${e.author} | ${e.source ?? e.origin} | ${e.licence ?? e.origin} | ${files} |`;
    });
  return [
    '# Credits',
    '',
    'Generated from `assets-provenance.json` by `node scripts/assets/credits.ts --write`; do not edit.',
    'Every third-party asset is CC0 1.0 (public domain). Thank you to Poly Haven and Quaternius.',
    '',
    '| Author | Source | Licence | Files |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

export function creditsFromRepo(root = '.'): string {
  const entries = JSON.parse(readFileSync(`${root}/assets-provenance.json`, 'utf8')) as Entry[];
  return renderCredits(entries);
}

if (import.meta.main && process.argv.includes('--write')) {
  writeFileSync('docs/CREDITS.md', creditsFromRepo());
}
