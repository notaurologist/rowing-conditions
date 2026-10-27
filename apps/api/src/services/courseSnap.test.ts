import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test/database.ts';
import type { SourceResult } from '../adapters/http.ts';
import type { Waterway, WaterwaySource } from '../adapters/overpass/overpass.ts';
import { courseBox, createCourseSnap } from './courseSnap.ts';
import { createSourceCache, type SourceCache } from './sourceCache.ts';

// A small river: a main stem running north in 0.005° steps (about 550 m), and a tributary that
// joins it at node 3. A separate river to the east shares no node with them.
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

describe('createCourseSnap (#103)', () => {
  it('follows the river from the node nearest the start to the node nearest the turn', async () => {
    const { snap } = snapper();
    // Tapped about 50 m east of the main stem, as from a dock.
    const result = await snap([42.6, -72.5494], [42.62, -72.5494]);
    expect(result).toEqual({
      ok: true,
      points: [
        [42.6, -72.55],
        [42.605, -72.55],
        [42.61, -72.55],
        [42.615, -72.55],
        [42.62, -72.55],
      ],
    });
  });

  it('turns up a tributary where the ways share a node', async () => {
    const { snap } = snapper();
    const result = await snap([42.6, -72.55], [42.615, -72.53]);
    expect(result.ok && result.points.at(-3)).toEqual([42.615, -72.55]);
    expect(result.ok && result.points.at(-1)).toEqual([42.615, -72.53]);
  });

  it('says so when a point is more than 300 m from any river', async () => {
    const { snap } = snapper();
    expect(await snap([42.6, -72.545], [42.62, -72.55])).toEqual({ ok: false, reason: 'noRiver' });
  });

  it('says so when the two points are on rivers that do not meet', async () => {
    const { snap } = snapper();
    expect(await snap([42.6, -72.55], [42.61, -72.4])).toEqual({
      ok: false,
      reason: 'notConnected',
    });
    expect(await snap([42.6, -72.55], [42.6001, -72.55])).toEqual({
      ok: false,
      reason: 'notConnected',
    });
  });

  it('refuses a start and turn more than 30 km apart without asking Overpass', async () => {
    const { snap, overpass } = snapper();
    expect(await snap([42.6, -72.55], [42.9, -72.55])).toEqual({ ok: false, reason: 'tooFar' });
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
    expect(await snap([42.6, -72.55], [42.62, -72.55])).toEqual({
      ok: false,
      reason: 'sourceError',
      error,
    });
  });

  it('caches the waterways, so a nearby course asks Overpass once', async () => {
    const { snap, overpass } = snapper();
    await snap([42.6, -72.5494], [42.62, -72.5494]);
    await snap([42.6001, -72.5495], [42.6199, -72.5493]);
    expect(overpass.getWaterways).toHaveBeenCalledTimes(1);
  });
});

describe('courseBox', () => {
  it('covers both points with a 2 km margin, rounded out to 0.01°', () => {
    const [minLon, minLat, maxLon, maxLat] = courseBox([42.605, -72.5448], [42.6422, -72.4819]);
    expect([minLon, minLat, maxLon, maxLat]).toEqual([-72.57, 42.58, -72.45, 42.67]);
  });
});
