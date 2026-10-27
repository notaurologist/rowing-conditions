import { describe, expect, it } from 'vitest';
import { type Course, SavedLocation } from '../types/location.ts';
import {
  bearingDegrees,
  courseLengthKm,
  courseStretches,
  courseWind,
  legStretches,
  relativeWind,
} from './course.ts';

// About 1 km stretches near Turners Falls: A to B runs north, B to C east.
const A: [number, number] = [42.6, -72.55];
const B: [number, number] = [42.609, -72.55];
const C: [number, number] = [42.609, -72.5378];

const outAndBack = (...points: [number, number][]): Course => ({
  taps: [points[0] as [number, number], points.at(-1) as [number, number]],
  legs: [{ points }],
});

// A to B, then B to C, then straight back from C to A: a triangle.
const triangle: Course = {
  taps: [A, B, C, A],
  legs: [{ points: [A, B] }, { points: [B, C] }, { points: [C, A], straight: true }],
  loop: true,
};

describe('bearingDegrees', () => {
  it('measures from north, clockwise', () => {
    expect(bearingDegrees(42.6, -72.55, 42.7, -72.55)).toBeCloseTo(0, 5);
    expect(bearingDegrees(42.6, -72.55, 42.6, -72.45)).toBeCloseTo(90, 0);
    expect(bearingDegrees(42.7, -72.55, 42.6, -72.55)).toBeCloseTo(180, 5);
    expect(bearingDegrees(42.6, -72.45, 42.6, -72.55)).toBeCloseTo(270, 0);
  });
});

describe('stretches and length', () => {
  it('splits each leg into stretches with their heading and length', () => {
    const [first, second] = courseStretches(outAndBack(A, B, C));
    expect(first?.headingDegrees).toBeCloseTo(0, 5);
    expect(first?.lengthKm).toBeCloseTo(1.0, 1);
    expect(second?.headingDegrees).toBeCloseTo(90, 0);
    expect(second?.lengthKm).toBeCloseTo(1.0, 1);
  });

  it('drops stretches of no length', () => {
    expect(legStretches({ points: [A, A, B] })).toHaveLength(1);
  });

  it('adds up every leg', () => {
    expect(courseLengthKm(triangle)).toBeCloseTo(1 + 1 + Math.SQRT2, 1);
  });
});

describe('relativeWind', () => {
  // Heading north. The wind's direction is where it comes from.
  it.each([
    [0, 'head'],
    [45, 'head'],
    [315, 'head'],
    [46, 'cross'],
    [90, 'cross'],
    [134, 'cross'],
    [135, 'tail'],
    [180, 'tail'],
    [225, 'tail'],
    [226, 'cross'],
    [314, 'cross'],
  ] as const)('wind from %i° is %s', (from, expected) => {
    expect(relativeWind(0, from)).toBe(expected);
  });

  it('works across north for any heading', () => {
    expect(relativeWind(350, 10)).toBe('head');
    expect(relativeWind(10, 350)).toBe('head');
    expect(relativeWind(270, 90)).toBe('tail');
  });
});

describe('courseWind: out and back (#103)', () => {
  it('turns a headwind out into a tailwind back', () => {
    expect(courseWind(outAndBack(A, B), 4, 0)).toEqual({
      state: 'wind',
      kind: 'outAndBack',
      out: { head: 1, cross: 0, tail: 0 },
      back: { head: 0, cross: 0, tail: 1 },
    });
  });

  it('gives each stretch its share of the course length, across every leg', () => {
    const twoLegs: Course = { taps: [A, B, C], legs: [{ points: [A, B] }, { points: [B, C] }] };
    const wind = courseWind(twoLegs, 4, 0); // from the north
    if (wind.state !== 'wind' || wind.kind !== 'outAndBack')
      throw new Error('expected out and back');
    expect(wind.out.head).toBeCloseTo(0.5, 1);
    expect(wind.out.cross).toBeCloseTo(0.5, 1);
    expect(wind.back.tail).toBeCloseTo(0.5, 1);
    expect(wind.out.head + wind.out.cross + wind.out.tail).toBeCloseTo(1, 9);
  });
});

describe('courseWind: loops (#142)', () => {
  it('gives the whole loop and each leg in rowing order, with no way back', () => {
    const wind = courseWind(triangle, 4, 0); // from the north
    if (wind.state !== 'wind' || wind.kind !== 'loop') throw new Error('expected a loop');
    expect(wind.legs).toHaveLength(3);
    expect(wind.legs[0]).toEqual({ head: 1, cross: 0, tail: 0 }); // rowing north
    expect(wind.legs[1]).toEqual({ head: 0, cross: 1, tail: 0 }); // rowing east
    expect(wind.legs[2]?.tail).toBe(1); // rowing southwest, the wind behind
    const total = 1 + 1 + Math.SQRT2;
    expect(wind.whole.head).toBeCloseTo(1 / total, 1);
    expect(wind.whole.cross).toBeCloseTo(1 / total, 1);
    expect(wind.whole.tail).toBeCloseTo(Math.SQRT2 / total, 1);
  });

  it('counts a straight leg like any other', () => {
    const wind = courseWind(triangle, 4, 225); // from the southwest
    if (wind.state !== 'wind' || wind.kind !== 'loop') throw new Error('expected a loop');
    expect(wind.legs[2]).toEqual({ head: 1, cross: 0, tail: 0 });
  });
});

describe('courseWind: calm and unknown', () => {
  it('is calm with no wind, whatever the direction', () => {
    expect(courseWind(triangle, 0, 0)).toEqual({ state: 'calm' });
    expect(courseWind(outAndBack(A, B), 0, null)).toEqual({ state: 'calm' });
  });

  it('is unknown, never calm, without a speed or a direction', () => {
    expect(courseWind(outAndBack(A, B), null, 90)).toEqual({ state: 'unknown' });
    expect(courseWind(outAndBack(A, B), undefined, 90)).toEqual({ state: 'unknown' });
    expect(courseWind(triangle, 3, null)).toEqual({ state: 'unknown' });
  });

  it('is unknown for a course with no length', () => {
    expect(courseWind(outAndBack(A, A), 3, 90)).toEqual({ state: 'unknown' });
  });
});

describe('SavedLocation course', () => {
  const location = { id: 'l', name: 'Turners Falls', lat: 42.6, lon: -72.55, ruleSetIds: [] };

  it('is optional, so locations saved before courses still parse', () => {
    expect(SavedLocation.safeParse(location).success).toBe(true);
  });

  it('reads a course saved before loops as one leg from start to turn', () => {
    const parsed = SavedLocation.parse({
      ...location,
      course: { points: [A, B, C], notes: 'Keep east.' },
    });
    expect(parsed.course).toEqual({
      taps: [A, C],
      legs: [{ points: [A, B, C] }],
      notes: 'Keep east.',
    });
  });

  it('needs one leg between each pair of taps', () => {
    expect(SavedLocation.safeParse({ ...location, course: triangle }).success).toBe(true);
    expect(
      SavedLocation.safeParse({
        ...location,
        course: { ...triangle, legs: triangle.legs.slice(1) },
      }).success,
    ).toBe(false);
  });

  it('needs taps and points in range, and keeps notes short', () => {
    expect(SavedLocation.safeParse({ ...location, course: { points: [A] } }).success).toBe(false);
    expect(
      SavedLocation.safeParse({ ...location, course: outAndBack([95, 0], [0, 0]) }).success,
    ).toBe(false);
    expect(
      SavedLocation.safeParse({ ...location, course: { ...triangle, notes: 'x'.repeat(501) } })
        .success,
    ).toBe(false);
  });
});
