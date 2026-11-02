"use client";

import { useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMapEvents } from "react-leaflet";

/*
 * Leaflet + OpenStreetMap tiles (free, no API key).
 * Pins are CSS div-icons, which avoids Leaflet's default marker images whose
 * paths break under bundlers.
 */

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const pin = (tone: "brand" | "leaf" | "ink") =>
  L.divIcon({ className: "", html: `<div class="fl-pin fl-pin--${tone}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });

// ---------- location picker (forms) ----------

function ClickToMove({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function LocationPicker({
  lat,
  lng,
  latName = "lat",
  lngName = "lng",
  height = 280,
}: {
  lat: number;
  lng: number;
  latName?: string;
  lngName?: string;
  height?: number;
}) {
  const [pos, setPos] = useState<[number, number]>([lat, lng]);
  const set = (a: number, b: number) => setPos([Number(a.toFixed(6)), Number(b.toFixed(6))]);

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-line" style={{ height }}>
        <MapContainer center={pos} zoom={13} scrollWheelZoom={false} style={{ height: "100%" }}>
          <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
          <ClickToMove onPick={set} />
          <Marker
            position={pos}
            icon={pin("brand")}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                set(p.lat, p.lng);
              },
            }}
          />
        </MapContainer>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        Click the map or drag the pin. {pos[0].toFixed(4)}, {pos[1].toFixed(4)}
      </p>
      <input type="hidden" name={latName} value={pos[0]} />
      <input type="hidden" name={lngName} value={pos[1]} />
    </div>
  );
}

// ---------- listings map ----------

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  href?: string;
};

export function DonationsMap({
  points,
  center,
  centerLabel = "You",
  radiusKm,
  height = 380,
}: {
  points: MapPoint[];
  center: [number, number];
  centerLabel?: string;
  radiusKm?: number;
  height?: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line" style={{ height }}>
      <MapContainer center={center} zoom={12} scrollWheelZoom={false} style={{ height: "100%" }}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        {radiusKm && (
          <Circle
            center={center}
            radius={radiusKm * 1000}
            pathOptions={{ color: "#b4532a", weight: 1, fillOpacity: 0.04, dashArray: "4 6" }}
          />
        )}
        <Marker position={center} icon={pin("ink")}>
          <Popup>{centerLabel}</Popup>
        </Marker>
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={pin("leaf")}>
            <Popup>
              <strong>{p.title}</strong>
              {p.subtitle && <div>{p.subtitle}</div>}
              {p.href && (
                <a href={p.href} style={{ color: "#b4532a" }}>
                  Open
                </a>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
