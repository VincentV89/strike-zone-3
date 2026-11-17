/**
 * Trust-boundary parsing of SZ_SKIP_WEB_BUILD and SZ_WEB_DIR
 * (security-design-hosting-infra, "Input Validation").
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assertNotTestBundle,
  parseWebSource,
  REPO_ROOT,
  resolveWebDir,
} from '../../infra/lib/config.ts';
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

describe('test-bundle deploy guard (ID-AS-03)', () => {
  const testRoot = path.join(scratch, 'guard-root');
  const testDist = path.join(testRoot, 'dist-test');
  const marked = path.join(scratch, 'marked');
  const clean = path.join(scratch, 'clean');
  for (const dir of [testDist, marked, clean]) {
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  }
  writeFileSync(path.join(testDist, 'assets', 'index.js'), 'export {};');
  // Built by concatenation so this test file itself carries no marker literal.
  writeFileSync(path.join(marked, 'assets', 'index-x.js'), `window.${'__strike' + 'zone'}={};`);
  writeFileSync(path.join(clean, 'assets', 'index-x.js'), 'export {};');

  it('rejects <repo>/dist-test by path', () => {
    expect(() => resolveWebDir(testDist, testRoot)).toThrow('infra/web-dir-test-bundle');
    expect(() =>
      parseWebSource({ SZ_SKIP_WEB_BUILD: '1', SZ_WEB_DIR: testDist }, testRoot),
    ).toThrow('infra/web-dir-test-bundle');
  });

  it('rejects any directory whose assets JS contains the seam marker', () => {
    expect(() => resolveWebDir(marked)).toThrow('infra/web-dir-test-bundle');
  });

  it('accepts a clean bundle and a bundle without assets/', () => {
    expect(resolveWebDir(clean)).toBe(clean);
    expect(() => {
      assertNotTestBundle(path.join(fakeRoot, 'dist'), fakeRoot);
    }).not.toThrow();
  });
});
