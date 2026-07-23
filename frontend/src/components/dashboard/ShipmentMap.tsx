'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

// Dynamically import Leaflet components to avoid SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

// We still need L for custom icons or other direct leaflet manipulation
let L: any;
if (typeof window !== 'undefined') {
  L = require('leaflet');
}

type MilestoneType = 'farm' | 'warehouse' | 'port' | 'importer';

interface Milestone {
  id: string;
  milestone: MilestoneType;
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
}

interface ShipmentMapProps {
  tradeDealId: string;
  className?: string;
}

const customIcon = typeof window !== 'undefined' ? L?.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background-color: #16a34a; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
}) : null;

export const ShipmentMap: React.FC<ShipmentMapProps> = ({
  tradeDealId,
  className = '',
}) => {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMilestones = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('auth_token');
      if (!token) throw new Error('Authentication required');

      const res = await fetch(`/api/shipments/${tradeDealId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to fetch milestones');

      const raw = await res.json();
      const normalized: Milestone[] = (raw ?? []).map((m: any) => ({
        id: m.id,
        milestone: m.milestone,
        recordedAt: m.recordedAt ?? m.recorded_at,
        latitude: typeof m.latitude === 'number' ? m.latitude : 
                 m.latitude ? Number(m.latitude) : null,
        longitude: typeof m.longitude === 'number' ? m.longitude : 
                  m.longitude ? Number(m.longitude) : null,
      }));

      setMilestones(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load map');
    } finally {
      setLoading(false);
    }
  }, [tradeDealId]);

  useEffect(() => {
    fetchMilestones();
  }, [fetchMilestones]);

  const points = useMemo(
    () =>
      milestones
        .filter((m) => typeof m.latitude === 'number' && typeof m.longitude === 'number')
        .map((m) => ({ ...m, lat: m.latitude as number, lng: m.longitude as number })),
    [milestones],
  );

  const center: [number, number] = points.length > 0 
    ? [points[points.length - 1].lat, points[points.length - 1].lng]
    : [0, 0];

  const polylinePoints = points.map(p => [p.lat, p.lng] as [number, number]);

  if (loading) {
    return (
      <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-6 ${className}`}>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Shipment Map</h3>
        <p className="text-sm text-gray-400 animate-pulse">Loading map…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <p className="text-red-800 text-sm font-medium">{error}</p>
        <button
          onClick={fetchMilestones}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Shipment Map</h3>
          <p className="text-xs text-gray-500 mt-0.5">Physical journey of the produce</p>
        </div>
        <button
          onClick={fetchMilestones}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 bg-brand-50 px-2 py-1 rounded-md transition-colors"
        >
          Refresh Data
        </button>
      </div>

      {points.length === 0 ? (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-xl p-8 text-center border border-dashed border-gray-200">
          <p className="text-2xl mb-2">📍</p>
          No milestone coordinates recorded yet.
        </div>
      ) : (
        <div className="h-[400px] w-full rounded-xl overflow-hidden border border-gray-200 shadow-inner relative z-0">
          <MapContainer 
            center={center} 
            zoom={4} 
            scrollWheelZoom={false} 
            className="h-full w-full"
            style={{ minHeight: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {points.map((p) => (
              <Marker key={p.id} position={[p.lat, p.lng]} icon={customIcon}>
                <Popup>
                  <div className="text-xs font-semibold uppercase">{p.milestone}</div>
                  <div className="text-[10px] text-gray-500">{new Date(p.recordedAt).toLocaleString()}</div>
                </Popup>
              </Marker>
            ))}
            {polylinePoints.length >= 2 && (
              <Polyline positions={polylinePoints} color="#2563eb" weight={3} opacity={0.7} dashArray="5, 10" />
            )}
          </MapContainer>
        </div>
      )}
      
      <style jsx global>{`
        .leaflet-container {
          width: 100%;
          height: 100%;
        }
        .leaflet-control-container .leaflet-top {
          z-index: 10;
        }
      `}</style>
    </div>
  );
};

