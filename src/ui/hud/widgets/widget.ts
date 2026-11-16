/**
 * Widget contract (frontend-components-hud). The root treats widgets
 * uniformly, so a cut Should widget is removed by deleting one list entry.
 * A widget keeps its slots in one object created by build; render and clear
 * return early until then.
 */
import type { HudLayout } from '../dom/build';
import type { DomWriter } from '../dom/writer';
import type { HudViewModel } from '../view-model';

export interface HudWidget {
  readonly name: string;
  /** Creates this widget's nodes once, inside mount. */
  build(layout: HudLayout, doc: Document): void;
  /** Writes changed values. Called every stepped frame. */
  render(vm: Readonly<HudViewModel>, w: DomWriter): void;
  /** Hides transient visuals (reset and tick regression). */
  clear(w: DomWriter): void;
}
