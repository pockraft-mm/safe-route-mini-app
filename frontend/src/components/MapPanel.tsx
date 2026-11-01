import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LocationPoint } from '../types';

export function MapPanel({ locations }: { locations: LocationPoint[] }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!element.current || map.current) return;
    map.current = new maplibregl.Map({
      container: element.current,
      style: import.meta.env.VITE_MAP_STYLE_URL ?? 'https://demotiles.maplibre.org/style.json',
      center: [96.15, 16.85],
      zoom: 4,
    });
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || locations.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    locations.forEach((point) => {
      bounds.extend([point.longitude, point.latitude]);
      new maplibregl.Marker({ color: '#a78bfa' }).setLngLat([point.longitude, point.latitude]).addTo(map.current!);
    });
    map.current.fitBounds(bounds, { padding: 48, maxZoom: 15 });
  }, [locations]);

  return <div className="map-panel" ref={element} aria-label="Shared locations map" />;
}
