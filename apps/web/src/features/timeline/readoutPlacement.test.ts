import { describe, expect, it } from 'vitest';
import { READOUT_HEIGHT, readoutSide } from './readoutPlacement.ts';

const ROW = 112;

describe('readoutSide', () => {
  it('sits above the point when no limit is near', () => {
    expect(readoutSide({ pointPx: 80, rowPx: ROW, arrows: false, left: false, limitsPx: [] })).toBe(
      'above',
    );
  });

  it('sits below the point near the top of the row', () => {
    expect(readoutSide({ pointPx: 20, rowPx: ROW, arrows: false, left: false, limitsPx: [] })).toBe(
      'below',
    );
  });

  it('moves below when it would cover a limit label above the point (#123)', () => {
    // The wind row at 375 px: gusts 14 mph at 61 px, limit lines for 20 and 15 mph above it.
    expect(
      readoutSide({ pointPx: 61, rowPx: ROW, arrows: true, left: false, limitsPx: [37, 56] }),
    ).toBe('below');
  });

  it('moves above when it would cover a limit label below the point', () => {
    // A 132 px row (flow): below, the readout would cover the label of the line at 70 px.
    expect(
      readoutSide({ pointPx: 45, rowPx: 132, arrows: false, left: false, limitsPx: [70] }),
    ).toBe('above');
  });

  it('stays put when the other side would cover a label too', () => {
    expect(
      readoutSide({ pointPx: 61, rowPx: ROW, arrows: false, left: false, limitsPx: [50, 100] }),
    ).toBe('above');
  });

  it('stays put when the other side would leave the row', () => {
    expect(
      readoutSide({ pointPx: 100, rowPx: ROW, arrows: false, left: false, limitsPx: [90] }),
    ).toBe('above');
    expect(
      readoutSide({ pointPx: 20, rowPx: ROW, arrows: false, left: false, limitsPx: [45] }),
    ).toBe('below');
  });

  it('on the left, stays put when the other side would cover the bottom scale number', () => {
    // Below, the readout would end at 102.6 px, inside the scale number at 98 to 112 px.
    const at = (pointPx: number, left: boolean) =>
      readoutSide({ pointPx, rowPx: ROW, arrows: false, left, limitsPx: [60] });
    expect(at(75, true)).toBe('above');
    expect(at(70, true)).toBe('below');
    // On the right the readout doesn't reach the scale numbers.
    expect(at(75, false)).toBe('below');
  });

  it('stays put when the other side would cover the wind arrows, or the top scale number on the left', () => {
    // A 132 px row: above, the readout would start at 17.4 px.
    const at = (arrows: boolean, left: boolean) =>
      readoutSide({ pointPx: 45, rowPx: 132, arrows, left, limitsPx: [70] });
    expect(at(false, false)).toBe('above');
    expect(at(false, true)).toBe('above'); // clear of a scale number
    expect(at(true, false)).toBe('below'); // not of the arrows
    // In a 112 px row, the readout can't move up from below without reaching the top corner.
    expect(
      readoutSide({ pointPx: 35, rowPx: ROW, arrows: false, left: true, limitsPx: [60] }),
    ).toBe('below');
    expect(
      readoutSide({ pointPx: 35, rowPx: ROW, arrows: false, left: false, limitsPx: [60] }),
    ).toBe('above');
  });

  it('ignores a limit whose label clears the readout', () => {
    // Above the point, the readout spans 56.4 to 79.4 px. A line at 38 px has its label end at
    // 38 px; a line at 99 px has its label start at 80 px.
    expect(
      readoutSide({ pointPx: 84, rowPx: ROW, arrows: false, left: false, limitsPx: [38] }),
    ).toBe('above');
    expect(
      readoutSide({ pointPx: 84, rowPx: ROW, arrows: false, left: false, limitsPx: [99] }),
    ).toBe('above');
  });

  it('counts a label that only just overlaps the readout', () => {
    const pointPx = 70;
    const readoutTop = pointPx - 0.2 * READOUT_HEIGHT - READOUT_HEIGHT;
    expect(
      readoutSide({ pointPx, rowPx: ROW, arrows: false, left: false, limitsPx: [readoutTop + 1] }),
    ).toBe('below');
  });
});
