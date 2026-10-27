import type { Course, CourseLeg } from '../types/location.ts';
import { distanceKm } from './geo.ts';

// Wind relative to a course (#103, #142). Context only, like light: it never affects whether an
// hour is within limits.

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
  headingDegrees: number; // direction of travel, in rowing order
  lengthKm: number;
}

// A leg as stretches between its points, in rowing order. Stretches of no length are dropped.
export function legStretches(leg: Pick<CourseLeg, 'points'>): CourseStretch[] {
  const stretches: CourseStretch[] = [];
  for (let i = 1; i < leg.points.length; i += 1) {
    const [lat1, lon1] = leg.points[i - 1] as [number, number];
    const [lat2, lon2] = leg.points[i] as [number, number];
    const lengthKm = distanceKm(lat1, lon1, lat2, lon2);
    if (lengthKm > 0)
      stretches.push({ headingDegrees: bearingDegrees(lat1, lon1, lat2, lon2), lengthKm });
  }
  return stretches;
}

// Every leg's stretches, in rowing order.
export function courseStretches(course: Pick<Course, 'legs'>): CourseStretch[] {
  return course.legs.flatMap(legStretches);
}

export function courseLengthKm(course: Pick<Course, 'legs'>): number {
  return courseStretches(course).reduce((sum, s) => sum + s.lengthKm, 0);
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

export type LegShares = Record<RelativeWind, number>; // fractions of the length, summing to 1

export type CourseWind =
  // Out and back along the course: out in tap order, back reversed.
  | { state: 'wind'; kind: 'outAndBack'; out: LegShares; back: LegShares }
  // A loop: the whole of it, and each leg between taps, in rowing order.
  | { state: 'wind'; kind: 'loop'; whole: LegShares; legs: LegShares[] }
  | { state: 'calm' } // no wind to be head, cross or tail
  | { state: 'unknown' }; // speed or direction missing: never treated as calm

function shares(
  stretches: readonly CourseStretch[],
  windFrom: number,
  reversed: boolean,
): LegShares | undefined {
  const total = stretches.reduce((sum, s) => sum + s.lengthKm, 0);
  if (total === 0) return undefined;
  const result: LegShares = { head: 0, cross: 0, tail: 0 };
  for (const s of stretches) {
    const heading = reversed ? (s.headingDegrees + 180) % 360 : s.headingDegrees;
    result[relativeWind(heading, windFrom)] += s.lengthKm / total;
  }
  return result;
}

const NONE: LegShares = { head: 0, cross: 0, tail: 0 };

// The share of the course with a headwind, crosswind and tailwind for one hour's wind. A single
// forecast wind applies to the whole course; shelter from banks isn't in it.
export function courseWind(
  course: Pick<Course, 'legs' | 'loop'>,
  windSpeed: number | null | undefined,
  windFromDegrees: number | null | undefined,
): CourseWind {
  if (typeof windSpeed !== 'number') return { state: 'unknown' };
  if (windSpeed === 0) return { state: 'calm' };
  if (typeof windFromDegrees !== 'number') return { state: 'unknown' };
  const all = courseStretches(course);
  const whole = shares(all, windFromDegrees, false);
  if (!whole) return { state: 'unknown' };
  if (course.loop) {
    const legs = course.legs.map(
      (leg) => shares(legStretches(leg), windFromDegrees, false) ?? NONE,
    );
    return { state: 'wind', kind: 'loop', whole, legs };
  }
  return {
    state: 'wind',
    kind: 'outAndBack',
    out: whole,
    back: shares(all, windFromDegrees, true) as LegShares,
  };
}
