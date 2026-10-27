import 'leaflet/dist/leaflet.css';
import { divIcon, type LatLngBoundsExpression } from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Coordinates } from '../../lib/api.ts';

// The course on the map: tap the start, then the turn; drag either to move it (#103).
// Same tiles and attribution as the location map (LocationMap.tsx).
const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Text markers: Leaflet's default marker images don't survive bundling, and a letter says which
// end is which without relying on color.
const endIcon = (letter: 'S' | 'T', label: string) =>
  divIcon({
    className: 'course-end',
    html: `<span class="course-end-letter" aria-label="${label}">${letter}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
const START_ICON = endIcon('S', 'Start');
const TURN_ICON = endIcon('T', 'Turn');

interface Props {
  center: Coordinates;
  start: Coordinates | null;
  turn: Coordinates | null;
  points: readonly [number, number][]; // the course along the river, once found
  onTap: (point: Coordinates) => void;
  onMoveStart: (point: Coordinates) => void;
  onMoveTurn: (point: Coordinates) => void;
}

function TapToPlace({ onTap }: Pick<Props, 'onTap'>) {
  useMapEvents({
    click: (event) => {
      const { lat, lng } = event.latlng.wrap();
      onTap({ lat, lon: lng });
    },
  });
  return null;
}

// Fits the view to the course when one is found.
function FitCourse({ points }: Pick<Props, 'points'>) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(points as unknown as LatLngBoundsExpression, { padding: [24, 24] });
  }, [map, points]);
  return null;
}

const toCoordinates = (target: { getLatLng(): { lat: number; lng: number } }): Coordinates => {
  const { lat, lng } = target.getLatLng();
  return { lat, lon: lng };
};

export default function CourseMap(props: Props) {
  const { center, start, turn, points } = props;
  return (
    <MapContainer
      className="location-map"
      center={[center.lat, center.lon]}
      zoom={13}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <TapToPlace onTap={props.onTap} />
      <FitCourse points={points} />
      {points.length >= 2 && (
        <Polyline
          positions={points as [number, number][]}
          pathOptions={{ color: '#1f5fa8', weight: 4 }}
        />
      )}
      {start && (
        <Marker
          position={[start.lat, start.lon]}
          icon={START_ICON}
          draggable
          eventHandlers={{ dragend: (e) => props.onMoveStart(toCoordinates(e.target)) }}
        />
      )}
      {turn && (
        <Marker
          position={[turn.lat, turn.lon]}
          icon={TURN_ICON}
          draggable
          eventHandlers={{ dragend: (e) => props.onMoveTurn(toCoordinates(e.target)) }}
        />
      )}
    </MapContainer>
  );
}
