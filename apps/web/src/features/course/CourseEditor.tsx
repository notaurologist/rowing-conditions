import { type Course, courseLengthKm, distanceKm, type SavedLocation } from '@rowing/core';
import { lazy, Suspense, useState } from 'react';
import {
  api,
  apiErrorMessage,
  type Coordinates,
  fetchCourse,
  type SnappedLeg,
} from '../../lib/api.ts';
import { useAppStorage, useStoredData } from '../../lib/useStoredData.ts';
import type { MapLeg } from './CourseMap.tsx';

const CourseMap = lazy(() => import('./CourseMap.tsx'));

// A tap this close to the start closes a loop.
const CLOSE_LOOP_KM = 0.05;

const at = ([lat, lon]: readonly [number, number]): Coordinates => ({ lat, lon });
const pair = ({ lat, lon }: Coordinates): [number, number] => [lat, lon];

// Why a leg is a straight line, in words.
const STRAIGHT_WORDS: Record<NonNullable<SnappedLeg['straight']> | 'chosen', string> = {
  noRiver: 'straight line: no mapped river within 300 m of one of its points',
  notConnected: "straight line: its points aren't on connected waterways in the map",
  detour:
    'straight line: the map only joins its points the long way round, which looks like a gap in the map',
  chosen: 'straight line, as you chose',
};

interface Leg {
  river?: SnappedLeg; // what the map gave, when it has been asked
  chosenStraight: boolean;
}

function straightPoints(a: Coordinates, b: Coordinates): [number, number][] {
  return [pair(a), pair(b)];
}

// The leg as drawn and saved: the river route, unless it's straight by choice or by the map.
function shape(
  leg: Leg,
  a: Coordinates,
  b: Coordinates,
): MapLeg & { why?: keyof typeof STRAIGHT_WORDS } {
  if (leg.chosenStraight) return { points: straightPoints(a, b), straight: true, why: 'chosen' };
  if (!leg.river) return { points: straightPoints(a, b), straight: true };
  if (leg.river.straight)
    return { points: straightPoints(a, b), straight: true, why: leg.river.straight };
  return { points: leg.river.points, straight: false };
}

// Sets the course at a location (#103, #142): tap points in rowing order, and the course follows
// the river between them. Out and back by default; tapping the start again makes it a loop.
export function CourseEditor({
  location,
  onDone,
}: {
  location: SavedLocation;
  onDone: () => void;
}) {
  const storage = useAppStorage();
  const { locations } = useStoredData();
  const saved = location.course;
  const [taps, setTaps] = useState<Coordinates[]>(saved ? saved.taps.map(at) : []);
  const [legs, setLegs] = useState<Leg[]>(
    saved
      ? saved.legs.map((l) => ({
          river: { points: l.points as [number, number][] },
          chosenStraight: l.straight === true,
        }))
      : [],
  );
  const [loop, setLoop] = useState(saved?.loop === true);
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Asks for the whole course again, keeping each leg's straight-line choice.
  const follow = async (next: Coordinates[], chosen: boolean[]) => {
    setTaps(next);
    setLegs(chosen.map((c) => ({ chosenStraight: c })));
    if (next.length < 2) return;
    setFinding(true);
    setProblem(null);
    try {
      const river = await fetchCourse(api, next);
      setLegs(river.map((r, i) => ({ river: r, chosenStraight: chosen[i] ?? false })));
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setFinding(false);
    }
  };
  const chosen = () => legs.map((l) => l.chosenStraight);

  const tap = (point: Coordinates) => {
    if (finding || loop) return;
    const first = taps[0];
    if (
      first &&
      taps.length >= 2 &&
      distanceKm(first.lat, first.lon, point.lat, point.lon) <= CLOSE_LOOP_KM
    ) {
      setLoop(true);
      void follow([...taps, first], [...chosen(), false]);
      return;
    }
    void follow([...taps, point], taps.length > 0 ? [...chosen(), false] : []);
  };

  const moveTap = (index: number, point: Coordinates) => {
    const next = taps.map((t, i) =>
      i === index || (loop && index === 0 && i === taps.length - 1) ? point : t,
    );
    void follow(next, chosen());
  };

  // Takes back the last point; after closing a loop, that reopens it.
  const undo = () => {
    setLoop(false);
    void follow(taps.slice(0, -1), chosen().slice(0, -1));
  };

  const startOver = () => {
    setLoop(false);
    setTaps([]);
    setLegs([]);
    setProblem(null);
  };

  const toggleStraight = (index: number) =>
    setLegs(legs.map((l, i) => (i === index ? { ...l, chosenStraight: !l.chosenStraight } : l)));

  const shaped = legs.map((leg, i) =>
    shape(leg, taps[i] as Coordinates, taps[i + 1] as Coordinates),
  );
  const ready =
    taps.length >= 2 &&
    legs.length === taps.length - 1 &&
    legs.every((l) => l.river || l.chosenStraight);
  const trimmed = notes.trim();
  const course: Course | undefined = ready
    ? {
        taps: taps.map(pair),
        legs: shaped.map((l) => ({
          points: [...l.points],
          ...(l.straight ? { straight: true } : {}),
        })),
        ...(loop ? { loop: true } : {}),
        ...(trimmed ? { notes: trimmed } : {}),
      }
    : undefined;

  const save = (next: Course | undefined) => {
    try {
      storage.saveLocations(
        locations.map((l) => {
          if (l.id !== location.id) return l;
          const { course: _, ...rest } = l;
          return next ? { ...rest, course: next } : rest;
        }),
      );
      onDone();
    } catch (error) {
      setProblem(`Couldn't save the course: ${String(error)}`);
    }
  };

  const status = finding
    ? 'Finding the river between your points… this can take up to a minute.'
    : taps.length === 0
      ? 'Tap where you start.'
      : taps.length === 1
        ? 'Tap the next point.'
        : loop
          ? 'Loop closed.'
          : 'Tap the next point, or tap the start again to close a loop.';

  return (
    <section aria-labelledby="course-heading" className="course-editor">
      <h2 id="course-heading">Course at {location.name}</h2>
      <p>
        Tap where you start, such as the dock, then each point in rowing order. The course follows
        the river between them, using OpenStreetMap. For out and back, finish where you turn; the
        way back is the same course reversed. For a loop, tap the start again. Going around an
        island, put a point in each channel, or the course takes the shorter one. Drag any point to
        move it.
      </p>
      <Suspense fallback={<div className="location-map map-loading">Loading map…</div>}>
        <CourseMap
          center={taps[0] ?? { lat: location.lat, lon: location.lon }}
          taps={taps}
          loop={loop}
          legs={shaped}
          onTap={tap}
          onMoveTap={moveTap}
        />
      </Suspense>
      <p className="reading-meta" role="status">
        {status}
      </p>
      {problem && (
        <p role="alert" className="notice notice-error">
          {problem}
        </p>
      )}
      {shaped.length > 0 && (
        <>
          <p>
            {loop ? 'Loop' : 'Out and back'}
            {course
              ? `, ${courseLengthKm(course).toFixed(1)} km ${loop ? 'around' : 'each way'}`
              : ''}
            :
          </p>
          <ol className="course-legs">
            {shaped.map((leg, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: legs are positional, between taps i and i + 1
              <li key={i}>
                Leg {i + 1}:{' '}
                {leg.straight
                  ? leg.why
                    ? STRAIGHT_WORDS[leg.why]
                    : 'waiting for the map'
                  : 'follows the river'}
                {(legs[i]?.river || legs[i]?.chosenStraight) && !legs[i]?.river?.straight && (
                  <>
                    {' '}
                    <button type="button" className="link-button" onClick={() => toggleStraight(i)}>
                      {legs[i]?.chosenStraight ? 'Follow the river' : 'Use a straight line'}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      <label className="field">
        <span>Notes (optional)</span>
        <textarea
          value={notes}
          maxLength={500}
          rows={3}
          placeholder="Local rules, for example: keep to the east bank going upstream."
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="setup-actions">
        <button type="button" disabled={!course || finding} onClick={() => save(course)}>
          Save course
        </button>
        <button type="button" disabled={taps.length === 0 || finding} onClick={undo}>
          Undo last point
        </button>
        <button type="button" disabled={taps.length === 0 || finding} onClick={startOver}>
          Start over
        </button>
        {saved && (
          <button type="button" onClick={() => save(undefined)}>
            Remove course
          </button>
        )}
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </section>
  );
}
