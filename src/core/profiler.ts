import type { Diagnostics } from './diagnostics';

export type ProfileSection =
  | 'sim'
  | 'player'
  | 'physics'
  | 'ai-sense'
  | 'ai-decide'
  | 'locomotion'
  | 'nav'
  | 'combat'
  | 'render-submit'
  | 'hud'
  | 'audio';

export const PROFILE_SECTIONS = [
  'sim',
  'player',
  'physics',
  'ai-sense',
  'ai-decide',
  'locomotion',
  'nav',
  'combat',
  'render-submit',
  'hud',
  'audio',
] as const satisfies readonly ProfileSection[];

export interface SectionStats {
  meanMsPerFrame: number;
  maxMsPerFrame: number;
  totalMs: number;
  calls: number;
}

export interface ProfileReport {
  frames: number;
  /** Timings include nested sections (BR-F-17). */
  inclusive: true;
  sections: Record<ProfileSection, SectionStats>;
}

export interface Profiler {
  begin(s: ProfileSection): void;
  end(s: ProfileSection): void;
  /** Closes the current frame (FD-F-04). */
  endFrame(): void;
  report(): ProfileReport;
  reset(): void;
}

interface SectionState {
  openAt: number | null;
  frameMs: number;
  totalMs: number;
  maxFrameMs: number;
  calls: number;
}

/**
 * Frame-budget profiler. `now` is injected (milliseconds), so `src/core`
 * touches no global clock. Misuse is counted, never thrown.
 */
export function createProfiler(now: () => number, diagnostics?: Diagnostics): Profiler {
  const state = new Map<ProfileSection, SectionState>();
  let frames = 0;

  const resetAll = (): void => {
    frames = 0;
    for (const s of PROFILE_SECTIONS) {
      state.set(s, { openAt: null, frameMs: 0, totalMs: 0, maxFrameMs: 0, calls: 0 });
    }
  };
  resetAll();

  const get = (s: ProfileSection): SectionState => state.get(s) as SectionState;

  return {
    begin(s) {
      const st = get(s);
      if (st.openAt !== null) {
        diagnostics?.count('core/profiler-reentrant');
        return;
      }
      st.openAt = now();
    },
    end(s) {
      const st = get(s);
      if (st.openAt === null) {
        diagnostics?.count('core/profiler-unbalanced');
        return;
      }
      st.frameMs += now() - st.openAt;
      st.openAt = null;
      st.calls += 1;
    },
    endFrame() {
      for (const st of state.values()) {
        st.totalMs += st.frameMs;
        st.maxFrameMs = Math.max(st.maxFrameMs, st.frameMs);
        st.frameMs = 0;
      }
      frames += 1;
    },
    report() {
      const sections = {} as Record<ProfileSection, SectionStats>;
      for (const s of PROFILE_SECTIONS) {
        const st = get(s);
        sections[s] = {
          meanMsPerFrame: frames === 0 ? 0 : st.totalMs / frames,
          maxMsPerFrame: st.maxFrameMs,
          totalMs: st.totalMs,
          calls: st.calls,
        };
      }
      return { frames, inclusive: true, sections };
    },
    reset: resetAll,
  };
}
