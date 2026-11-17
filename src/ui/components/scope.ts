/**
 * Scope: owns every listener, timer and child screen a screen creates
 * (PD-MS-03). `dispose()` removes all of them, so unmount leaves nothing live
 * on document or window (BR-MS-32, PERF-MS-10). This is the only module in the
 * unit allowed to call addEventListener and setTimeout (ESLint override).
 */
import type { Emit, Screen } from './screen';

export interface Scope {
  on(
    target: EventTarget,
    type: string,
    fn: (e: Event) => void,
    opts?: AddEventListenerOptions,
  ): void;
  /** keydown listener with a typed KeyboardEvent. */
  onKey(target: EventTarget, fn: (e: KeyboardEvent) => void): void;
  /** Starts a timer owned by this scope. Returns a cancel function. */
  timeout(ms: number, fn: () => void): () => void;
  /** Mounts a child screen and unmounts it on dispose (or on the returned release). */
  child<VM>(screen: Screen<VM>, root: HTMLElement, vm: VM, emit: Emit): () => void;
  /** Registers an arbitrary disposer. */
  add(dispose: () => void): void;
  dispose(): void;
  readonly disposed: boolean;
}

export function createScope(): Scope {
  let disposers: (() => void)[] = [];
  let disposed = false;

  function track(d: () => void): () => void {
    let done = false;
    const once = (): void => {
      if (done) return;
      done = true;
      d();
      const i = disposers.indexOf(once);
      if (i >= 0) disposers.splice(i, 1);
    };
    disposers.push(once);
    return once;
  }

  return {
    get disposed() {
      return disposed;
    },
    on(
      target: EventTarget,
      type: string,
      fn: (e: Event) => void,
      opts?: AddEventListenerOptions,
    ): void {
      if (disposed) return;
      target.addEventListener(type, fn, opts);
      track(() => {
        target.removeEventListener(type, fn, opts);
      });
    },
    onKey(target: EventTarget, fn: (e: KeyboardEvent) => void): void {
      this.on(target, 'keydown', fn as (e: Event) => void);
    },
    timeout(ms: number, fn: () => void): () => void {
      if (disposed) return () => undefined;
      let release: () => void = () => undefined;
      const id = setTimeout(() => {
        release();
        fn();
      }, ms);
      release = track(() => {
        clearTimeout(id);
      });
      return release;
    },
    child<VM>(screen: Screen<VM>, root: HTMLElement, vm: VM, emit: Emit): () => void {
      if (disposed) return () => undefined;
      screen.mount(root, vm, emit);
      return track(() => {
        screen.unmount();
      });
    },
    add(d: () => void): void {
      if (disposed) {
        d();
        return;
      }
      track(d);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const list = disposers.reverse();
      disposers = [];
      for (const d of list) d();
    },
  };
}
