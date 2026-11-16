/** SoftBanner (role="note") and BlockingNotice (role="alert"). */
import { el, setText, text, type TextHandle } from './dom';

export interface Notice {
  readonly el: HTMLDivElement;
  set(message: string): void;
}

export function notice(
  kind: 'note' | 'alert',
  testId: string,
  initial = '',
  parent?: Node,
): Notice {
  const box = el(
    'div',
    { cls: `sz-notice sz-notice--${kind}`, testId, attrs: { role: kind } },
    parent,
  );
  const msg: TextHandle = text(box, initial);
  return {
    el: box,
    set: (m) => {
      setText(msg, m);
    },
  };
}
