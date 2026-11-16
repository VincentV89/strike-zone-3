/**
 * B4 driver (business-logic-model-bot-ai §8): a stand-in for the FSM that
 * walks each bot through a fixed goal list, advancing on arrival.
 */
import { copy, vec3, type EntityId, type Vec3 } from '../../src/core';
import type { BotIntent } from '../../src/contracts';
import type { ScriptedBrain } from './harness';

export function scriptedBrain(
  goals: Readonly<Record<number, readonly Vec3[]>>,
  opts: { loop?: boolean; speed?: 'walk' | 'run' } = {},
): ScriptedBrain & { index: (id: EntityId) => number } {
  const idx = new Map<number, number>();
  const intents = new Map<number, BotIntent>();
  const fn = (id: EntityId, self: { locomotion: string }): Readonly<BotIntent> => {
    const list = goals[id] ?? [];
    let i = idx.get(id) ?? 0;
    if (self.locomotion === 'arrived' && list.length > 0) {
      i = opts.loop === true ? (i + 1) % list.length : Math.min(i + 1, list.length - 1);
      idx.set(id, i);
    }
    const intent = intents.get(id) ?? {
      goal: null,
      avoid: null,
      speed: opts.speed ?? 'run',
      aimAt: null,
      fire: false,
      reload: false,
      crouch: false,
    };
    intents.set(id, intent);
    const g = list[i];
    intent.goal = g === undefined ? null : copy(g, intent.goal ?? vec3());
    return intent;
  };
  return Object.assign(fn, { index: (id: EntityId) => idx.get(id) ?? 0 });
}
