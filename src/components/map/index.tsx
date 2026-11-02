"use client";

import dynamic from "next/dynamic";

/* Leaflet touches `window`, so the maps are only rendered in the browser. */

function MapLoading({ height = 280 }: { height?: number }) {
  return <div className="animate-pulse rounded-lg border border-line bg-sand" style={{ height }} />;
}

export const LocationPicker = dynamic(() => import("./leaflet-maps").then((m) => m.LocationPicker), {
  ssr: false,
  loading: () => <MapLoading />,
});

export const DonationsMap = dynamic(() => import("./leaflet-maps").then((m) => m.DonationsMap), {
  ssr: false,
  loading: () => <MapLoading height={380} />,
});

export type { MapPoint } from "./leaflet-maps";
