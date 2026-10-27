import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test/database.ts';
import type { SourceResult } from '../adapters/http.ts';
import type { Waterway, WaterwaySource } from '../adapters/overpass/overpass.ts';
import { courseBox, createCourseSnap } from './courseSnap.ts';
import { createSourceCache, type SourceCache } from './sourceCache.ts';

// A small river: a main stem running north in 0.005° steps (about 550 m), and a tributary that
// joins it at node 4. A separate river to the east shares no node with them.
const node = (id: number, lat: number, lon: number) => ({ id, lat, lon });
const main: Waterway = {
  id: 1,
  name: 'Main',
  nodes: [42.6, 42.605, 42.61, 42.615, 42.62, 42.625].map((lat, i) => node(i + 1, lat, -72.55)),
};
const tributary: Waterway = {
  id: 2,
  name: 'Tributary',
  nodes: [node(4, 42.615, -72.55), node(20, 42.615, -72.54), node(21, 42.615, -72.53)],
};
const elsewhere: Waterway = {
  id: 3,
  nodes: [node(30, 42.6, -72.4), node(31, 42.61, -72.4)],
};
// A side channel that leaves the main stem at its top (node 6) and runs down beside it, ending
// 250 m short of rejoining at the bottom, as the channel past the Northampton dock is mapped.
const sideChannel: Waterway = {
  id: 4,
  nodes: [node(6, 42.625, -72.55), node(40, 42.615, -72.546), node(41, 42.6015, -72.547)],
};

let cache: SourceCache;
let close: () => Promise<void>;
beforeEach(async () => {
  const db = await createTestDatabase();
  close = db.close;
  cache = createSourceCache({ db: db.db, logger: { warn: vi.fn() } });
});
afterEach(async () => {
  await close();
});

const snapper = (
  result: SourceResult<Waterway[]> = { ok: true, data: [main, tributary, elsewhere] },
) => {
  const overpass: WaterwaySource = { getWaterways: vi.fn(async () => result) };
  return { snap: createCourseSnap({ overpass, cache }), overpass };
};

describe('createCourseSnap (#103, #142)', () => {
  it('follows the river between each pair of taps', async () => {
    const { snap } = snapper();
    // Tapped about 50 m east of the main stem, as from a dock.
    const result = await snap([
      [42.6, -72.5494],
      [42.62, -72.5494],
    ]);
    expect(result).toEqual({
      ok: true,
      legs: [
        {
          points: [
            [42.6, -72.55],
            [42.605, -72.55],
            [42.61, -72.55],
            [42.615, -72.55],
            [42.62, -72.55],
          ],
        },
      ],
    });
  });

  it('gives one leg per pair of taps, and turns up a tributary where ways share a node', async () => {
    const { snap } = snapper();
    const result = await snap([
      [42.6, -72.55],
      [42.615, -72.53],
      [42.625, -72.55],
    ]);
    if (!result.ok) throw new Error('expected legs');
    expect(result.legs).toHaveLength(2);
    expect(result.legs[0]?.points.at(-3)).toEqual([42.615, -72.55]);
    expect(result.legs[0]?.points.at(-1)).toEqual([42.615, -72.53]);
    expect(result.legs[1]?.points[0]).toEqual([42.615, -72.53]);
    expect(result.legs[1]?.points.at(-1)).toEqual([42.625, -72.55]);
  });

  it('closes a loop when the last tap is the first', async () => {
    const { snap } = snapper();
    const dock: [number, number] = [42.6, -72.55];
    const result = await snap([dock, [42.62, -72.55], [42.615, -72.53], dock]);
    expect(result.ok && result.legs).toHaveLength(3);
    expect(result.ok && result.legs.every((l) => !l.straight)).toBe(true);
  });

  it('draws a straight leg, saying why, when a tap is more than 300 m from any river', async () => {
    const { snap } = snapper();
    const off: [number, number] = [42.62, -72.545];
    const result = await snap([[42.6, -72.55], off]);
    expect(result).toEqual({
      ok: true,
      legs: [{ points: [[42.6, -72.55], off], straight: 'noRiver' }],
    });
  });

  it('draws a straight leg when the taps are on waterways that do not meet', async () => {
    const { snap } = snapper();
    const result = await snap([
      [42.6, -72.55],
      [42.61, -72.4],
    ]);
    expect(result.ok && result.legs[0]?.straight).toBe('notConnected');
  });

  it('draws a straight leg instead of a detour that points to a gap in the map', async () => {
    // From near the bottom of the side channel to the main stem just across from it: the only
    // mapped way is up the channel and back down the main stem, about 5.2 km for 0.3 km.
    const { snap } = snapper({ ok: true, data: [main, sideChannel] });
    const result = await snap([
      [42.6015, -72.5468],
      [42.6, -72.5502],
    ]);
    expect(result.ok && result.legs[0]).toEqual({
      points: [
        [42.6015, -72.5468],
        [42.6, -72.5502],
      ],
      straight: 'detour',
    });
  });

  it('keeps a route that bends, as long as it is not a large detour', async () => {
    const { snap } = snapper();
    // Up the main stem and along the tributary: about 3.3 km for 2.3 km straight, 1.4 times.
    const result = await snap([
      [42.6, -72.55],
      [42.615, -72.53],
    ]);
    expect(result.ok && result.legs[0]?.straight).toBeUndefined();
  });

  it('refuses taps more than 30 km apart, or too many taps, without asking Overpass', async () => {
    const { snap, overpass } = snapper();
    expect(
      await snap([
        [42.6, -72.55],
        [42.9, -72.55],
      ]),
    ).toEqual({ ok: false, reason: 'tooFar' });
    const many = Array.from(
      { length: 13 },
      (_, i) => [42.6 + i * 0.001, -72.55] as [number, number],
    );
    expect(await snap(many)).toEqual({ ok: false, reason: 'tooMany' });
    expect(await snap([[42.6, -72.55]])).toEqual({ ok: false, reason: 'tooMany' });
    expect(overpass.getWaterways).not.toHaveBeenCalled();
  });

  it('reports a failed source', async () => {
    const error = {
      source: 'overpass' as const,
      kind: 'http' as const,
      message: 'HTTP 504',
      status: 504,
    };
    const { snap } = snapper({ ok: false, error });
    expect(
      await snap([
        [42.6, -72.55],
        [42.62, -72.55],
      ]),
    ).toEqual({ ok: false, reason: 'sourceError', error });
  });

  it('fetches the waterways once for the whole course, and caches them', async () => {
    const { snap, overpass } = snapper();
    await snap([
      [42.6, -72.5494],
      [42.62, -72.5494],
      [42.615, -72.53],
    ]);
    await snap([
      [42.6001, -72.5495],
      [42.6199, -72.5493],
      [42.615, -72.53],
    ]);
    expect(overpass.getWaterways).toHaveBeenCalledTimes(1);
  });
});

describe('courseBox', () => {
  it('covers every tap with a 2 km margin, rounded out to 0.01°', () => {
    expect(
      courseBox([
        [42.605, -72.5448],
        [42.6422, -72.4819],
      ]),
    ).toEqual([-72.57, 42.58, -72.45, 42.67]);
  });
});
