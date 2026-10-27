import { distanceKm } from '@rowing/core';
import { describe, expect, it, vi } from 'vitest';
import {
  COURSE_START,
  COURSE_TURN,
  NORTHAMPTON_DOCK,
  NORTHAMPTON_LOOP,
} from '../../../test/course.ts';
import { createTestDatabase } from '../../../test/database.ts';
import { fixture, json, routedFetch } from '../../../test/fixtures.ts';
import { courseBox, createCourseSnap } from '../../services/courseSnap.ts';
import { createSourceCache } from '../../services/sourceCache.ts';
import type { Logger } from '../http.ts';
import { createOverpassAdapter } from './overpass.ts';

const PATH = '/api/interpreter';

function adapter(respond = fixture('overpass/waterways-turners-falls')) {
  const fetch = routedFetch([{ path: PATH, respond }]);
  const logger: Logger = { warn: vi.fn() };
  return createOverpassAdapter({
    userAgent: 'test (test@example.test)',
    fetch,
    logger,
    retryDelayMs: 0,
  });
}

describe('createOverpassAdapter (#103)', () => {
  it('returns river and canal ways with their node ids and coordinates', async () => {
    const result = await adapter().getWaterways(courseBox([COURSE_START, COURSE_TURN]));
    if (!result.ok) throw new Error('expected ok');
    const connecticut = result.data.filter((w) => w.name === 'Connecticut River');
    expect(connecticut.length).toBeGreaterThan(0);
    for (const way of result.data) {
      expect(way.nodes.length).toBeGreaterThanOrEqual(2);
      for (const n of way.nodes) {
        expect(Number.isInteger(n.id)).toBe(true);
        expect(n.lat).toBeGreaterThan(42.5);
      }
    }
  });

  it('drops coordinates Overpass returns as null, and ways left with fewer than two', async () => {
    const result = await adapter(
      json({
        elements: [
          {
            type: 'way',
            id: 1,
            nodes: [10, 11, 12],
            geometry: [{ lat: 42.6, lon: -72.5 }, null, { lat: 42.61, lon: -72.5 }],
            tags: { waterway: 'river', name: 'A' },
          },
          { type: 'way', id: 2, nodes: [20, 21], geometry: [null, { lat: 42.6, lon: -72.4 }] },
        ],
      }),
    ).getWaterways([-72.6, 42.5, -72.3, 42.7]);
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 1,
          name: 'A',
          nodes: [
            { id: 10, lat: 42.6, lon: -72.5 },
            { id: 12, lat: 42.61, lon: -72.5 },
          ],
        },
      ],
    });
  });

  it('retries once when the server is busy', async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('busy', { status: 502 })
        : new Response(JSON.stringify({ elements: [] }), { status: 200 });
    });
    const overpass = createOverpassAdapter({ userAgent: 'test', fetch, retryDelayMs: 0 });
    expect(await overpass.getWaterways([-72.6, 42.5, -72.3, 42.7])).toEqual({ ok: true, data: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns an error result for a busy server', async () => {
    const result = await adapter(json({}, 504)).getWaterways([-72.6, 42.5, -72.3, 42.7]);
    expect(result).toMatchObject({ ok: false, error: { source: 'overpass', kind: 'http' } });
  });
});

describe('snapping a course on the Connecticut River (recorded)', () => {
  it('follows the river from near the start to near the turn, along its length', async () => {
    const db = await createTestDatabase();
    try {
      const cache = createSourceCache({ db: db.db, logger: { warn: vi.fn() } });
      const snap = createCourseSnap({ overpass: adapter(), cache });
      const result = await snap([COURSE_START, COURSE_TURN]);
      if (!result.ok) throw new Error(`expected a course, got ${result.reason}`);
      const [leg] = result.legs;
      if (!leg || leg.straight) throw new Error(`expected the river, got ${leg?.straight}`);
      const first = leg.points[0] as [number, number];
      const last = leg.points.at(-1) as [number, number];
      expect(distanceKm(...COURSE_START, ...first)).toBeLessThan(0.3);
      expect(distanceKm(...COURSE_TURN, ...last)).toBeLessThan(0.3);
      let km = 0;
      for (let i = 1; i < leg.points.length; i += 1) {
        const [a, b] = [leg.points[i - 1], leg.points[i]] as [[number, number], [number, number]];
        km += distanceKm(...a, ...b);
      }
      // The straight line is about 6.6 km. Above the dam the river runs south and east past
      // Barton Cove and through the French King Gorge before turning north, about 11.3 km:
      // 1.7 times the straight line, so not mistaken for a detour.
      expect(km).toBeGreaterThan(11);
      expect(km).toBeLessThan(11.6);
      // It passes through the gorge, not overland.
      expect(leg.points.some(([lat, lon]) => lat < 42.6 && lon > -72.5)).toBe(true);
    } finally {
      await db.close();
    }
  });
});

describe('snapping the Elwell Island loop at Northampton (recorded, #142)', () => {
  const km = (points: [number, number][]) =>
    points
      .slice(1)
      .reduce((sum, p, i) => sum + distanceKm(...(points[i] as [number, number]), ...p), 0);

  it('follows the river all the way round, with no leg mistaken for a gap', async () => {
    const db = await createTestDatabase();
    try {
      const cache = createSourceCache({ db: db.db, logger: { warn: vi.fn() } });
      const snap = createCourseSnap({
        overpass: adapter(fixture('overpass/waterways-northampton')),
        cache,
      });
      const result = await snap(NORTHAMPTON_LOOP);
      if (!result.ok) throw new Error(`expected a course, got ${result.reason}`);
      expect(result.legs.map((l) => l.straight)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      // Down the side channel to below the bridge, up the main channel, round the head of the
      // island, and back down the side channel: about 0.4, 0.7, 1.0 and 1.5 km.
      const lengths = result.legs.map((l) => km(l.points));
      expect(lengths[0]).toBeLessThan(0.6);
      expect(lengths.reduce((a, b) => a + b, 0)).toBeGreaterThan(3.2);
      expect(lengths.reduce((a, b) => a + b, 0)).toBeLessThan(4);
      // Level with the middle of the island (about 42.338° N), the way up is in the main channel
      // and the way down in the side channel, about 700 m to the west.
      const lonNear = (points: [number, number][]) =>
        points.find(([lat]) => lat > 42.3378 && lat < 42.3392)?.[1];
      expect(lonNear(result.legs[1]?.points ?? [])).toBeGreaterThan(-72.621);
      expect(lonNear(result.legs[3]?.points ?? [])).toBeLessThan(-72.625);
    } finally {
      await db.close();
    }
  });

  it('takes the shorter side channel both ways without a tap in the main channel', async () => {
    const db = await createTestDatabase();
    try {
      const cache = createSourceCache({ db: db.db, logger: { warn: vi.fn() } });
      const snap = createCourseSnap({
        overpass: adapter(fixture('overpass/waterways-northampton')),
        cache,
      });
      const below = NORTHAMPTON_LOOP[1] as [number, number];
      const head = NORTHAMPTON_LOOP[3] as [number, number];
      const result = await snap([NORTHAMPTON_DOCK, below, head, NORTHAMPTON_DOCK]);
      if (!result.ok) throw new Error('expected a course');
      // Up from below the bridge to the head goes up the side channel, as the editor warns.
      expect(Math.max(...(result.legs[1]?.points ?? []).map(([, lon]) => lon))).toBeLessThan(
        -72.615,
      );
      expect(km(result.legs[1]?.points ?? [])).toBeLessThan(2);
    } finally {
      await db.close();
    }
  });
});
