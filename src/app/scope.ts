/**
 * DisposableScope (performance-design-app-shell, allocation plan). Every
 * app-shell listener and timer is registered here, and dispose() is the only
 * teardown path, which is what the 10-restart leak invariant measures
 * (RL-AS-01). This is the only file in src/app, src/input and src/dev allowed
 * to call addEventListener and setTimeout (SD-AS-06).
 */

export interface DisposableScope {
  on(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options?: AddEventListenerOptions,
  ): void;
  /** One-shot timer; the returned function cancels it. */
  timeout(fn: () => void, ms: number): () => void;
  add(disposer: () => void): void;
  child(): DisposableScope;
  dispose(): void;
  /** Live listeners, timers, disposers and child scopes, counted through the tree. */
  live(): number;
  readonly disposed: boolean;
}

export function createScope(): DisposableScope {
  const disposers = new Set<() => void>();
  const children = new Set<DisposableScope>();
  let disposed = false;

  const scope: DisposableScope = {
    on(target, type, handler, options) {
      if (disposed) return;
      target.addEventListener(type, handler, options);
      const capture = options?.capture === true;
      disposers.add(() => {
        target.removeEventListener(type, handler, { capture });
      });
    },
    timeout(fn, ms) {
      if (disposed) return () => undefined;
      let cancel = (): void => undefined;
      const id = setTimeout(() => {
        disposers.delete(cancel);
        fn();
      }, ms);
      cancel = (): void => {
        clearTimeout(id);
        disposers.delete(cancel);
      };
      disposers.add(cancel);
      return cancel;
    },
    add(disposer) {
      if (disposed) {
        disposer();
        return;
      }
      disposers.add(disposer);
    },
    child() {
      const c = createScope();
      if (disposed) {
        c.dispose();
        return c;
      }
      children.add(c);
      disposers.add(() => {
        children.delete(c);
        c.dispose();
      });
      return c;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const list = [...disposers].reverse();
      disposers.clear();
      for (const d of list) d();
      children.clear();
    },
    live() {
      let n = disposers.size - children.size;
      for (const c of children) n += c.live();
      return n;
    },
    get disposed() {
      return disposed;
    },
  };
  return scope;
}
