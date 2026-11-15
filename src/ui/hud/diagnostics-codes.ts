/**
 * Diagnostic codes the HUD reports (SD-H-07). All go through
 * Diagnostics.warnOnce or count; details are numbers and booleans only.
 */
export const HUD_CODES = {
  alreadyMounted: 'hud/already-mounted',
  nonFinite: 'hud/non-finite-value',
  activeSlotMissing: 'hud/active-slot-missing',
  updateBeforeMount: 'hud/update-before-mount',
  botOverflow: 'hud/bot-overflow',
  widgetFault: 'hud/widget-fault',
  eventFault: 'hud/event-fault',
  tickRegression: 'hud/tick-regression',
  damageNoDirection: 'hud/damage-no-direction',
  nodeBudget: 'hud/node-budget',
} as const;
