import { Terrain } from '../../src/sim/world/terrain';
import { fillRings, type CellPoint } from './fill';
import type { District, LonLatPoint } from './types';

/** Densities from this up are painted and drawn as residential, lower ones as suburb. */
const RESIDENTIAL_FROM = 4;

/** The ground code a district is painted with. */
export function districtCode(d: Pick<District, 'type' | 'density'>): number {
  if (d.type !== 'housing') return Terrain[d.type];
  return (d.density ?? 1) >= RESIDENTIAL_FROM ? Terrain.residential : Terrain.suburb;
}

/** The ground codes with buildings, in the order of their style indices in the map file (MapBuilding.style). */
const STYLE_CODES: readonly number[] = [Terrain.downtown, Terrain.residential, Terrain.suburb, Terrain.industrial];

/** The style index a district's buildings carry; -1 for a park, which has none. */
export const districtStyleIndex = (d: Pick<District, 'type' | 'density'>): number => STYLE_CODES.indexOf(districtCode(d));

/**
 * Paints each district's ground code into `terrain`, in file order, so a later district (a park inside downtown) wins.
 * `toCells` turns a lon/lat line into cell coordinates through the map field; `allowed` keeps water and airports.
 */
export function paintDistricts(
  districts: readonly District[],
  toCells: (line: readonly LonLatPoint[]) => CellPoint[],
  cols: number,
  rows: number,
  allowed: (index: number) => boolean,
  terrain: Uint8Array,
): void {
  for (const d of districts) {
    // Close the ring, so the closing edge is subdivided and bent like the others.
    const first = d.ring[0] as LonLatPoint;
    const code = districtCode(d);
    fillRings([toCells([...d.ring, first])], cols, rows, (i) => {
      if (allowed(i)) terrain[i] = code;
    });
  }
}
