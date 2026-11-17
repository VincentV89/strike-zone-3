// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createHistoryScreen, domWrites } from '../../../../src/ui/screens';
import { byTestId, historyEntries, historyVM, host, key, press, recorder } from './fixtures';

afterEach(() => {
  document.body.replaceChildren();
});

describe('S14 match history (story-match-history)', () => {
  it('renders newest-first rows with enum labels and glyph hooks', () => {
    const root = host();
    createHistoryScreen().mount(root, historyVM(3), recorder().emit);
    const rows = byTestId(root, 'history-rows').querySelectorAll('tr');
    expect(rows).toHaveLength(3);
    const cells = [...(rows[1]?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
    expect(cells.slice(1)).toEqual(['DEFEAT', 'Industrial Warehouse', '20 · Hard', '12', '38%']);
    expect(rows[1]?.querySelectorAll('td')[1]?.dataset['outcome']).toBe('defeat');
    expect(byTestId(root, 'history-empty').hidden).toBe(true);
  });

  it('shows the empty state without Clear History', () => {
    const root = host();
    createHistoryScreen().mount(root, { entries: [], status: 'fresh' }, recorder().emit);
    expect(byTestId(root, 'history-empty').hidden).toBe(false);
    expect(byTestId(root, 'history-empty').textContent).toContain('No rounds yet');
    expect(byTestId(root, 'history-clear').hidden).toBe(true);
    expect(byTestId(root, 'history-table').hidden).toBe(true);
    expect(root.querySelector('[data-testid="history-go-setup"]')).toBeNull();
  });

  it('Clear History needs a confirm with Cancel focused, then emits clear-history', () => {
    const root = host();
    const r = recorder();
    createHistoryScreen().mount(root, historyVM(3), r.emit);
    press(root, 'history-clear');
    expect(document.activeElement).toBe(byTestId(root, 'history-clear-confirm-cancel'));
    key(byTestId(root, 'history-clear-confirm'), 'Escape');
    expect(byTestId(root, 'history-clear-confirm').hidden).toBe(true);
    expect(r.intents).toEqual([]);
    press(root, 'history-clear');
    press(root, 'history-clear-confirm-confirm');
    expect(r.intents).toEqual([{ type: 'clear-history' }]);
  });

  it('rebuilds rows only when the entries array changes', () => {
    const root = host();
    const screen = createHistoryScreen();
    const vm = historyVM(5);
    screen.mount(root, vm, recorder().emit);
    const firstRow = byTestId(root, 'history-rows').firstElementChild;
    const before = domWrites.count;
    screen.update({ ...vm });
    expect(domWrites.count - before).toBe(0);
    expect(byTestId(root, 'history-rows').firstElementChild).toBe(firstRow);
    screen.update({ entries: Object.freeze(historyEntries(2)), status: 'loaded' });
    expect(byTestId(root, 'history-rows').querySelectorAll('tr')).toHaveLength(2);
    screen.update({ entries: [], status: 'loaded' });
    expect(byTestId(root, 'history-empty').hidden).toBe(false);
  });

  it('notes when storage is unavailable', () => {
    const root = host();
    createHistoryScreen().mount(root, { entries: [], status: 'unavailable' }, recorder().emit);
    expect(byTestId(root, 'history-storage-status').hidden).toBe(false);
  });
});
