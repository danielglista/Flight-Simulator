import { runwayAt, surfaceAt, type WorldGrid } from '../sim/world/grid';
import { TERRAIN_NAMES, Terrain } from '../sim/world/terrain';

/** Readout name for the surface at (x, y): `runway 07/25 TST` on a runway, else the terrain name. */
export function surfaceName(grid: WorldGrid, x: number, y: number): string {
  const code = surfaceAt(grid, x, y);
  if (code === Terrain.runway) {
    const hit = runwayAt(grid, x, y);
    if (hit) return `runway ${hit.runway.names.join('/')} ${hit.airport.ident}`;
  }
  return TERRAIN_NAMES[code] ?? '?';
}
