/**
 * Trust-boundary parsing of SZ_SKIP_WEB_BUILD and SZ_WEB_DIR
 * (security-design-hosting-infra, "Input Validation").
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseWebSource, REPO_ROOT, resolveWebDir } from '../../infra/lib/config.ts';
import { FIXTURE_DIR } from './synth.ts';

const scratch = mkdtempSync(path.join(tmpdir(), 'sz-config-'));
const emptyDir = path.join(scratch, 'empty');
const fakeRoot = path.join(scratch, 'root');
mkdirSync(emptyDir);
mkdirSync(path.join(fakeRoot, 'dist'), { recursive: true });
writeFileSync(path.join(fakeRoot, 'dist', 'index.html'), '<!doctype html>');
const aFile = path.join(scratch, 'file.txt');
writeFileSync(aFile, 'x');

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('infra config', () => {
  it('resolves REPO_ROOT to the directory holding cdk.json', () => {
    expect(existsSync(path.join(REPO_ROOT, 'cdk.json'))).toBe(true);
    expect(path.isAbsolute(REPO_ROOT)).toBe(true);
    expect(FIXTURE_DIR.startsWith(REPO_ROOT)).toBe(true);
  });

  it('defaults to build mode when SZ_SKIP_WEB_BUILD is unset or empty', () => {
    expect(parseWebSource({})).toEqual({ mode: 'build' });
    expect(parseWebSource({ SZ_SKIP_WEB_BUILD: '' })).toEqual({ mode: 'build' });
  });

  it('uses <root>/dist in prebuilt mode when SZ_WEB_DIR is unset', () => {
    expect(parseWebSource({ SZ_SKIP_WEB_BUILD: '1' }, fakeRoot)).toEqual({
      mode: 'prebuilt',
      webDir: path.join(fakeRoot, 'dist'),
    });
  });

  it('uses SZ_WEB_DIR, resolved to an absolute path', () => {
    const relative = path.relative(process.cwd(), FIXTURE_DIR);
    expect(parseWebSource({ SZ_SKIP_WEB_BUILD: '1', SZ_WEB_DIR: relative })).toEqual({
      mode: 'prebuilt',
      webDir: FIXTURE_DIR,
    });
  });

  it.each(['true', '0', 'yes', ' 1'])(
    'rejects SZ_SKIP_WEB_BUILD=%j with infra/invalid-skip-web-build',
    (value) => {
      expect(() => parseWebSource({ SZ_SKIP_WEB_BUILD: value })).toThrow(
        'infra/invalid-skip-web-build',
      );
    },
  );

  it('rejects a web dir that is missing, a file, or has no index.html', () => {
    for (const dir of [path.join(scratch, 'nope'), aFile, emptyDir]) {
      expect(() => resolveWebDir(dir)).toThrow('infra/web-dir-missing');
    }
    expect(() => parseWebSource({ SZ_SKIP_WEB_BUILD: '1' }, scratch)).toThrow(
      'infra/web-dir-missing',
    );
  });
});
