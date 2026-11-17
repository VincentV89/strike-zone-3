/** MenuButton: a native <button>; Enter and Space fire click natively. */
import { el, setText, text, type TextHandle } from './dom';
import type { Scope } from './scope';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface MenuButtonProps {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly testId: string;
  readonly onPress: () => void;
}

export interface MenuButton {
  readonly el: HTMLButtonElement;
  setLabel(label: string): void;
}

export function menuButton(scope: Scope, props: MenuButtonProps, parent?: Node): MenuButton {
  const button = el(
    'button',
    {
      cls: `sz-btn sz-btn--${props.variant ?? 'secondary'}`,
      testId: props.testId,
      attrs: { type: 'button' },
    },
    parent,
  );
  const label: TextHandle = text(button, props.label);
  scope.on(button, 'click', () => {
    props.onPress();
  });
  return {
    el: button,
    setLabel: (s) => {
      setText(label, s);
    },
  };
}
