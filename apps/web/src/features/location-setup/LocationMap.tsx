import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Coordinates } from '../../lib/api.ts';

// OpenStreetMap's tile policy asks for a configurable URL, so tiles can move to another
// provider without a code change, and for visible attribution.
// https://operations.osmfoundation.org/policies/tiles/
const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CONTIGUOUS_US: Coordinates = { lat: 39.5, lon: -98.35 };

interface Props {
  point: Coordinates | null;
  onPick: (point: Coordinates) => void;
}

function ClickToPick({ onPick }: Pick<Props, 'onPick'>) {
  useMapEvents({
    // wrap(): past the antimeridian Leaflet reports longitudes beyond ±180.
    click: (event) => {
      const { lat, lng } = event.latlng.wrap();
      onPick({ lat, lon: lng });
    },
  });
  return null;
}

// Moves the view when the point changes from outside the map (my location, search).
function FollowPoint({ point }: Pick<Props, 'point'>) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    if (!map.getBounds().contains([point.lat, point.lon]) || map.getZoom() < 10) {
      map.setView([point.lat, point.lon], Math.max(map.getZoom(), 12));
    }
  }, [map, point]);
  return null;
}

export default function LocationMap({ point, onPick }: Props) {
  const center = point ?? CONTIGUOUS_US;
  return (
    <MapContainer
      className="location-map"
      center={[center.lat, center.lon]}
      zoom={point ? 12 : 4}
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <ClickToPick onPick={onPick} />
      <FollowPoint point={point} />
      {point && (
        <CircleMarker
          center={[point.lat, point.lon]}
          radius={9}
          pathOptions={{ color: '#1f5fa8', weight: 3, fillOpacity: 0.3 }}
        />
      )}
    </MapContainer>
  );
}
