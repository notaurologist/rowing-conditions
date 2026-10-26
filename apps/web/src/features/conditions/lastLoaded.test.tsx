import { ConditionsResponse } from '@rowing/core';
import { DetailedError } from 'hono/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import recorded from '../../../test/fixtures/conditions-montague.json' with { type: 'json' };
import type { Conditions } from '../../lib/api.ts';
import { LoadProblem } from './CurrentConditions.tsx';
import { type QueryState, requestKey, shownConditions } from './lastLoaded.ts';

const live = structuredClone(recorded) as Conditions;
const kept = {
  request: 'r',
  loadedAt: '2026-10-26T09:00:00.000Z',
  conditions: ConditionsResponse.parse(recorded),
};
const LOADED_AT = Date.parse('2026-10-26T13:00:00.000Z');

const query = (state: Partial<QueryState>): QueryState => ({
  data: undefined,
  dataUpdatedAt: 0,
  error: null,
  offline: false,
  ...state,
});

describe('requestKey', () => {
  const at = { lat: 42.6, lon: -72.55, gaugeRef: 'usgs:USGS-01170500' as const };

  it('is the same for the same gauges in any order', () => {
    expect(requestKey({ ...at, flowGaugeRefs: ['usgs:A', 'usgs:B'] })).toBe(
      requestKey({ ...at, flowGaugeRefs: ['usgs:B', 'usgs:A'] }),
    );
  });

  it('differs when the location, its gauge or a rule set gauge differs', () => {
    const base = requestKey({ ...at, flowGaugeRefs: [] });
    expect(requestKey({ ...at, lat: 42.7, flowGaugeRefs: [] })).not.toBe(base);
    expect(requestKey({ ...at, gaugeRef: undefined, flowGaugeRefs: [] })).not.toBe(base);
    expect(requestKey({ ...at, flowGaugeRefs: ['usgs:A'] })).not.toBe(base);
  });
});

describe('shownConditions', () => {
  it('shows loaded conditions with their load time, without reading the kept copy', () => {
    const read = vi.fn(() => kept);
    expect(shownConditions(query({ data: live, dataUpdatedAt: LOADED_AT }), read)).toEqual({
      kind: 'conditions',
      conditions: live,
      loadedAt: '2026-10-26T13:00:00.000Z',
      problem: null,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('is loading while the first load runs, even with a kept copy', () => {
    expect(shownConditions(query({}), () => kept)).toEqual({ kind: 'loading' });
  });

  it('shows the kept copy and its age when offline', () => {
    expect(shownConditions(query({ offline: true }), () => kept)).toEqual({
      kind: 'conditions',
      conditions: kept.conditions,
      loadedAt: kept.loadedAt,
      problem: { kind: 'offline' },
    });
  });

  it('shows the kept copy when the load failed', () => {
    const error = new Error('Network down');
    expect(shownConditions(query({ error }), () => kept)).toMatchObject({
      kind: 'conditions',
      loadedAt: kept.loadedAt,
      problem: { kind: 'failed', error },
    });
  });

  it('says why when there is no kept copy', () => {
    expect(shownConditions(query({ offline: true }), () => null)).toEqual({ kind: 'offline' });
    const error = new Error('Network down');
    expect(shownConditions(query({ error }), () => null)).toEqual({ kind: 'failed', error });
  });

  it('keeps showing what this session loaded when a refresh fails or goes offline', () => {
    const error = new Error('Network down');
    const failed = shownConditions(
      query({ data: live, dataUpdatedAt: LOADED_AT, error }),
      () => kept,
    );
    expect(failed).toMatchObject({ conditions: live, problem: { kind: 'failed' } });
    const offline = shownConditions(
      query({ data: live, dataUpdatedAt: LOADED_AT, offline: true }),
      () => kept,
    );
    expect(offline).toMatchObject({ conditions: live, problem: { kind: 'offline' } });
  });
});

describe('LoadProblem', () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, '').replaceAll('&#x27;', "'");
  const render = (props: Parameters<typeof LoadProblem>[0]) =>
    renderToStaticMarkup(<LoadProblem {...props} />);
  const shownKept = (problem: { kind: 'offline' } | { kind: 'failed'; error: unknown }) =>
    ({
      kind: 'conditions',
      conditions: kept.conditions,
      loadedAt: kept.loadedAt,
      problem,
    }) as const;
  const when = '4 h ago, at 5:00 AM';

  it('says offline and when the shown conditions were loaded', () => {
    const html = render({ shown: shownKept({ kind: 'offline' }), when, onRetry: () => {} });
    expect(html).toContain('role="status"');
    expect(text(html)).toBe(
      "Offline. Showing conditions loaded 4 h ago, at 5:00 AM. They update when you're back online.",
    );
  });

  it('says offline with nothing loaded yet', () => {
    expect(text(render({ shown: { kind: 'offline' }, onRetry: () => {} }))).toBe(
      "Offline. No conditions have been loaded for this location on this device yet. They load when you're back online.",
    );
  });

  it('gives the error, the age of what is shown, and a retry', () => {
    const error = new DetailedError('502 Bad Gateway', { statusCode: 502 });
    const html = render({ shown: shownKept({ kind: 'failed', error }), when, onRetry: () => {} });
    expect(html).toContain('role="alert"');
    expect(text(html)).toBe(
      "Couldn't load new conditions. 502 Bad Gateway. Showing conditions loaded 4 h ago, at 5:00 AM.Try again",
    );
  });

  it('gives the error and a retry with nothing loaded', () => {
    const shown = { kind: 'failed', error: new Error('Network down') } as const;
    expect(text(render({ shown, onRetry: () => {} }))).toBe(
      "Couldn't load conditions. Network down.Try again",
    );
  });

  it('shows nothing when the conditions are current', () => {
    const shown = { ...shownKept({ kind: 'offline' }), problem: null };
    expect(render({ shown, onRetry: () => {} })).toBe('');
  });
});
