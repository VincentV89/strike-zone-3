import { describe, expect, it } from 'vitest';
import type { SettingsIntent, SimEvent, UiIntent } from '../../src/contracts';
import { createRequestPool, cueForIntent, mapEvents, uiRecipe } from '../../src/audio/mapping';
import { CUE_IDS } from '../../src/audio/recipes';
import type { CueId, UiCue } from '../../src/audio/types';
import { DEFAULT_SETTINGS, SPEC_KEYS } from '../../src/settings';
import { damage, impact, kill, noise, phase, shot, weapon } from './fixtures';

function cues(events: SimEvent[]): CueId[] {
  const pool = createRequestPool();
  const n = mapEvents(events, pool);
  return pool.slice(0, n).map((r) => r.cue);
}

describe('mapEvents table (business-rules-audio)', () => {
  const rows: [string, SimEvent, CueId[]][] = [
    ['player rifle shot', shot(0, 'rifle'), ['fire-rifle']],
    ['player pistol shot', shot(0, 'pistol'), ['fire-pistol']],
    ['player sniper shot', shot(0, 'sniper'), ['fire-sniper']],
    ['bot rifle shot', shot(3, 'rifle'), ['bot-fire-rifle']],
    ['bot pistol shot', shot(3, 'pistol'), ['bot-fire-pistol']],
    ['bot sniper shot', shot(3, 'sniper'), ['bot-fire-sniper']],
    ['player hits a bot', damage(2, 0), ['hit']],
    ['player headshots a bot', damage(2, 0, true), ['headshot']],
    ['bot damages the player', damage(0, 4), ['hurt']],
    ['bot damages a bot', damage(2, 4), []],
    ['bot killed', kill(2, 0), ['enemy-down']],
    ['player killed', kill(0, 2), []],
    ['player footstep', noise(0, 'footstep'), ['step']],
    ['bot footstep', noise(5, 'footstep'), ['bot-step']],
    ['player land', noise(0, 'land'), ['land']],
    ['bot land', noise(5, 'land'), ['bot-step']],
    ['gunfire noise', noise(5, 'gunfire'), []],
    ['player reload start', weapon(0, 'reload-start'), ['reload-start']],
    ['player reload end', weapon(0, 'reload-end'), ['reload-end']],
    ['player switch', weapon(0, 'switch'), ['switch']],
    ['player dry fire', weapon(0, 'dry-fire'), ['dry-fire']],
    ['player scope in', weapon(0, 'scope-in'), ['scope-in']],
    ['player scope out', weapon(0, 'scope-out'), ['scope-out']],
    ['bot weapon event', weapon(3, 'reload-start'), []],
    ['impact', impact(), []],
    ['countdown', phase('countdown'), []],
    ['live', phase('live'), ['round-go']],
    ['victory', phase('ended', 'victory'), ['victory']],
    ['defeat', phase('ended', 'defeat'), ['defeat']],
    ['time expired', phase('ended', 'time-expired'), ['time-up']],
    ['ended without outcome', phase('ended', null), []],
  ];
  it.each(rows)('%s', (_name, event, expected) => {
    expect(cues([event])).toEqual(expected);
  });

  it('places bot fire at the shot origin and bot steps at the noise position', () => {
    const pool = createRequestPool();
    mapEvents([shot(3, 'rifle', 4, 1, -2), noise(5, 'footstep', 7, 9, 40)], pool);
    expect(pool[0]).toMatchObject({ placement: 'positional', x: 4, y: 1, z: -2, source: 3 });
    expect(pool[1]).toMatchObject({ placement: 'positional', x: 7, z: 9, maxDist: 25 });
  });

  it('caps the bot footstep cull distance at radius × 1.25 (BR-AU-43)', () => {
    const pool = createRequestPool();
    mapEvents([noise(5, 'footstep', 0, 0, 8)], pool);
    expect(pool[0]?.maxDist).toBe(10);
  });

  it('carries fromDir as the hurt direction', () => {
    const pool = createRequestPool();
    mapEvents([damage(0, 2, false, { x: -1, y: 0, z: 0.5 })], pool);
    expect(pool[0]).toMatchObject({ placement: 'directional', x: -1, z: 0.5 });
  });

  it('reports overflow beyond the pool without writing past it', () => {
    const pool = createRequestPool(4);
    const events = Array.from({ length: 10 }, (_, i) => shot(0, 'rifle', 0, 0, 0, i));
    expect(mapEvents(events, pool)).toBe(10);
    expect(pool).toHaveLength(4);
  });
});

describe('cueForIntent (BR-AU-31)', () => {
  const intents: [UiIntent, UiCue][] = [
    [
      { type: 'start-game', setup: { map: 'desert-compound', bots: 5, difficulty: 'normal' } },
      'confirm',
    ],
    [{ type: 'deploy' }, 'confirm'],
    [{ type: 'resume' }, 'confirm'],
    [{ type: 'play-again' }, 'confirm'],
    [{ type: 'restart-confirmed' }, 'confirm'],
    [{ type: 'retry-loading' }, 'confirm'],
    [{ type: 'clear-history' }, 'confirm'],
    [{ type: 'main-menu' }, 'back'],
    [{ type: 'leave-confirmed' }, 'back'],
    [{ type: 'cancel-loading' }, 'back'],
  ];
  it.each(intents)('%o -> %s', (intent, cue) => {
    expect(cueForIntent(intent)).toBe(cue);
  });

  it('ticks for every settings key', () => {
    for (const key of SPEC_KEYS) {
      const intent = { type: 'set-setting', key, value: DEFAULT_SETTINGS[key] } as SettingsIntent;
      expect(cueForIntent(intent)).toBe('tick');
    }
  });
});

describe('recipe reachability', () => {
  it('reaches every recipe from a SimEvent or a UiCue', () => {
    const fromEvents = cues([
      shot(0, 'rifle'),
      shot(0, 'pistol'),
      shot(0, 'sniper'),
      shot(1, 'rifle'),
      shot(1, 'pistol'),
      shot(1, 'sniper'),
      damage(2, 0),
      damage(2, 0, true),
      damage(0, 2),
      kill(2, 0),
      noise(0, 'footstep'),
      noise(0, 'land'),
      noise(2, 'footstep'),
      ...(
        ['reload-start', 'reload-end', 'switch', 'dry-fire', 'scope-in', 'scope-out'] as const
      ).map((k) => weapon(0, k)),
      phase('live'),
      phase('ended', 'victory'),
      phase('ended', 'defeat'),
      phase('ended', 'time-expired'),
    ]);
    const fromUi = (['confirm', 'back', 'tick', 'error'] as const).map(uiRecipe);
    expect(new Set([...fromEvents, ...fromUi])).toEqual(new Set(CUE_IDS));
  });
});
