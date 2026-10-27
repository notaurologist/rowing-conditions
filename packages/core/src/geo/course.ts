import type { Course } from '../types/location.ts';
import { distanceKm } from './geo.ts';

// Wind relative to a course rowed out and back (#103). Context only, like light: it never
// affects whether an hour is within limits.

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (radians: number) => (radians * 180) / Math.PI;

// Initial great-circle bearing from one point to another, in degrees from north, 0 to below 360.
export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const lat1R = radians(lat1);
  const lat2R = radians(lat2);
  const dLon = radians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

export interface CourseStretch {
  headingDegrees: number; // direction of travel on the way out
  lengthKm: number;
}

// The course as stretches between its points, in the order rowed on the way out. Stretches of no
// length (repeated points) are dropped.
export function courseStretches(course: Course): CourseStretch[] {
  const stretches: CourseStretch[] = [];
  for (let i = 1; i < course.points.length; i += 1) {
    const [lat1, lon1] = course.points[i - 1] as [number, number];
    const [lat2, lon2] = course.points[i] as [number, number];
    const lengthKm = distanceKm(lat1, lon1, lat2, lon2);
    if (lengthKm > 0)
      stretches.push({ headingDegrees: bearingDegrees(lat1, lon1, lat2, lon2), lengthKm });
  }
  return stretches;
}

export type RelativeWind = 'head' | 'cross' | 'tail';

// Within 45° of dead ahead is a headwind, within 45° of dead astern a tailwind, and the quarters
// between are crosswind. windFrom is meteorological: the direction the wind comes from.
export function relativeWind(headingDegrees: number, windFromDegrees: number): RelativeWind {
  const off = Math.abs(((windFromDegrees - headingDegrees + 540) % 360) - 180); // 0 to 180
  if (off <= 45) return 'head';
  if (off >= 135) return 'tail';
  return 'cross';
}

export type LegShares = Record<RelativeWind, number>; // fractions of the course length, summing to 1

export type CourseWind =
  | { state: 'wind'; out: LegShares; back: LegShares }
  | { state: 'calm' } // no wind to be head, cross or tail
  | { state: 'unknown' }; // speed or direction missing: never treated as calm

function shares(stretches: readonly CourseStretch[], windFrom: number, back: boolean): LegShares {
  const total = stretches.reduce((sum, s) => sum + s.lengthKm, 0);
  const result: LegShares = { head: 0, cross: 0, tail: 0 };
  for (const s of stretches) {
    const heading = back ? (s.headingDegrees + 180) % 360 : s.headingDegrees;
    result[relativeWind(heading, windFrom)] += s.lengthKm / total;
  }
  return result;
}

// The share of the course with a headwind, crosswind and tailwind, out and back, for one hour's
// wind. A single forecast wind applies to the whole course; shelter from banks isn't in it.
export function courseWind(
  course: Course,
  windSpeed: number | null | undefined,
  windFromDegrees: number | null | undefined,
): CourseWind {
  if (typeof windSpeed !== 'number') return { state: 'unknown' };
  if (windSpeed === 0) return { state: 'calm' };
  if (typeof windFromDegrees !== 'number') return { state: 'unknown' };
  const stretches = courseStretches(course);
  if (stretches.length === 0) return { state: 'unknown' };
  return {
    state: 'wind',
    out: shares(stretches, windFromDegrees, false),
    back: shares(stretches, windFromDegrees, true),
  };
}
