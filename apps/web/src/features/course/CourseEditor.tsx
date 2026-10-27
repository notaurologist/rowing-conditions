import type { Course, SavedLocation } from '@rowing/core';
import { lazy, Suspense, useState } from 'react';
import { api, apiErrorMessage, type Coordinates, fetchCourse } from '../../lib/api.ts';
import { useAppStorage, useStoredData } from '../../lib/useStoredData.ts';

const CourseMap = lazy(() => import('./CourseMap.tsx'));

const at = ([lat, lon]: readonly [number, number]): Coordinates => ({ lat, lon });

// Sets the course rowed out and back at a location (#103): tap the start, then the turn, and the
// course follows the river between them. Saved with the location.
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
  const [start, setStart] = useState<Coordinates | null>(
    saved ? at(saved.points[0] as [number, number]) : null,
  );
  const [turn, setTurn] = useState<Coordinates | null>(
    saved ? at(saved.points.at(-1) as [number, number]) : null,
  );
  const [points, setPoints] = useState<[number, number][]>(saved ? [...saved.points] : []);
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const follow = async (from: Coordinates, to: Coordinates) => {
    setFinding(true);
    setProblem(null);
    setPoints([]);
    try {
      setPoints(await fetchCourse(api, from, to));
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setFinding(false);
    }
  };

  const tap = (point: Coordinates) => {
    if (finding) return;
    if (!start || (start && turn)) {
      // A first tap, or starting over after a course.
      setStart(point);
      setTurn(null);
      setPoints([]);
      setProblem(null);
      return;
    }
    setTurn(point);
    void follow(start, point);
  };

  const save = (course: Course | undefined) => {
    try {
      storage.saveLocations(
        locations.map((l) => {
          if (l.id !== location.id) return l;
          const { course: _, ...rest } = l;
          return course ? { ...rest, course } : rest;
        }),
      );
      onDone();
    } catch (error) {
      setProblem(`Couldn't save the course: ${String(error)}`);
    }
  };

  const trimmed = notes.trim();
  const course: Course | undefined =
    points.length >= 2 ? { points, ...(trimmed ? { notes: trimmed } : {}) } : undefined;

  return (
    <section aria-labelledby="course-heading" className="course-editor">
      <h2 id="course-heading">Course at {location.name}</h2>
      <p>
        Tap where you start, such as the dock, then where you turn. The course follows the river
        between them, using OpenStreetMap. Drag S or T to move either end. Wind is then shown for
        the way out and the way back.
      </p>
      <Suspense fallback={<div className="location-map map-loading">Loading map…</div>}>
        <CourseMap
          center={start ?? { lat: location.lat, lon: location.lon }}
          start={start}
          turn={turn}
          points={points}
          onTap={tap}
          onMoveStart={(p) => {
            setStart(p);
            if (turn) void follow(p, turn);
          }}
          onMoveTurn={(p) => {
            setTurn(p);
            if (start) void follow(start, p);
          }}
        />
      </Suspense>
      <p className="reading-meta" role="status">
        {finding
          ? 'Finding the river between them… this can take up to a minute.'
          : !start
            ? 'Tap the start.'
            : !turn
              ? 'Tap the turn.'
              : points.length >= 2
                ? 'The course follows the river. Tap again to start over.'
                : ''}
      </p>
      {problem && (
        <p role="alert" className="notice notice-error">
          {problem}
        </p>
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
