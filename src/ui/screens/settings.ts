/**
 * S2 Settings. Used in the S1 SETTINGS panel and nested in S11 Pause; the
 * `context` decides the round-duration hint. Every control emits
 * `set-setting`; app-shell applies it through the store and calls update()
 * with the accepted value (BR-MS-06, PD-MS-05).
 */
import type { Settings, SettingsIntent } from '../../contracts';
import { DEFAULT_SETTINGS, SETTINGS_SPEC, SPEC_KEYS, type SettingKey } from '../../settings';
import { el, setText, text, type TextHandle } from '../components/dom';
import { labeledSlider, type Slider } from '../components/labeled-slider';
import { menuButton } from '../components/menu-button';
import { createScope, type Scope } from '../components/scope';
import type { Emit, Screen } from '../components/screen';
import { segmentedRadio, type Segmented } from '../components/segmented-radio';
import { undoToast } from '../components/undo-toast';
import { formatClock, formatFov, formatPercent, formatSensitivity, STORAGE_FOOTER } from './format';
import type { SettingsVM } from './view-models';

const GRAPHICS_LABELS: Readonly<Record<Settings['graphics'], string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
const GRAPHICS_HINTS: Readonly<Record<Settings['graphics'], string>> = {
  low: 'Fastest. Recommended for 15 or more bots.',
  medium: 'Balanced quality and speed.',
  high: 'Best quality. Needs a strong graphics card.',
};
const DURATION_HINT = {
  menu: 'Length of each round.',
  pause: 'Applies from the next round.',
} as const;

export function settingIntent<K extends SettingKey>(key: K, value: Settings[K]): SettingsIntent {
  return { type: 'set-setting', key, value } as SettingsIntent;
}

interface Controls {
  sliders: Partial<Record<SettingKey, Slider>>;
  graphics: Segmented<Settings['graphics']> | null;
  duration: Segmented<number>;
}

function group(parent: Node, title: string, testId: string): HTMLElement {
  const section = el('section', { cls: 'sz-settings__group', testId }, parent);
  el('h3', { cls: 'sz-settings__group-title', text: title }, section);
  return section;
}

export function createSettingsScreen(): Screen<SettingsVM> {
  let scope: Scope | null = null;
  let heading: HTMLHeadingElement | null = null;
  let last: SettingsVM | null = null;
  let controls: Controls | null = null;
  let footer: TextHandle | null = null;

  function build(s: Scope, root: HTMLElement, vm: SettingsVM, emit: Emit): HTMLElement {
    const node = el('section', { cls: 'sz-settings', testId: 'settings-screen' });
    heading = el(
      'h2',
      { cls: 'sz-panel__title', text: 'SETTINGS', attrs: { tabindex: '-1' } },
      node,
    );
    const set = <K extends SettingKey>(key: K, value: Settings[K]): void => {
      emit(settingIntent(key, value));
    };
    const st = vm.settings;
    const sliders: Partial<Record<SettingKey, Slider>> = {};

    const input = group(node, 'INPUT', 'settings-group-input');
    sliders.sensitivity = labeledSlider(
      s,
      {
        id: `sz-${vm.context}-sensitivity`,
        label: 'Mouse sensitivity',
        spec: SETTINGS_SPEC.sensitivity,
        value: st.sensitivity,
        format: formatSensitivity,
        testId: 'settings-sensitivity',
        onInput: (v) => {
          set('sensitivity', v);
        },
      },
      input,
    );
    sliders.fovDeg = labeledSlider(
      s,
      {
        id: `sz-${vm.context}-fov`,
        label: 'Field of view',
        spec: SETTINGS_SPEC.fovDeg,
        value: st.fovDeg,
        format: formatFov,
        testId: 'settings-fov',
        onInput: (v) => {
          set('fovDeg', v);
        },
      },
      input,
    );

    if (vm.features.audio) {
      const audio = group(node, 'AUDIO', 'settings-group-audio');
      sliders.masterVolume = labeledSlider(
        s,
        {
          id: `sz-${vm.context}-master`,
          label: 'Master volume',
          spec: SETTINGS_SPEC.masterVolume,
          value: st.masterVolume,
          format: formatPercent,
          testId: 'settings-master-volume',
          onInput: (v) => {
            set('masterVolume', v);
          },
        },
        audio,
      );
      sliders.sfxVolume = labeledSlider(
        s,
        {
          id: `sz-${vm.context}-sfx`,
          label: 'Effects volume',
          spec: SETTINGS_SPEC.sfxVolume,
          value: st.sfxVolume,
          format: formatPercent,
          testId: 'settings-sfx-volume',
          onInput: (v) => {
            set('sfxVolume', v);
          },
        },
        audio,
      );
    }

    let graphics: Segmented<Settings['graphics']> | null = null;
    if (vm.features.graphicsPresets) {
      const video = group(node, 'VIDEO', 'settings-group-video');
      graphics = segmentedRadio(
        s,
        {
          legend: 'Graphics quality',
          name: `sz-${vm.context}-graphics`,
          testId: 'settings-graphics',
          value: st.graphics,
          options: SETTINGS_SPEC.graphics.values.map((v) => ({
            value: v,
            label: GRAPHICS_LABELS[v],
            testId: `settings-graphics-${v}`,
          })),
          describe: (v) => GRAPHICS_HINTS[v],
          onChange: (v) => {
            set('graphics', v);
          },
        },
        video,
      );
    }

    const gameplay = group(node, 'GAMEPLAY', 'settings-group-gameplay');
    const duration = segmentedRadio<number>(
      s,
      {
        legend: 'Round duration',
        name: `sz-${vm.context}-duration`,
        testId: 'settings-round-duration',
        value: st.roundDurationSec,
        options: SETTINGS_SPEC.roundDurationSec.values.map((v) => ({
          value: v,
          label: formatClock(v),
          testId: `settings-round-duration-${String(v)}`,
        })),
        onChange: (v) => {
          set('roundDurationSec', v);
        },
      },
      gameplay,
    );
    el(
      'p',
      {
        cls: 'sz-settings__hint',
        text: DURATION_HINT[vm.context],
        testId: 'settings-duration-hint',
      },
      gameplay,
    );

    const actions = el('div', { cls: 'sz-settings__actions' }, node);
    const t = undoToast(s, 'settings-undo-toast', 5000);
    menuButton(
      s,
      {
        label: 'Reset to defaults',
        testId: 'settings-reset',
        onPress: () => {
          const snapshot = last?.settings ?? vm.settings;
          const changed = SPEC_KEYS.filter((k) => snapshot[k] !== DEFAULT_SETTINGS[k]);
          if (changed.length === 0) return;
          for (const k of changed) emit(settingIntent(k, DEFAULT_SETTINGS[k]));
          t.show('Settings reset to defaults.', () => {
            const now = last?.settings ?? DEFAULT_SETTINGS;
            for (const k of SPEC_KEYS) {
              if (now[k] !== snapshot[k]) emit(settingIntent(k, snapshot[k]));
            }
          });
        },
      },
      actions,
    );
    actions.appendChild(t.el);

    if (vm.storage !== null && vm.features.persistence) {
      const p = el('p', { cls: 'sz-settings__footer', testId: 'settings-storage-status' }, node);
      footer = text(p, STORAGE_FOOTER[vm.storage]);
    }
    controls = { sliders, graphics, duration };
    root.appendChild(node);
    return node;
  }

  return {
    mount(root: HTMLElement, vm: SettingsVM, emit: Emit): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = vm;
      const node = build(s, root, vm, emit);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: SettingsVM): void {
      if (scope === null || controls === null || vm === last) return;
      last = vm;
      const st = vm.settings;
      for (const key of SPEC_KEYS) {
        const slider = controls.sliders[key];
        const v = st[key];
        if (slider !== undefined && typeof v === 'number') slider.update(v);
      }
      controls.graphics?.update(st.graphics);
      controls.duration.update(st.roundDurationSec);
      if (footer !== null && vm.storage !== null) setText(footer, STORAGE_FOOTER[vm.storage]);
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      controls = null;
      footer = null;
      heading = null;
      last = null;
    },
    focusFirst(): void {
      heading?.focus();
    },
  };
}
