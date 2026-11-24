import { Terrain } from '../sim/world/terrain';

export type Rgb = readonly [number, number, number];

/** Placeholder colors. H1 replaces them. */
export const TERRAIN_COLORS: Readonly<Record<number, Rgb>> = {
  [Terrain.water]: [30, 72, 140],
  [Terrain.grass]: [88, 142, 62],
  [Terrain.forest]: [36, 92, 50],
  [Terrain.farmland]: [176, 164, 84],
  [Terrain.desert]: [216, 192, 132],
  [Terrain.mountain]: [124, 112, 100],
  [Terrain.snow]: [240, 244, 250],
  [Terrain.urban]: [152, 152, 162],
  [Terrain.road]: [58, 58, 64],
  [Terrain.airport]: [100, 100, 112],
};

export const SEA_COLOR: Rgb = TERRAIN_COLORS[Terrain.water] as Rgb;
