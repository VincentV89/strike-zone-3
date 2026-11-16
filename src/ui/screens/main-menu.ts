/**
 * S1 Main Menu and match setup (story-main-menu-setup). The PLAY panel holds
 * a local draft (map, bots, difficulty) that is emitted once with
 * `start-game`. SETTINGS, CONTROLS, ABOUT and HISTORY are child screens
 * mounted lazily into the panel slot (PD-MS-04), so S1 stays mounted and the
 * draft survives panel switches.
 */
import { BOT_COUNTS, type BotCount, type Difficulty } from '../../contracts';
import { el, setHidden, setText, text, type TextHandle } from '../components/dom';
import { mapCards } from '../components/map-card';
import { menuButton } from '../components/menu-button';
import { createScope, type Scope } from '../components/scope';
import type { Emit, Screen } from '../components/screen';
import { segmentedRadio, type Segmented } from '../components/segmented-radio';
import { sideNav, type NavItem, type SideNav } from '../components/side-nav';
import { skipLink } from '../components/skip-link';
import { createAboutScreen } from './about';
import { createControlsScreen } from './controls';
import {
  DIFFICULTY_DESCRIPTIONS,
  DIFFICULTY_LABELS,
  LARGE_BATTLE_HINT,
  LARGE_BATTLE_MIN_BOTS,
  MAP_BLURBS,
  MAP_LABELS,
} from './format';
import { createHistoryScreen } from './history';
import { MAP_IDS_FOR_MENU, DIFFICULTIES_FOR_MENU } from './menu-options';
import { createSettingsScreen } from './settings';
import type { MainMenuVM, MatchSetup, MenuPanel } from './view-models';

interface Child {
  readonly panel: Exclude<MenuPanel, 'play'>;
  readonly release: () => void;
  readonly update: (vm: MainMenuVM) => void;
  readonly focusFirst: () => void;
}

export function createMainMenuScreen(): Screen<MainMenuVM> {
  let scope: Scope | null = null;
  let last: MainMenuVM | null = null;
  let draft: MatchSetup = { map: 'desert-compound', bots: 5, difficulty: 'normal' };
  let sent = false;
  let emitFn: Emit = () => undefined;
  let child: Child | null = null;
  let ui: {
    nav: SideNav<MenuPanel>;
    playPanel: HTMLElement;
    playHeading: HTMLHeadingElement;
    slot: HTMLElement;
    back: HTMLButtonElement;
    start: HTMLButtonElement;
    maps: Segmented<MatchSetup['map']>;
    bots: Segmented<BotCount>;
    difficulty: Segmented<Difficulty>;
    largeHint: HTMLParagraphElement;
    largeHintText: TextHandle;
  } | null = null;
  let panel: MenuPanel = 'play';
  let openedFrom: MenuPanel = 'play';

  function refreshLargeHint(): void {
    if (ui === null) return;
    setHidden(ui.largeHint, draft.bots < LARGE_BATTLE_MIN_BOTS);
  }

  function mountChild(p: Exclude<MenuPanel, 'play'>, vm: MainMenuVM, s: Scope): Child | null {
    if (ui === null) return null;
    const slot = ui.slot;
    switch (p) {
      case 'settings': {
        const screen = createSettingsScreen();
        return {
          panel: p,
          release: s.child(screen, slot, vm.settings, emitFn),
          update: (v) => {
            screen.update(v.settings);
          },
          focusFirst: () => {
            screen.focusFirst();
          },
        };
      }
      case 'controls': {
        const screen = createControlsScreen();
        return {
          panel: p,
          release: s.child(screen, slot, null, emitFn),
          update: () => undefined,
          focusFirst: () => {
            screen.focusFirst();
          },
        };
      }
      case 'about': {
        const screen = createAboutScreen();
        return {
          panel: p,
          release: s.child(screen, slot, { version: vm.version }, emitFn),
          update: (v) => {
            screen.update({ version: v.version });
          },
          focusFirst: () => {
            screen.focusFirst();
          },
        };
      }
      case 'history': {
        if (!vm.features.history || vm.history === undefined) return null;
        const screen = createHistoryScreen({
          onGoToSetup: () => {
            showPanel('play', true);
          },
        });
        return {
          panel: p,
          release: s.child(screen, slot, vm.history, emitFn),
          update: (v) => {
            if (v.history !== undefined) screen.update(v.history);
          },
          focusFirst: () => {
            screen.focusFirst();
          },
        };
      }
    }
  }

  function showPanel(p: MenuPanel, moveFocus: boolean): void {
    if (ui === null || scope === null || last === null) return;
    if (p === panel && (p === 'play' || child !== null)) return;
    child?.release();
    child = null;
    if (p !== 'play') {
      child = mountChild(p, last, scope);
      if (child === null) p = 'play';
    }
    if (p !== 'play') openedFrom = p;
    const previous = panel;
    panel = p;
    ui.nav.update(p);
    setHidden(ui.playPanel, p !== 'play');
    setHidden(ui.back, p === 'play');
    if (!moveFocus) return;
    if (p === 'play') {
      // Back from a panel focuses the nav item that opened it (BR-MS-45).
      if (previous !== 'play') ui.nav.focus(openedFrom);
      else ui.playHeading.focus();
    } else {
      child?.focusFirst();
    }
  }

  return {
    mount(root: HTMLElement, vm: MainMenuVM, emit: Emit): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = vm;
      emitFn = emit;
      sent = false;
      draft = { ...vm.setup };
      panel = 'play';

      const node = el('div', { cls: 'sz-menu', testId: 'main-menu' });
      let start: HTMLButtonElement | null = null;
      skipLink(s, 'Skip to Start Game', () => start, node);
      const header = el('header', { cls: 'sz-menu__header' }, node);
      el('h1', { cls: 'sz-menu__brand', text: 'STRIKEZONE' }, header);
      const items: NavItem<MenuPanel>[] = [
        { id: 'play', label: 'PLAY GAME' },
        { id: 'settings', label: 'SETTINGS' },
        { id: 'controls', label: 'CONTROLS' },
        { id: 'about', label: 'ABOUT' },
      ];
      if (vm.features.history && vm.history !== undefined)
        items.push({ id: 'history', label: 'HISTORY' });
      const body = el('div', { cls: 'sz-menu__body' }, node);
      const nav = sideNav(
        s,
        {
          items,
          active: 'play',
          label: 'Main menu',
          onSelect: (id) => {
            showPanel(id, true);
          },
        },
        body,
      );
      const main = el('main', { cls: 'sz-menu__panel' }, body);
      const back = menuButton(
        s,
        {
          label: '‹ Back',
          testId: 'main-menu-back',
          onPress: () => {
            showPanel('play', true);
          },
        },
        main,
      ).el;
      back.hidden = true;

      const playPanel = el('section', { cls: 'sz-play', testId: 'main-menu-play' }, main);
      const playHeading = el(
        'h2',
        { cls: 'sz-panel__title', text: 'MATCH SETUP', attrs: { tabindex: '-1' } },
        playPanel,
      );
      const maps = mapCards(
        s,
        {
          choices: MAP_IDS_FOR_MENU.map((id) => ({
            value: id,
            label: MAP_LABELS[id],
            blurb: MAP_BLURBS[id],
          })),
          value: draft.map,
          onChange: (v) => {
            draft = { ...draft, map: v };
          },
        },
        playPanel,
      );
      const bots = segmentedRadio<BotCount>(
        s,
        {
          legend: 'Configure CPU Enemies',
          name: 'sz-bots',
          testId: 'main-menu-bots-group',
          value: draft.bots,
          options: BOT_COUNTS.map((n) => ({
            value: n,
            label: String(n),
            testId: `main-menu-bots-${String(n)}`,
          })),
          onChange: (v) => {
            draft = { ...draft, bots: v };
            refreshLargeHint();
          },
        },
        playPanel,
      );
      const largeHint = el(
        'p',
        { cls: 'sz-play__hint', testId: 'main-menu-large-battle-hint' },
        bots.el,
      );
      const largeHintText = text(largeHint, LARGE_BATTLE_HINT);
      const difficulty = segmentedRadio<Difficulty>(
        s,
        {
          legend: 'Select Difficulty',
          name: 'sz-difficulty',
          testId: 'main-menu-difficulty-group',
          value: draft.difficulty,
          options: DIFFICULTIES_FOR_MENU.map((d) => ({
            value: d,
            label: DIFFICULTY_LABELS[d],
            testId: `main-menu-difficulty-${d}`,
          })),
          describe: (d) => DIFFICULTY_DESCRIPTIONS[d],
          onChange: (v) => {
            draft = { ...draft, difficulty: v };
          },
        },
        playPanel,
      );
      start = menuButton(
        s,
        {
          label: 'Start Game',
          variant: 'primary',
          testId: 'main-menu-start',
          onPress: () => {
            if (sent) return; // one start-game per mount (BR-MS-31)
            sent = true;
            emit({
              type: 'start-game',
              setup: { map: draft.map, bots: draft.bots, difficulty: draft.difficulty },
            });
          },
        },
        playPanel,
      ).el;
      const slot = el('div', { cls: 'sz-menu__slot', testId: 'main-menu-panel-slot' }, main);
      ui = {
        nav,
        playPanel,
        playHeading,
        slot,
        back,
        start,
        maps,
        bots,
        difficulty,
        largeHint,
        largeHintText,
      };
      refreshLargeHint();
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
      if (vm.panel !== 'play') showPanel(vm.panel, false);
    },
    update(vm: MainMenuVM): void {
      if (scope === null || ui === null || vm === last) return;
      const prev = last;
      last = vm;
      if (prev === null || vm.setup !== prev.setup) {
        draft = { ...vm.setup };
        ui.maps.update(draft.map);
        ui.bots.update(draft.bots);
        ui.difficulty.update(draft.difficulty);
        refreshLargeHint();
        setText(ui.largeHintText, LARGE_BATTLE_HINT);
      }
      child?.update(vm);
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      ui = null;
      child = null;
      last = null;
      emitFn = () => undefined;
    },
    focusFirst(): void {
      // Return to S1 focuses Start Game (BR-MS-45).
      ui?.start.focus();
    },
  };
}
