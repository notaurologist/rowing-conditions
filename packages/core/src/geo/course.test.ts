import { describe, expect, it } from 'vitest';
import type { Course } from '../types/location.ts';
import { SavedLocation } from '../types/location.ts';
import { bearingDegrees, courseStretches, courseWind, relativeWind } from './course.ts';

// About 1 km stretches near Turners Falls.
const north: Course = {
  points: [
    [42.6, -72.55],
    [42.609, -72.55],
  ],
};
const northThenEast: Course = {
  points: [
    [42.6, -72.55],
    [42.609, -72.55],
    [42.609, -72.5378],
  ],
};

describe('bearingDegrees', () => {
  it('measures from north, clockwise', () => {
    expect(bearingDegrees(42.6, -72.55, 42.7, -72.55)).toBeCloseTo(0, 5);
    expect(bearingDegrees(42.6, -72.55, 42.6, -72.45)).toBeCloseTo(90, 0);
    expect(bearingDegrees(42.7, -72.55, 42.6, -72.55)).toBeCloseTo(180, 5);
    expect(bearingDegrees(42.6, -72.45, 42.6, -72.55)).toBeCloseTo(270, 0);
  });
});

describe('courseStretches', () => {
  it('splits the course into stretches with their heading and length', () => {
    const [first, second] = courseStretches(northThenEast);
    expect(first?.headingDegrees).toBeCloseTo(0, 5);
    expect(first?.lengthKm).toBeCloseTo(1.0, 1);
    expect(second?.headingDegrees).toBeCloseTo(90, 0);
    expect(second?.lengthKm).toBeCloseTo(1.0, 1);
  });

  it('drops stretches of no length', () => {
    expect(
      courseStretches({
        points: [
          [42.6, -72.55],
          [42.6, -72.55],
          [42.609, -72.55],
        ],
      }),
    ).toHaveLength(1);
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

describe('courseWind (#103)', () => {
  it('turns a headwind out into a tailwind back', () => {
    expect(courseWind(north, 4, 0)).toEqual({
      state: 'wind',
      out: { head: 1, cross: 0, tail: 0 },
      back: { head: 0, cross: 0, tail: 1 },
    });
  });

  it('gives each stretch its share of the course length', () => {
    const wind = courseWind(northThenEast, 4, 0); // from the north
    if (wind.state !== 'wind') throw new Error('expected wind');
    expect(wind.out.head).toBeCloseTo(0.5, 1);
    expect(wind.out.cross).toBeCloseTo(0.5, 1);
    expect(wind.back.tail).toBeCloseTo(0.5, 1);
    expect(wind.back.cross).toBeCloseTo(0.5, 1);
    expect(wind.out.head + wind.out.cross + wind.out.tail).toBeCloseTo(1, 9);
  });

  it('is calm with no wind, whatever the direction', () => {
    expect(courseWind(north, 0, 0)).toEqual({ state: 'calm' });
    expect(courseWind(north, 0, null)).toEqual({ state: 'calm' });
  });

  it('is unknown, never calm, without a speed or a direction', () => {
    expect(courseWind(north, null, 90)).toEqual({ state: 'unknown' });
    expect(courseWind(north, undefined, 90)).toEqual({ state: 'unknown' });
    expect(courseWind(north, 3, null)).toEqual({ state: 'unknown' });
  });

  it('is unknown for a course with no length', () => {
    expect(
      courseWind(
        {
          points: [
            [42.6, -72.55],
            [42.6, -72.55],
          ],
        },
        3,
        90,
      ),
    ).toEqual({
      state: 'unknown',
    });
  });
});

describe('SavedLocation course', () => {
  const location = { id: 'l', name: 'Turners Falls', lat: 42.6, lon: -72.55, ruleSetIds: [] };

  it('is optional, so locations saved before courses still parse', () => {
    expect(SavedLocation.safeParse(location).success).toBe(true);
  });

  it('needs at least two points in range, and keeps notes short', () => {
    expect(SavedLocation.safeParse({ ...location, course: north }).success).toBe(true);
    expect(
      SavedLocation.safeParse({ ...location, course: { points: [[42.6, -72.55]] } }).success,
    ).toBe(false);
    expect(
      SavedLocation.safeParse({
        ...location,
        course: {
          points: [
            [95, 0],
            [0, 0],
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      SavedLocation.safeParse({ ...location, course: { ...north, notes: 'x'.repeat(501) } })
        .success,
    ).toBe(false);
  });
});
