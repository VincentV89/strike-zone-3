// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEndOfRoundScreen } from '../../../../src/ui/screens';
import { byTestId, endVM, host, press, recorder } from './fixtures';

afterEach(() => {
  document.body.replaceChildren();
});

describe('S13 end of round (story-end-of-round-screen)', () => {
  it.each([
    ['victory', endVM(), 'VICTORY', '▲', 'All 5 enemies eliminated'],
    [
      'defeat',
      endVM({ outcome: 'defeat', killerId: 7, enemiesLeft: 3 }),
      'DEFEAT',
      '✕',
      'Eliminated by Bot-07 · 3 enemies left',
    ],
    [
      'defeat no killer',
      endVM({ outcome: 'defeat', killerId: null, enemiesLeft: 1 }),
      'DEFEAT',
      '✕',
      'Eliminated · 1 enemy left',
    ],
    [
      'time',
      endVM({ outcome: 'time-expired', enemiesLeft: 2 }),
      'TIME EXPIRED',
      '◷',
      'Time ran out with 2 enemies left · counts as a loss',
    ],
  ])('%s: word, glyph and cause match (BR-MS-26)', (_n, vm, word, glyph, cause) => {
    const root = host();
    createEndOfRoundScreen().mount(root, vm, recorder().emit);
    expect(byTestId(root, 'end-of-round-word').textContent).toBe(word);
    expect(byTestId(root, 'end-of-round-headline').textContent).toContain(glyph);
    expect(byTestId(root, 'end-of-round-cause').textContent).toBe(cause);
    expect(byTestId(root, 'end-of-round-screen').getAttribute('data-outcome')).toBe(vm.outcome);
  });

  it('formats the stats, session and footer', () => {
    const root = host();
    createEndOfRoundScreen().mount(root, endVM(), recorder().emit);
    const stat = (k: string): string | null => byTestId(root, `end-of-round-stat-${k}`).textContent;
    expect(stat('kills')).toBe('5');
    expect(stat('headshots')).toBe('2');
    expect(stat('accuracy')).toBe('41%');
    expect(stat('dealt')).toBe('521');
    expect(stat('taken')).toBe('64');
    expect(stat('time')).toBe('2:31');
    expect(byTestId(root, 'end-of-round-session').textContent).toBe('Session: 2 won · 1 lost');
    expect(byTestId(root, 'end-of-round-footer').textContent).toBe(
      'Industrial Warehouse · 5 bots · Hard',
    );
    expect(byTestId(root, 'end-of-round-live').textContent).toBe(
      'Victory. All 5 enemies eliminated.',
    );
  });

  it('shows "—" with "no shots fired" when no shots were fired (BR-MS-27)', () => {
    const root = host();
    createEndOfRoundScreen().mount(root, endVM({ shotsFired: 0, accuracy: 0 }), recorder().emit);
    expect(byTestId(root, 'end-of-round-stat-accuracy').textContent).toBe('— (no shots fired)');
  });

  it('focuses Play Again and emits one navigation intent (BR-MS-31)', () => {
    const root = host();
    const r = recorder();
    const screen = createEndOfRoundScreen();
    screen.mount(root, endVM(), r.emit);
    screen.focusFirst();
    expect(document.activeElement).toBe(byTestId(root, 'end-of-round-play-again'));
    press(root, 'end-of-round-play-again');
    press(root, 'end-of-round-main-menu');
    press(root, 'end-of-round-play-again');
    expect(r.intents).toEqual([{ type: 'play-again' }]);
  });

  it('Main Menu emits main-menu; update re-renders a new result', () => {
    const root = host();
    const r = recorder();
    const screen = createEndOfRoundScreen();
    screen.mount(root, endVM(), r.emit);
    screen.update(endVM({ outcome: 'defeat', killerId: 12, enemiesLeft: 4 }));
    expect(byTestId(root, 'end-of-round-word').textContent).toBe('DEFEAT');
    press(root, 'end-of-round-main-menu');
    expect(r.intents).toEqual([{ type: 'main-menu' }]);
  });
});
