import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../../src/audio';
import { defaultContextFactory, isWebAudioSupported } from '../../src/audio/context';
import { recordingDiagnostics } from './fixtures';

describe('defaultContextFactory (SD-AU-04)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports no support and returns null in Node, where AudioContext is absent', () => {
    expect(isWebAudioSupported()).toBe(false);
    expect(defaultContextFactory()).toBeNull();
  });

  it('constructs AudioContext with an interactive latency hint when present', () => {
    const made: unknown[] = [];
    vi.stubGlobal('AudioContext', function FakeAudioContext(opts: unknown): void {
      made.push(opts);
    });
    expect(isWebAudioSupported()).toBe(true);
    expect(defaultContextFactory()).not.toBeNull();
    expect(made).toEqual([{ latencyHint: 'interactive' }]);
    expect(createAudioEngine({ diagnostics: recordingDiagnostics() }).supported).toBe(true);
  });

  it('returns null when the constructor throws', () => {
    vi.stubGlobal('AudioContext', function ThrowingAudioContext(): void {
      throw new Error('NotSupportedError');
    });
    expect(defaultContextFactory()).toBeNull();
  });
});
