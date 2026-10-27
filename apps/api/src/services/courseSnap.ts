import { boundingBox, distanceKm } from '@rowing/core';
import { z } from 'zod';
import type { SourceError } from '../adapters/http.ts';
import { Waterway, type WaterwaySource } from '../adapters/overpass/overpass.ts';
import type { Box } from '../adapters/overpass/requests.ts';
import { cacheTtlMs, type SourceCache } from './sourceCache.ts';

// Snapping a course to the river (#103): the user taps the start and the turn, and the course
// follows OpenStreetMap's river centerline between them. Rivers don't move, so the waterways are
// cached for weeks.

// A tapped point must be this close to a river node to snap to it. Banks and docks sit beside the
// centerline; farther than this, the point probably isn't on the river.
export const SNAP_MAX_KM = 0.3;
// Beyond this between start and turn, the query would cover too much map to be worth it.
export const COURSE_MAX_KM = 30;
// Waterways are fetched this far around the two points, so a bend outside them is included.
const MARGIN_KM = 2;

const Waterways = z.array(Waterway);

type LatLon = readonly [number, number];

export type SnapResult =
  | { ok: true; points: [number, number][] }
  | { ok: false; reason: 'tooFar' | 'noRiver' | 'notConnected' }
  | { ok: false; reason: 'sourceError'; error: SourceError };

export type SnapCourse = (start: LatLon, turn: LatLon) => Promise<SnapResult>;

// The box around both points, widened by the margin, rounded so nearby taps share a cache entry.
export function courseBox(start: LatLon, turn: LatLon): Box {
  const [aMinLon, aMinLat, aMaxLon, aMaxLat] = boundingBox(start[0], start[1], MARGIN_KM);
  const [bMinLon, bMinLat, bMaxLon, bMaxLat] = boundingBox(turn[0], turn[1], MARGIN_KM);
  const down = (v: number) => Math.floor(v * 100) / 100;
  const up = (v: number) => Math.ceil(v * 100) / 100;
  return [
    down(Math.min(aMinLon, bMinLon)),
    down(Math.min(aMinLat, bMinLat)),
    up(Math.max(aMaxLon, bMaxLon)),
    up(Math.max(aMaxLat, bMaxLat)),
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

// Shortest path along the waterways (Dijkstra). A few thousand nodes at most, so a linear scan
// for the next node is fast enough.
function shortestPath(graph: Graph, from: number, to: number): number[] | undefined {
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open = new Set<number>([from]);
  const done = new Set<number>();
  while (open.size > 0) {
    let current: number | undefined;
    for (const id of open)
      if (current === undefined || (dist.get(id) ?? Infinity) < (dist.get(current) ?? Infinity))
        current = id;
    if (current === undefined) break;
    if (current === to) break;
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
  if (!dist.has(to)) return undefined;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0] as number) as number);
  return path;
}

export function createCourseSnap(deps: {
  overpass: WaterwaySource;
  cache: SourceCache;
}): SnapCourse {
  return async (start, turn) => {
    if (distanceKm(start[0], start[1], turn[0], turn[1]) > COURSE_MAX_KM)
      return { ok: false, reason: 'tooFar' };
    const box = courseBox(start, turn);
    const result = await deps.cache.get(
      `osm:waterways:${box.join(',')}`,
      cacheTtlMs.waterways,
      Waterways,
      () => deps.overpass.getWaterways(box),
    );
    if (result.status === 'error') return { ok: false, reason: 'sourceError', error: result.error };

    const graph = graphOf(result.data);
    const from = nearestNode(graph, start);
    const to = nearestNode(graph, turn);
    if (from === undefined || to === undefined) return { ok: false, reason: 'noRiver' };
    if (from === to) return { ok: false, reason: 'notConnected' };
    const path = shortestPath(graph, from, to);
    if (!path) return { ok: false, reason: 'notConnected' };
    return { ok: true, points: path.map((id) => [...(graph.at.get(id) as LatLon)]) };
  };
}
