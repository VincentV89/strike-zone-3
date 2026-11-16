/** input public surface. app-shell imports only this module. */
export {
  createInputSystem,
  type HeldAction,
  type InputMap,
  type InputSystem,
  type InputTargets,
  type ListenerScope,
} from './input-system';
export {
  BINDING_TABLE,
  KEY_BINDINGS,
  PREVENT_DEFAULT_CODES,
  isIgnoredKey,
  type KeyAction,
} from './bindings';
