/**
 * SegmentedRadioGroup: <fieldset> of native radios. Arrow keys and Tab use the
 * browser's own radio-group behaviour (roving focus). The selected option is
 * marked by a ✓ glyph and bold label in CSS, never colour alone (BR-MS-42).
 */
import { el, setChecked, setText, text, toggleClass, type TextHandle } from './dom';
import type { Scope } from './scope';

export interface RadioOption<T> {
  readonly value: T;
  readonly label: string;
  readonly testId: string;
  /** Optional second line, e.g. a map blurb. */
  readonly blurb?: string;
}

export interface SegmentedProps<T> {
  readonly legend: string;
  readonly name: string;
  readonly options: readonly RadioOption<T>[];
  readonly value: T;
  readonly testId: string;
  readonly describe?: (value: T) => string;
  readonly variant?: 'segmented' | 'cards';
  readonly onChange: (value: T) => void;
}

export interface Segmented<T> {
  readonly el: HTMLFieldSetElement;
  readonly inputs: readonly HTMLInputElement[];
  update(value: T): void;
}

export function segmentedRadio<T>(
  scope: Scope,
  props: SegmentedProps<T>,
  parent?: Node,
): Segmented<T> {
  const variant = props.variant ?? 'segmented';
  const fieldset = el(
    'fieldset',
    { cls: `sz-radio sz-radio--${variant}`, testId: props.testId },
    parent,
  );
  el('legend', { cls: 'sz-radio__legend', text: props.legend }, fieldset);
  const row = el('div', { cls: 'sz-radio__options' }, fieldset);
  const labels: HTMLLabelElement[] = [];
  const inputs = props.options.map((opt, i) => {
    const label = el('label', { cls: 'sz-radio__option' }, row);
    const input = el(
      'input',
      {
        cls: 'sz-radio__input',
        testId: opt.testId,
        attrs: { type: 'radio', name: props.name, value: String(i) },
      },
      label,
    );
    el('span', { cls: 'sz-radio__label', text: opt.label }, label);
    if (opt.blurb !== undefined) el('span', { cls: 'sz-radio__blurb', text: opt.blurb }, label);
    scope.on(input, 'change', () => {
      if (input.checked) props.onChange(opt.value);
    });
    labels.push(label);
    return input;
  });
  let hint: TextHandle | null = null;
  if (props.describe !== undefined) {
    const p = el('p', { cls: 'sz-radio__hint', attrs: { 'aria-live': 'polite' } }, fieldset);
    hint = text(p, props.describe(props.value));
  }

  function update(value: T): void {
    props.options.forEach((opt, i) => {
      const on = opt.value === value;
      const input = inputs[i];
      const label = labels[i];
      if (input !== undefined) setChecked(input, on);
      if (label !== undefined) toggleClass(label, 'is-selected', on);
    });
    if (hint !== null && props.describe !== undefined) setText(hint, props.describe(value));
  }
  // Initial state is part of mount, so it is set directly.
  props.options.forEach((opt, i) => {
    const on = opt.value === props.value;
    const input = inputs[i];
    const label = labels[i];
    if (input !== undefined) input.checked = on;
    if (label !== undefined) label.classList.toggle('is-selected', on);
  });
  return { el: fieldset, inputs, update };
}
