/**
 * S14 Match history (Could, story-match-history). Newest first. Rows are
 * rebuilt only when the entries array changes, in one replaceChildren call;
 * each row is tr + 6 td and the result glyph comes from CSS (PERF-MS-07).
 * Only enum-matched labels are displayed, never stored strings (SEC-MS-04).
 */
import type { HistoryEntry } from '../../contracts';
import { el, setAttr, setHidden, setText, text, type TextHandle } from '../components/dom';
import { inlineConfirm, type InlineConfirm } from '../components/inline-confirm';
import { menuButton } from '../components/menu-button';
import { createScope, type Scope } from '../components/scope';
import type { Emit, Screen } from '../components/screen';
import { DIFFICULTY_LABELS, formatAccuracy, MAP_LABELS, OUTCOME_WORDS } from './format';
import type { HistoryVM } from './view-models';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export interface HistoryScreenOptions {
  /** Called by the empty state's "Go to Match Setup" when hosted in S1. */
  readonly onGoToSetup?: () => void;
}

function row(e: HistoryEntry): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const cells = [
    DATE_FORMAT.format(new Date(Date.parse(e.endedAt))),
    OUTCOME_WORDS[e.outcome],
    MAP_LABELS[e.map],
    `${String(e.bots)} · ${DIFFICULTY_LABELS[e.difficulty]}`,
    String(e.kills),
    // History stores no shot count; 0 accuracy shows as 0%.
    formatAccuracy(e.accuracy, 1).text,
  ];
  cells.forEach((c, i) => {
    const td = el('td', { text: c }, tr);
    if (i === 1) td.dataset['outcome'] = e.outcome;
  });
  return tr;
}

export function createHistoryScreen(options: HistoryScreenOptions = {}): Screen<HistoryVM> {
  let scope: Scope | null = null;
  let heading: HTMLHeadingElement | null = null;
  let last: HistoryVM | null = null;
  let parts: {
    body: HTMLTableSectionElement;
    table: HTMLTableElement;
    empty: HTMLDivElement;
    clear: HTMLButtonElement;
    confirm: InlineConfirm;
    status: HTMLParagraphElement;
    count: TextHandle;
  } | null = null;

  function render(vm: HistoryVM): void {
    if (parts === null) return;
    const hasRows = vm.entries.length > 0;
    if (last === null || vm.entries !== last.entries) {
      const frag = document.createDocumentFragment();
      for (const e of vm.entries) frag.appendChild(row(e));
      parts.body.replaceChildren(frag);
      setText(parts.count, `${String(vm.entries.length)} of 50 rounds kept`);
    }
    setHidden(parts.table, !hasRows);
    setHidden(parts.clear, !hasRows);
    setHidden(parts.empty, hasRows);
    setHidden(parts.status, vm.status !== 'unavailable');
    if (!hasRows && parts.confirm.isOpen) parts.confirm.close();
    last = vm;
  }

  return {
    mount(root: HTMLElement, vm: HistoryVM, emit: Emit): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = null;
      const node = el('section', { cls: 'sz-history', testId: 'history-screen' });
      heading = el(
        'h2',
        { cls: 'sz-panel__title', text: 'MATCH HISTORY', attrs: { tabindex: '-1' } },
        node,
      );
      const status = el(
        'p',
        {
          cls: 'sz-notice sz-notice--note',
          text: 'This browser is blocking storage. History is not saved after you close the tab.',
          testId: 'history-storage-status',
          attrs: { role: 'note' },
        },
        node,
      );
      const toolbar = el('div', { cls: 'sz-history__toolbar' }, node);
      const countP = el('p', { cls: 'sz-history__count' }, toolbar);
      const count = text(countP);
      const confirm = inlineConfirm(s, {
        testId: 'history-clear-confirm',
        confirmLabel: 'Clear History',
        onConfirm: () => {
          confirm.close();
          emit({ type: 'clear-history' });
        },
      });
      const clear = menuButton(
        s,
        {
          label: 'Clear History',
          variant: 'danger',
          testId: 'history-clear',
          onPress: () => {
            confirm.open("Clear all match history? This can't be undone.", clear.el);
          },
        },
        toolbar,
      );
      toolbar.appendChild(confirm.el);
      const table = el(
        'table',
        { cls: 'sz-table sz-history__table', testId: 'history-table' },
        node,
      );
      const head = el('tr', {}, el('thead', {}, table));
      for (const h of ['When', 'Result', 'Map', 'Bots', 'Kills', 'Accuracy']) {
        el('th', { text: h, attrs: { scope: 'col' } }, head);
      }
      const body = el('tbody', { testId: 'history-rows' }, table);
      const empty = el('div', { cls: 'sz-history__empty', testId: 'history-empty' }, node);
      el('p', { text: 'No rounds yet' }, empty);
      if (options.onGoToSetup !== undefined) {
        const go = options.onGoToSetup;
        menuButton(
          s,
          {
            label: 'Go to Match Setup',
            variant: 'primary',
            testId: 'history-go-setup',
            onPress: go,
          },
          empty,
        );
      }
      setAttr(table, 'aria-label', 'Completed rounds, newest first');
      parts = { body, table, empty, clear: clear.el, confirm, status, count };
      render(vm);
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: HistoryVM): void {
      if (scope === null || vm === last) return;
      render(vm);
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      parts = null;
      heading = null;
      last = null;
    },
    focusFirst(): void {
      heading?.focus();
    },
  };
}
