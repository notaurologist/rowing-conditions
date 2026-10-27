import type { AppType } from '@rowing/api';
import type { GaugeRef } from '@rowing/core';
import { DetailedError, hc, parseResponse } from 'hono/client';

// Typed client for apps/api. Response types come from the API's routes (AppType), so a
// change to a route's output is a type error here. Every call throws on a non-2xx
// response, so TanStack Query reports it as an error, never as empty data.

export function createApiClient(baseUrl: string, options?: Parameters<typeof hc>[1]) {
  return hc<AppType>(baseUrl, options);
}

export type ApiClient = ReturnType<typeof createApiClient>;

// In development Vite proxies /api to the API on :3000 (vite.config.ts).
export const api = createApiClient(import.meta.env.VITE_API_URL ?? '/api');

export interface Coordinates {
  lat: number;
  lon: number;
}

const coordinateQuery = ({ lat, lon }: Coordinates) => ({ lat: String(lat), lon: String(lon) });

export async function fetchNearbyGauges(client: ApiClient, at: Coordinates) {
  const body = await parseResponse(client.gauges.nearby.$get({ query: coordinateQuery(at) }));
  return body.gauges;
}

/** Called only when the user submits a search: the geocoder's policy forbids autocomplete. */
export async function fetchPlaces(client: ApiClient, query: string) {
  const body = await parseResponse(client.places.search.$get({ query: { q: query } }));
  return body.places;
}

/** Legs following the river between each pair of taps, in rowing order (#103, #142). Can take a
 * minute: the river data comes from a public service that is slow when busy. */
export async function fetchCourse(client: ApiClient, taps: readonly Coordinates[]) {
  const body = await parseResponse(
    client.course.snap.$get({
      query: { taps: taps.map(({ lat, lon }) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join(';') },
    }),
  );
  return body.legs;
}

export type SnappedLeg = Awaited<ReturnType<typeof fetchCourse>>[number];

export function fetchConditions(
  client: ApiClient,
  at: Coordinates & { gaugeRef?: GaugeRef; flowGaugeRefs?: readonly GaugeRef[] },
) {
  return parseResponse(
    client.conditions.$get({
      query: {
        ...coordinateQuery(at),
        ...(at.gaugeRef ? { gaugeRef: at.gaugeRef } : {}),
        ...(at.flowGaugeRefs?.length ? { flowGaugeRefs: at.flowGaugeRefs.join(',') } : {}),
      },
    }),
  );
}

export type Conditions = Awaited<ReturnType<typeof fetchConditions>>;

/** A message for the user: the API's own message when it sent one. */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof DetailedError) {
    // A 400 is a bug in this client; the validator's message lists Zod issues, not words for users.
    if (error.statusCode === 400) return `The API rejected the request (${error.message})`;
    const data = (error.detail as { data?: unknown } | undefined)?.data;
    const message = (data as { error?: { message?: unknown } } | undefined)?.error?.message;
    if (typeof message === 'string') return message;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
