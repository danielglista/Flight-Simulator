import { blendWeight } from './airport';
import { airportAt, surfaceAt, type WorldGrid } from './grid';
import { Terrain } from './terrain';

/** What the wheels roll on. `rough` is everything else, and always a crash. */
export type GroundKind = 'paved' | 'grass' | 'rough';

/**
 * Paved is runway, taxiway or apron; grass is any other surface inside an airport. Both need the flat
 * interior (blend weight 1), so wheels only ever roll on level ground. Everything else, water included, is rough.
 */
export function groundKindAt(grid: WorldGrid, x: number, y: number): GroundKind {
  const airport = airportAt(grid, x, y);
  if (!airport || blendWeight(airport, x, y) < 1) return 'rough';
  const s = surfaceAt(grid, x, y);
  return s === Terrain.runway || s === Terrain.taxiway || s === Terrain.airport ? 'paved' : 'grass';
}
