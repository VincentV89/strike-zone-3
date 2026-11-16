/** MapCard group: radio cards with a name and a blurb (design-system-mapping MapCard). */
import type { MapId } from '../../contracts';
import type { Scope } from './scope';
import { segmentedRadio, type Segmented } from './segmented-radio';

export interface MapChoice {
  readonly value: MapId;
  readonly label: string;
  readonly blurb: string;
}

export function mapCards(
  scope: Scope,
  props: { choices: readonly MapChoice[]; value: MapId; onChange: (v: MapId) => void },
  parent?: Node,
): Segmented<MapId> {
  return segmentedRadio<MapId>(
    scope,
    {
      legend: 'Select Map',
      name: 'sz-map',
      testId: 'main-menu-map-group',
      variant: 'cards',
      value: props.value,
      options: props.choices.map((c) => ({
        value: c.value,
        label: c.label,
        blurb: c.blurb,
        testId: `main-menu-map-${c.value}`,
      })),
      onChange: props.onChange,
    },
    parent,
  );
}
