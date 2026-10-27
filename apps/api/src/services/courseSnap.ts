import { boundingBox, distanceKm } from '@rowing/core';
import { z } from 'zod';
import type { SourceError } from '../adapters/http.ts';
import { Waterway, type WaterwaySource } from '../adapters/overpass/overpass.ts';
import type { Box } from '../adapters/overpass/requests.ts';
import { cacheTtlMs, type SourceCache } from './sourceCache.ts';

// Snapping a course to the river (#103, #142): the rower taps points in rowing order, and each leg
// between two taps follows OpenStreetMap's river centerline. Where the map can't give a sensible
// route, the leg is a straight line and says why. Rivers don't move, so the waterways are cached
// for weeks, one fetch for the area around every tap.

// A tap must be this close to a river node to snap to it. Banks and docks sit beside the
// centerline; farther than this, the point probably isn't on the river.
export const SNAP_MAX_KM = 0.3;
// The taps must fit in this span, so the query stays small.
export const COURSE_MAX_KM = 30;
export const COURSE_MAX_TAPS = 12;
// A route this many times the straight line, and at least DETOUR_MIN_KM longer, is taken as a gap
// in the map rather than the way rowed: for example a side channel mapped as not rejoining the
// river, which sends the route around an island. Meanders rarely double the distance.
export const DETOUR_RATIO = 2.5;
export const DETOUR_MIN_KM = 0.5;
// Waterways are fetched this far around the taps, so a bend outside them is included.
const MARGIN_KM = 2;

const Waterways = z.array(Waterway);

export type LatLon = readonly [number, number];

export interface SnappedLeg {
  points: [number, number][];
  // Why the leg is a straight line between its taps, when it is: no mapped river near a tap, the
  // two taps on waterways that don't meet, or a route that looks like a gap in the map.
  straight?: 'noRiver' | 'notConnected' | 'detour';
}

export type SnapResult =
  | { ok: true; legs: SnappedLeg[] }
  | { ok: false; reason: 'tooFar' | 'tooMany' }
  | { ok: false; reason: 'sourceError'; error: SourceError };

export type SnapCourse = (taps: readonly LatLon[]) => Promise<SnapResult>;

// The box around every tap, widened by the margin, rounded so nearby courses share a cache entry.
export function courseBox(taps: readonly LatLon[]): Box {
  const boxes = taps.map(([lat, lon]) => boundingBox(lat, lon, MARGIN_KM));
  const down = (v: number) => Math.floor(v * 100) / 100;
  const up = (v: number) => Math.ceil(v * 100) / 100;
  return [
    down(Math.min(...boxes.map((b) => b[0]))),
    down(Math.min(...boxes.map((b) => b[1]))),
    up(Math.max(...boxes.map((b) => b[2]))),
    up(Math.max(...boxes.map((b) => b[3]))),
  ];
}

interface Graph {
  at: Map<number, LatLon>;
  next: Map<number, { to: number; km: number }[]>;
}

// Ways join where they share a node, as river sections do at confluences and splits.
function graphOf(waterways: readonly Waterway[]): Graph {
  const at = new Map<number, LatLon>();
  const next = new Map<number, { to: number; km: number }[]>();
  const link = (a: number, b: number, km: number) => {
    const list = next.get(a) ?? [];
    list.push({ to: b, km });
    next.set(a, list);
  };
  for (const way of waterways) {
    for (const node of way.nodes) at.set(node.id, [node.lat, node.lon]);
    for (let i = 1; i < way.nodes.length; i += 1) {
      const a = way.nodes[i - 1] as Waterway['nodes'][number];
      const b = way.nodes[i] as Waterway['nodes'][number];
      const km = distanceKm(a.lat, a.lon, b.lat, b.lon);
      link(a.id, b.id, km);
      link(b.id, a.id, km);
    }
  }
  return { at, next };
}

function nearestNode(graph: Graph, [lat, lon]: LatLon): number | undefined {
  let best: number | undefined;
  let bestKm = SNAP_MAX_KM;
  for (const [id, [nLat, nLon]] of graph.at) {
    const km = distanceKm(lat, lon, nLat, nLon);
    if (km <= bestKm) {
      best = id;
      bestKm = km;
    }
  }
  return best;
}

// Shortest path along the waterways (Dijkstra), with its length. A few thousand nodes at most, so
// a linear scan for the next node is fast enough.
function shortestPath(
  graph: Graph,
  from: number,
  to: number,
): { path: number[]; km: number } | undefined {
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open = new Set<number>([from]);
  const done = new Set<number>();
  while (open.size > 0) {
    let current: number | undefined;
    for (const id of open)
      if (current === undefined || (dist.get(id) ?? Infinity) < (dist.get(current) ?? Infinity))
        current = id;
    if (current === undefined || current === to) break;
    open.delete(current);
    done.add(current);
    for (const { to: n, km } of graph.next.get(current) ?? []) {
      if (done.has(n)) continue;
      const d = (dist.get(current) ?? Infinity) + km;
      if (d < (dist.get(n) ?? Infinity)) {
        dist.set(n, d);
        prev.set(n, current);
        open.add(n);
      }
    }
  }
  const km = dist.get(to);
  if (km === undefined) return undefined;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0] as number) as number);
  return { path, km };
}

function snapLeg(graph: Graph, a: LatLon, b: LatLon): SnappedLeg {
  const straight = (why: NonNullable<SnappedLeg['straight']>): SnappedLeg => ({
    points: [
      [a[0], a[1]],
      [b[0], b[1]],
    ],
    straight: why,
  });
  const from = nearestNode(graph, a);
  const to = nearestNode(graph, b);
  if (from === undefined || to === undefined) return straight('noRiver');
  if (from === to) return straight('notConnected'); // both taps by the same point of the river
  const route = shortestPath(graph, from, to);
  if (!route) return straight('notConnected');
  const direct = distanceKm(a[0], a[1], b[0], b[1]);
  if (route.km > DETOUR_RATIO * direct && route.km - direct >= DETOUR_MIN_KM)
    return straight('detour');
  return { points: route.path.map((id) => [...(graph.at.get(id) as LatLon)]) };
}

export function createCourseSnap(deps: {
  overpass: WaterwaySource;
  cache: SourceCache;
}): SnapCourse {
  return async (taps) => {
    if (taps.length < 2 || taps.length > COURSE_MAX_TAPS) return { ok: false, reason: 'tooMany' };
    for (const a of taps)
      for (const b of taps)
        if (distanceKm(a[0], a[1], b[0], b[1]) > COURSE_MAX_KM)
          return { ok: false, reason: 'tooFar' };

    const box = courseBox(taps);
    const result = await deps.cache.get(
      `osm:waterways:${box.join(',')}`,
      cacheTtlMs.waterways,
      Waterways,
      () => deps.overpass.getWaterways(box),
    );
    if (result.status === 'error') return { ok: false, reason: 'sourceError', error: result.error };

    const graph = graphOf(result.data);
    const legs: SnappedLeg[] = [];
    for (let i = 1; i < taps.length; i += 1)
      legs.push(snapLeg(graph, taps[i - 1] as LatLon, taps[i] as LatLon));
    return { ok: true, legs };
  };
}
