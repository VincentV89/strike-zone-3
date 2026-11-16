/**
 * S13 end of round (story-end-of-round-screen). The word matches the outcome
 * (BR-MS-26); Time Expired is neutral and says it counts as a loss. Play Again
 * is focused and the result is announced politely.
 */
import { el, setAttr, setText, text, type TextHandle } from '../components/dom';
import { menuButton } from '../components/menu-button';
import { createScope, type Scope } from '../components/scope';
import type { Emit, Screen } from '../components/screen';
import {
  botName,
  DIFFICULTY_LABELS,
  formatAccuracy,
  formatClock,
  MAP_LABELS,
  OUTCOME_GLYPHS,
  OUTCOME_WORDS,
  roundHalfUp,
} from './format';
import type { EndOfRoundVM } from './view-models';

export function causeLine(vm: EndOfRoundVM): string {
  const left = `${String(vm.enemiesLeft)} ${vm.enemiesLeft === 1 ? 'enemy' : 'enemies'} left`;
  switch (vm.outcome) {
    case 'victory':
      return `All ${String(vm.botCount)} ${vm.botCount === 1 ? 'enemy' : 'enemies'} eliminated`;
    case 'defeat':
      return vm.killerId === null
        ? `Eliminated · ${left}`
        : `Eliminated by ${botName(vm.killerId)} · ${left}`;
    case 'time-expired':
      return `Time ran out with ${left} · counts as a loss`;
  }
}

type StatKey = 'kills' | 'headshots' | 'accuracy' | 'dealt' | 'taken' | 'deaths' | 'time' | 'left';
const STAT_LABELS: readonly [StatKey, string][] = [
  ['kills', 'Kills'],
  ['headshots', 'Headshots'],
  ['accuracy', 'Accuracy'],
  ['dealt', 'Damage dealt'],
  ['taken', 'Damage taken'],
  ['deaths', 'Deaths'],
  ['time', 'Round time'],
  ['left', 'Enemies left'],
];

export function statValues(vm: EndOfRoundVM): Record<StatKey, string> {
  const acc = formatAccuracy(vm.accuracy, vm.shotsFired);
  return {
    kills: String(vm.kills),
    headshots: String(vm.headshots),
    accuracy: acc.hint === '' ? acc.text : `${acc.text} (${acc.hint})`,
    dealt: String(roundHalfUp(vm.damageDealt)),
    taken: String(roundHalfUp(vm.damageTaken)),
    deaths: String(vm.deaths),
    time: formatClock(vm.roundTimeSec),
    left: String(vm.enemiesLeft),
  };
}

export function createEndOfRoundScreen(): Screen<EndOfRoundVM> {
  let scope: Scope | null = null;
  let last: EndOfRoundVM | null = null;
  let sent = false;
  let ui: {
    node: HTMLElement;
    glyph: TextHandle;
    word: TextHandle;
    cause: TextHandle;
    stats: Map<StatKey, TextHandle>;
    session: TextHandle;
    footer: TextHandle;
    live: TextHandle;
    playAgain: HTMLButtonElement;
  } | null = null;

  function render(vm: EndOfRoundVM): void {
    if (ui === null) return;
    setAttr(ui.node, 'data-outcome', vm.outcome);
    setText(ui.glyph, OUTCOME_GLYPHS[vm.outcome]);
    setText(ui.word, OUTCOME_WORDS[vm.outcome]);
    const cause = causeLine(vm);
    setText(ui.cause, cause);
    const values = statValues(vm);
    for (const [k, h] of ui.stats) setText(h, values[k]);
    setText(ui.session, `Session: ${String(vm.session.won)} won · ${String(vm.session.lost)} lost`);
    setText(
      ui.footer,
      `${MAP_LABELS[vm.setup.map]} · ${String(vm.setup.bots)} bots · ${DIFFICULTY_LABELS[vm.setup.difficulty]}`,
    );
    const word = OUTCOME_WORDS[vm.outcome];
    setText(ui.live, `${word.charAt(0)}${word.slice(1).toLowerCase()}. ${cause}.`);
  }

  return {
    mount(root: HTMLElement, vm: EndOfRoundVM, emit: Emit): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      sent = false;
      const node = el('main', { cls: 'sz-result', testId: 'end-of-round-screen' });
      const h1 = el('h1', { cls: 'sz-result__headline', testId: 'end-of-round-headline' }, node);
      const glyph = text(
        el('span', { cls: 'sz-result__glyph', attrs: { 'aria-hidden': 'true' } }, h1),
      );
      h1.append(document.createTextNode(' '));
      const word = text(el('span', { cls: 'sz-result__word', testId: 'end-of-round-word' }, h1));
      const cause = text(el('p', { cls: 'sz-result__cause', testId: 'end-of-round-cause' }, node));
      const dl = el('dl', { cls: 'sz-result__stats', testId: 'end-of-round-stats' }, node);
      const stats = new Map<StatKey, TextHandle>();
      for (const [k, label] of STAT_LABELS) {
        el('dt', { text: label }, dl);
        stats.set(k, text(el('dd', { cls: 'sz-num', testId: `end-of-round-stat-${k}` }, dl)));
      }
      const session = text(
        el('p', { cls: 'sz-result__session', testId: 'end-of-round-session' }, node),
      );
      const actions = el('div', { cls: 'sz-result__actions' }, node);
      const once = (intent: 'play-again' | 'main-menu'): void => {
        if (sent) return; // one navigation intent per mount (BR-MS-31)
        sent = true;
        emit({ type: intent });
      };
      const playAgain = menuButton(
        s,
        {
          label: 'Play Again',
          variant: 'primary',
          testId: 'end-of-round-play-again',
          onPress: () => {
            once('play-again');
          },
        },
        actions,
      ).el;
      menuButton(
        s,
        {
          label: 'Main Menu',
          testId: 'end-of-round-main-menu',
          onPress: () => {
            once('main-menu');
          },
        },
        actions,
      );
      const footer = text(
        el('p', { cls: 'sz-result__footer', testId: 'end-of-round-footer' }, node),
      );
      const live = text(
        el(
          'p',
          {
            cls: 'sz-visually-hidden',
            testId: 'end-of-round-live',
            attrs: { 'aria-live': 'polite' },
          },
          node,
        ),
      );
      ui = { node, glyph, word, cause, stats, session, footer, live, playAgain };
      render(vm);
      last = vm;
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: EndOfRoundVM): void {
      if (scope === null || vm === last) return;
      render(vm);
      last = vm;
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      ui = null;
      last = null;
    },
    focusFirst(): void {
      ui?.playAgain.focus();
    },
  };
}
