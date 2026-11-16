/**
 * Dev profiler overlay (test bundle only). Shows frames per second and the
 * mean milliseconds of the main profiler sections, refreshed every 30
 * frames, for the manual browser check on target hardware.
 */
import type { ProfileReport, ProfileSection } from '../core';
import { OVERLAY_MARKER } from './markers';

const SECTIONS: readonly ProfileSection[] = ['sim', 'hud', 'audio', 'render-submit'];
const EVERY_FRAMES = 30;

export interface DevOverlayHost {
  onFrame(cb: () => void): () => void;
  profilerReport(): ProfileReport;
}

export function mountDevOverlay(
  doc: Document,
  root: HTMLElement,
  host: DevOverlayHost,
  now: () => number,
): () => void {
  const box = doc.createElement('pre');
  box.className = 'dev-overlay';
  box.dataset['testid'] = 'dev-overlay';
  box.dataset['marker'] = OVERLAY_MARKER;
  root.appendChild(box);
  let frames = 0;
  let since = now();
  const off = host.onFrame(() => {
    frames += 1;
    if (frames < EVERY_FRAMES) return;
    const t = now();
    const fps = (frames * 1000) / Math.max(1, t - since);
    frames = 0;
    since = t;
    const r = host.profilerReport();
    const parts = SECTIONS.map((s) => `${s} ${r.sections[s].meanMsPerFrame.toFixed(2)}`);
    box.textContent = `${fps.toFixed(0)} fps | ${parts.join(' | ')} ms`;
  });
  return () => {
    off();
    box.remove();
  };
}
