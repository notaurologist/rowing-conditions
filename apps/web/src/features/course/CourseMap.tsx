import 'leaflet/dist/leaflet.css';
import { divIcon, type LatLngBoundsExpression } from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Coordinates } from '../../lib/api.ts';

// The course on the map: tap points in rowing order; drag any to move it (#103, #142).
// Same tiles and attribution as the location map (LocationMap.tsx).
const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Text markers: Leaflet's default marker images don't survive bundling, and a label says which
// point is which without relying on color.
const tapIcon = (label: string, name: string) =>
  divIcon({
    className: 'course-end',
    html: `<span class="course-end-letter" aria-label="${name}">${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

export interface MapLeg {
  points: readonly [number, number][];
  straight: boolean;
}

interface Props {
  center: Coordinates;
  taps: readonly Coordinates[]; // in rowing order; a loop's last tap is its first, drawn once
  loop: boolean;
  legs: readonly MapLeg[];
  onTap: (point: Coordinates) => void;
  onMoveTap: (index: number, point: Coordinates) => void;
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

// Fits the view to a saved course when the editor opens. Not after each tap: the view moving under
// the rower's finger would put the next tap somewhere else.
function FitSavedCourse({ legs }: Pick<Props, 'legs'>) {
  const map = useMap();
  const [initial] = useState(legs);
  useEffect(() => {
    const points = initial.flatMap((l) => l.points);
    if (points.length < 2) return;
    map.fitBounds(points as unknown as LatLngBoundsExpression, { padding: [24, 24] });
  }, [map, initial]);
  return null;
}

const toCoordinates = (target: { getLatLng(): { lat: number; lng: number } }): Coordinates => {
  const { lat, lng } = target.getLatLng();
  return { lat, lon: lng };
};

export default function CourseMap(props: Props) {
  const { center, taps, loop, legs } = props;
  // A loop's closing tap is its start; it isn't drawn twice.
  const shown = loop ? taps.slice(0, -1) : taps;
  const icons = useMemo(
    () =>
      shown.map((_, i) =>
        i === 0
          ? tapIcon('S', 'Start')
          : !loop && i === shown.length - 1 && shown.length > 1
            ? tapIcon('T', 'Turn')
            : tapIcon(String(i), `Point ${i}`),
      ),
    [shown, loop],
  );
  return (
    <MapContainer
      className="location-map"
      center={[center.lat, center.lon]}
      zoom={13}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <TapToPlace onTap={props.onTap} />
      <FitSavedCourse legs={legs} />
      {legs.map((leg, i) => (
        <Polyline
          // biome-ignore lint/suspicious/noArrayIndexKey: legs are positional, between taps i and i + 1
          key={i}
          positions={leg.points as [number, number][]}
          // A straight leg is dashed, so it isn't told apart by color alone.
          pathOptions={{
            color: '#1f5fa8',
            weight: 4,
            // Set every time: Leaflet keeps a dash that's left out when a leg stops being straight.
            dashArray: leg.straight ? '6 8' : '',
          }}
        />
      ))}
      {shown.map((tap, i) => (
        <Marker
          // biome-ignore lint/suspicious/noArrayIndexKey: a tap's place in the order is its identity
          key={i}
          position={[tap.lat, tap.lon]}
          icon={icons[i]}
          draggable
          eventHandlers={{ dragend: (e) => props.onMoveTap(i, toCoordinates(e.target)) }}
        />
      ))}
    </MapContainer>
  );
}
