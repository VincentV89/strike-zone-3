/**
 * hud public surface (business-logic-model-hud, Public Interface). app-shell
 * imports only this module. Per stepped frame: feed(events), then
 * update(toHudViewModel(snapshot, stats, { round }, scratch)).
 */
import './hud.css';

export { createHud, type Hud, type HudOptions } from './hud';
export {
  accuracyPct,
  createHudViewModel,
  crosshairGap,
  toHudViewModel,
  type HudContext,
  type HudStats,
  type HudViewModel,
  type ScoreboardBotRow,
  type ScoreboardVM,
} from './view-model';
export { formatClock } from './model/format';
export { relativeBearing } from './model/bearing';
export { HUD_CODES } from './diagnostics-codes';
