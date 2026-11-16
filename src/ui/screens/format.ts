/** Display formatting and fixed label tables. Stored strings are never shown raw (SEC-MS-04). */
import type { Difficulty, MapId, RoundOutcome } from '../../contracts';
import type { StorageStatusView } from './view-models';

/** Menu map names. map-data owns MapDefinition.name; verification compares the two. */
export const MAP_LABELS: Readonly<Record<MapId, string>> = Object.freeze({
  'desert-compound': 'Desert Compound',
  'industrial-warehouse': 'Industrial Warehouse',
});

export const MAP_BLURBS: Readonly<Record<MapId, string>> = Object.freeze({
  'desert-compound': 'Sun-baked courtyards, rooftops and long sight lines.',
  'industrial-warehouse': 'Tight aisles, catwalks and container cover.',
});

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = Object.freeze({
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
});

export const DIFFICULTY_DESCRIPTIONS: Readonly<Record<Difficulty, string>> = Object.freeze({
  easy: 'Slower reactions and lower accuracy. Bot health is the same on every difficulty.',
  normal: 'Steady reactions and fair accuracy. Bot health is the same on every difficulty.',
  hard: 'Fast reactions and high accuracy. Bot health is the same on every difficulty.',
});

export const OUTCOME_WORDS: Readonly<Record<RoundOutcome, string>> = Object.freeze({
  victory: 'VICTORY',
  defeat: 'DEFEAT',
  'time-expired': 'TIME EXPIRED',
});

/** Glyphs pair with the word so meaning never rests on colour (BR-MS-42). */
export const OUTCOME_GLYPHS: Readonly<Record<RoundOutcome, string>> = Object.freeze({
  victory: '▲',
  defeat: '✕',
  'time-expired': '◷',
});

export const STORAGE_FOOTER: Readonly<Record<StorageStatusView, string>> = Object.freeze({
  fresh: 'Settings are saved on this device.',
  loaded: 'Settings are saved on this device.',
  repaired: 'Some saved settings were invalid and were reset to defaults.',
  reset: 'Saved settings could not be read and were reset to defaults.',
  unavailable: 'This browser is blocking storage. Settings last until you close the tab.',
});

export const LARGE_BATTLE_HINT = 'Large battles: Low graphics is recommended.';
export const LARGE_BATTLE_MIN_BOTS = 15;

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

export function formatAccuracy(
  accuracy: number,
  shotsFired: number,
): { text: string; hint: string } {
  if (shotsFired === 0) return { text: '—', hint: 'no shots fired' };
  return { text: `${String(Math.round(accuracy * 100))}%`, hint: '' };
}

export function botName(id: number): string {
  return `Bot-${String(id).padStart(2, '0')}`;
}

export const formatSensitivity = (v: number): string => v.toFixed(2);
export const formatFov = (v: number): string => `${String(v)}°`;
export const formatPercent = (v: number): string => `${String(v)}%`;
