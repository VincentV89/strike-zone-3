import type { SettingsIntent, UiIntent } from '../../contracts';

export type Intent = UiIntent | SettingsIntent;
export type Emit = (intent: Intent) => void;

/** component-methods: every screen module implements Screen<VM>. */
export interface Screen<VM> {
  mount(root: HTMLElement, vm: VM, emit: Emit): void;
  update(vm: VM): void;
  unmount(): void;
  focusFirst(): void;
}
