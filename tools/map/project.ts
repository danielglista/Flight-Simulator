/**
 * Lat/lon to real kilometers. Cylindrical, true at 39 N, centered on 96 W (E_PLAN §4.1).
 * North is +y everywhere, so grid headings equal compass headings.
 */
export const KM_PER_DEG_LAT = 111.0;
export const KM_PER_DEG_LON_EQUATOR = 111.32;
export const REF_LAT_DEG = 39;
export const CENTER_LON_DEG = -96;

const KM_PER_DEG_LON = KM_PER_DEG_LON_EQUATOR * Math.cos((REF_LAT_DEG * Math.PI) / 180);

export interface PointKm {
  readonly x: number;
  readonly y: number;
}

export function project(latDeg: number, lonDeg: number): PointKm {
  return {
    x: (lonDeg - CENTER_LON_DEG) * KM_PER_DEG_LON,
    y: (latDeg - REF_LAT_DEG) * KM_PER_DEG_LAT,
  };
}

export function unproject(xKm: number, yKm: number): { readonly lat: number; readonly lon: number } {
  return {
    lat: yKm / KM_PER_DEG_LAT + REF_LAT_DEG,
    lon: xKm / KM_PER_DEG_LON + CENTER_LON_DEG,
  };
}
