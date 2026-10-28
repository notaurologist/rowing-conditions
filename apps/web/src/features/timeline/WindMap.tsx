import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer } from 'react-leaflet';
import type { WindWords } from './meteogramModel.ts';

// The wind over the water at the chart's hour: a small, muted map with arrows pointing where the
// wind blows, so head, cross and tail can be read against the river. Context only, like light.
// Same tiles and attribution as the location map (LocationMap.tsx).
const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CELLS = Array.from({ length: 15 }, (_, i) => `cell${i}`); // a grid of 5 by 3

interface Props {
  lat: number;
  lon: number;
  wind: WindWords;
  label: string; // the hour, "Today 3 PM"
}

export default function WindMap({ lat, lon, wind, label }: Props) {
  return (
    <figure className="wind-map">
      <div className="wind-map-frame">
        <MapContainer
          className="wind-map-tiles"
          center={[lat, lon]}
          zoom={14}
          zoomControl={false}
          scrollWheelZoom={false}
        >
          <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        </MapContainer>
        {wind.toward !== null && (
          <div className="wind-map-arrows" aria-hidden="true">
            {CELLS.map((cell) => (
              <svg
                key={cell}
                aria-hidden="true"
                viewBox="-12 -12 24 24"
                style={{ rotate: `${wind.toward}deg` }}
              >
                <path d="M0 10V-9M-5-4l5-5 5 5" />
              </svg>
            ))}
          </div>
        )}
      </div>
      <figcaption>
        Wind {label}: {wind.text}
      </figcaption>
    </figure>
  );
}
