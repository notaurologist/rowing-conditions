import { type GaugeRef, SavedLocation } from '@rowing/core';

// crypto.randomUUID exists only in secure contexts, so a phone testing over the LAN
// (plain http) falls back to random bytes.
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Five decimals is about a metre: finer than a map click means anything.
const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

export function newLocation(input: {
  name: string;
  lat: number;
  lon: number;
  gaugeRef: GaugeRef | null;
}): SavedLocation {
  return SavedLocation.parse({
    id: newId(),
    name: input.name, // the schema trims it
    lat: round5(input.lat),
    lon: round5(input.lon),
    ...(input.gaugeRef ? { gaugeRef: input.gaugeRef } : {}),
    ruleSetIds: [],
  });
}
