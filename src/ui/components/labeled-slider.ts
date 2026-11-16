/**
 * LabeledSlider: native <input type="range"> whose min, max and step come from
 * SETTINGS_SPEC. The slider never trusts its own value: it emits on `input`
 * and shows whatever the store accepted (SEC-MS-07).
 */
import type { NumberSpec } from '../../settings';
import { el, setAttr, setInputValue, setText, text } from './dom';
import type { Scope } from './scope';

export interface SliderProps {
  readonly id: string;
  readonly label: string;
  readonly spec: NumberSpec;
  readonly value: number;
  readonly format: (v: number) => string;
  readonly testId: string;
  readonly hint?: string;
  readonly onInput: (v: number) => void;
}

export interface Slider {
  readonly el: HTMLDivElement;
  readonly input: HTMLInputElement;
  update(value: number): void;
}

export function labeledSlider(scope: Scope, props: SliderProps, parent?: Node): Slider {
  const row = el('div', { cls: 'sz-slider' }, parent);
  el('label', { cls: 'sz-slider__label', text: props.label, attrs: { for: props.id } }, row);
  const input = el(
    'input',
    {
      cls: 'sz-slider__input',
      testId: props.testId,
      attrs: {
        id: props.id,
        type: 'range',
        min: String(props.spec.min),
        max: String(props.spec.max),
        step: String(props.spec.step),
        'aria-valuetext': props.format(props.value),
      },
    },
    row,
  );
  input.value = String(props.value);
  const out = el('span', { cls: 'sz-slider__value', attrs: { 'aria-hidden': 'true' } }, row);
  const valueText = text(out, props.format(props.value));
  if (props.hint !== undefined) el('p', { cls: 'sz-slider__hint', text: props.hint }, row);
  scope.on(input, 'input', () => {
    props.onInput(Number(input.value));
  });
  return {
    el: row,
    input,
    update(value: number): void {
      const formatted = props.format(value);
      setInputValue(input, String(value));
      setText(valueText, formatted);
      setAttr(input, 'aria-valuetext', formatted);
    },
  };
}
