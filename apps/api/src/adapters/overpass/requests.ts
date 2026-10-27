// URLs for OpenStreetMap's Overpass API, used to snap a course to a river (#103). Shared by the
// adapter and the fixture recorder. Usage policy: see docs/DATA_SOURCES.md (Overpass).

export const OVERPASS_BASE_URL = 'https://overpass-api.de/api/interpreter';

// A [minLon, minLat, maxLon, maxLat] box, as geo.ts's boundingBox returns it.
export type Box = readonly [number, number, number, number];

// River and canal centerlines in the box, with their node ids (to join ways) and coordinates.
export function waterwaysUrl([minLon, minLat, maxLon, maxLat]: Box): string {
  const box = [minLat, minLon, maxLat, maxLon].map((v) => v.toFixed(4)).join(',');
  const query = `[out:json][timeout:25];way["waterway"~"^(river|canal)$"](${box});out body geom;`;
  return `${OVERPASS_BASE_URL}?data=${encodeURIComponent(query)}`;
}
