import {
  type Course,
  type CourseWind,
  courseWind,
  type ForecastPoint,
  type LegShares,
} from '@rowing/core';

// Wind along the saved course, in words, for each hour (#103). Context only, like light and fog:
// it never changes whether an hour is within limits.

const NAMES = { head: 'headwind', cross: 'crosswind', tail: 'tailwind' } as const;

// "headwind 60%, crosswind 40%": the kinds present on the leg, largest share first.
export function legWords(shares: LegShares): string {
  return (Object.entries(shares) as [keyof LegShares, number][])
    .map(([kind, share]) => [kind, Math.round(share * 100)] as const)
    .filter(([, percent]) => percent > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, percent]) => `${NAMES[kind]} ${percent}%`)
    .join(', ');
}

export function courseWindWords(wind: CourseWind): string {
  if (wind.state === 'unknown') return 'Course wind unknown';
  if (wind.state === 'calm') return 'Calm on the course';
  return `Out: ${legWords(wind.out)}. Back: ${legWords(wind.back)}.`;
}

export function courseWindByHour(course: Course, forecast: readonly ForecastPoint[]): string[] {
  return forecast.map((p) =>
    courseWindWords(courseWind(course, p.values.windSpeed, p.values.windDirection)),
  );
}
