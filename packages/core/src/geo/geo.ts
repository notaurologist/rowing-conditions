const EARTH_RADIUS_KM = 6371.0088; // mean radius
const KM_PER_DEGREE_LAT = (2 * Math.PI * EARTH_RADIUS_KM) / 360; // about 111.19

const radians = (degrees: number) => (degrees * Math.PI) / 180;

// Great-circle distance between two points, in km.
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// A [minLon, minLat, maxLon, maxLat] box that contains every point within radiusKm.
export function boundingBox(
  lat: number,
  lon: number,
  radiusKm: number,
): [number, number, number, number] {
  const dLat = radiusKm / KM_PER_DEGREE_LAT;
  const dLon = radiusKm / (KM_PER_DEGREE_LAT * Math.max(Math.cos(radians(lat)), 0.01));
  return [
    Math.max(-180, lon - dLon),
    Math.max(-90, lat - dLat),
    Math.min(180, lon + dLon),
    Math.min(90, lat + dLat),
  ];
}
