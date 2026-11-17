/**
 * Ports app-shell receives from main.ts (SD-AS-16). Everything below main.ts
 * gets functions, not globals, so it runs in Node or happy-dom tests.
 */
import type { Result } from '../core';
import type { DisposableScope } from './scope';

export type Unsubscribe = () => void;

/** component-methods PointerLockPort. */
export interface PointerLockPort {
  /** Called synchronously inside a click or Enter handler (BR-AS-04). */
  request(el: HTMLElement): Promise<Result<void, 'REFUSED'>>;
  exit(): void;
  isLocked(): boolean;
  onChange(cb: (locked: boolean) => void): Unsubscribe;
}

export type PointerLockFactory = (scope: DisposableScope) => PointerLockPort;

/** Browser capabilities read once by main.ts (SD-AS-16). */
export interface BrowserCaps {
  readonly webgl2: boolean;
  readonly pointerLock: boolean;
  readonly reducedMotion: boolean;
}
