/** settings: public surface. app-shell, menus-ui and audio import only this module. */
export {
  SETTINGS_SPEC,
  SPEC_KEYS,
  DEFAULT_SETTINGS,
  type SettingKey,
  type NumberSpec,
  type EnumSpec,
  type SettingsSpec,
} from './spec';
export { normalise } from './normalise';
export { validateSettings, type ValidatedSettings } from './validate';
export {
  createSettingsStore,
  type SettingsStore,
  type SettingsStoreRepo,
  type SettingsListener,
  type Unsubscribe,
} from './store';
