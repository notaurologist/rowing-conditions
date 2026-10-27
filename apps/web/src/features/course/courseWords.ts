import {
  type Course,
  type CourseWind,
  courseWind,
  type ForecastPoint,
  type LegShares,
} from '@rowing/core';

// Wind along the saved course, in words, for each hour (#103, #142). Context only, like light and
// fog: it never changes whether an hour is within limits.

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

export interface CourseWindWords {
  summary: string; // under the readout: out and back, or the whole loop
  detail: string; // in the hourly table: for a loop, each leg too
}

export function courseWindWords(wind: CourseWind): CourseWindWords {
  if (wind.state === 'unknown')
    return { summary: 'Course wind unknown', detail: 'Course wind unknown' };
  if (wind.state === 'calm') return { summary: 'Calm on the course', detail: 'Calm on the course' };
  if (wind.kind === 'outAndBack') {
    const words = `Out: ${legWords(wind.out)}. Back: ${legWords(wind.back)}.`;
    return { summary: words, detail: words };
  }
  const summary = `Loop: ${legWords(wind.whole)}.`;
  const legs = wind.legs.map((leg, i) => `Leg ${i + 1}: ${legWords(leg)}.`).join(' ');
  return { summary, detail: `${summary} ${legs}` };
}

export function courseWindByHour(
  course: Pick<Course, 'legs' | 'loop'>,
  forecast: readonly ForecastPoint[],
): CourseWindWords[] {
  return forecast.map((p) =>
    courseWindWords(courseWind(course, p.values.windSpeed, p.values.windDirection)),
  );
}
