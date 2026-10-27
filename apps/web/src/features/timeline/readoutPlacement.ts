// Where the readout sits relative to the selected point: above it, or below it near the row's
// top. If that box would cover a limit's label, it moves to the other side, as long as there it
// covers no limit label and stays clear of the wind arrows along the row's top and, on the left,
// of the scale numbers in the row's corners (#123). On phones the readout spans most of the plot, so moving it sideways wouldn't
// clear the labels at the right edge.

// Heights in px, measured from the styles (features.css): the readout at --text-sm with its
// border, a limit label, which sits just above its line, a scale number on phones, and the wind
// direction arrows.
export const READOUT_HEIGHT = 23;
export const LIMIT_LABEL_HEIGHT = 19;
export const SCALE_LABEL_HEIGHT = 14;
export const ARROWS_HEIGHT = 18;
// The readout clears the point by a fifth of its height (translate -120% or 20%).
const CLEARANCE = 0.2 * READOUT_HEIGHT;
// Near the top, the readout starts below the point.
const BELOW_IN_TOP_FRACTION = 0.35;

export type ReadoutSide = 'above' | 'below';

export interface ReadoutPlacementInput {
  pointPx: number; // the selected value, from the row's top
  rowPx: number; // the row's height
  limitsPx: readonly number[]; // each limit line, from the row's top
  arrows: boolean; // the row has wind direction arrows along its top
  left: boolean; // the readout is on the left, where phones put the scale numbers
}

function box(side: ReadoutSide, pointPx: number): [number, number] {
  return side === 'above'
    ? [pointPx - CLEARANCE - READOUT_HEIGHT, pointPx - CLEARANCE]
    : [pointPx + CLEARANCE, pointPx + CLEARANCE + READOUT_HEIGHT];
}

export function readoutSide({
  pointPx,
  rowPx,
  limitsPx,
  arrows,
  left,
}: ReadoutPlacementInput): ReadoutSide {
  const preferred: ReadoutSide = pointPx < BELOW_IN_TOP_FRACTION * rowPx ? 'below' : 'above';
  const other: ReadoutSide = preferred === 'above' ? 'below' : 'above';
  const covers = (side: ReadoutSide) => {
    const [top, bottom] = box(side, pointPx);
    return limitsPx.some((line) => top < line && bottom > line - LIMIT_LABEL_HEIGHT);
  };
  const scale = left ? SCALE_LABEL_HEIGHT : 0;
  const clearTop = (arrows ? ARROWS_HEIGHT : 0) + scale;
  const fits = (side: ReadoutSide) => {
    const [top, bottom] = box(side, pointPx);
    return top >= clearTop && bottom <= rowPx - scale;
  };
  return covers(preferred) && fits(other) && !covers(other) ? other : preferred;
}
