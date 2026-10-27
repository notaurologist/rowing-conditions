import { z } from 'zod';
import { GaugeRef, Id } from './measurement.ts';

const LatLon = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

// A course as it's rowed (#103, #142): the points tapped, in rowing order, and between each pair a
// leg that follows the river, or a straight line where the river map has a gap or the rower
// chose one. A loop ends where it started. Notes hold local rules, such as which bank to keep to
// going upstream; the app shows them and doesn't model them.
export const CourseLeg = z.object({
  points: z.array(LatLon).min(2),
  straight: z.boolean().optional(), // drawn as a straight line between its taps
});
export type CourseLeg = z.infer<typeof CourseLeg>;

const CourseShape = z
  .object({
    taps: z.array(LatLon).min(2),
    legs: z.array(CourseLeg).min(1),
    loop: z.boolean().optional(), // rowed around and back to the first tap; otherwise out and back
    notes: z.string().trim().max(500).optional(),
  })
  .refine((c) => c.legs.length === c.taps.length - 1, {
    message: 'A course has one leg between each pair of taps',
    path: ['legs'],
  });

// Courses saved before #142 were one line from start to turn: { points, notes? }.
function fromStartAndTurn(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('points' in value) || 'legs' in value)
    return value;
  const { points, notes } = value as { points: unknown; notes?: unknown };
  if (!Array.isArray(points) || points.length < 2) return value;
  return {
    taps: [points[0], points[points.length - 1]],
    legs: [{ points }],
    ...(notes !== undefined ? { notes } : {}),
  };
}

export const Course = z.preprocess(fromStartAndTurn, CourseShape);
export type Course = z.infer<typeof CourseShape>;

export const SavedLocation = z.object({
  id: Id,
  name: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  gaugeRef: GaugeRef.optional(), // default gauge for display; omitted = weather-only
  ruleSetIds: z.array(Id),
  course: Course.optional(),
});
export type SavedLocation = z.infer<typeof SavedLocation>;
