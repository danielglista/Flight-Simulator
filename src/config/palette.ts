import { Terrain } from '../sim/world/terrain';

export type Rgb = readonly [number, number, number];

/** Placeholder colors. H1 replaces them. */
export const TERRAIN_COLORS: Readonly<Record<number, Rgb>> = {
  [Terrain.seabed]: [150, 138, 110],
  [Terrain.grass]: [88, 142, 62],
  [Terrain.forest]: [36, 92, 50],
  [Terrain.farmland]: [176, 164, 84],
  [Terrain.desert]: [216, 192, 132],
  [Terrain.mountain]: [124, 112, 100],
  [Terrain.snow]: [240, 244, 250],
  [Terrain.urban]: [152, 152, 162],
  [Terrain.road]: [58, 58, 64],
  [Terrain.airport]: [100, 100, 112],
  [Terrain.runway]: [44, 44, 50],
  [Terrain.taxiway]: [78, 78, 86],
};

/** Water color runs from shallow to deep with depth (real meters). */
export const WATER_SHALLOW: Rgb = [48, 176, 170]; // teal, so shallow water is not the sky blue
export const WATER_DEEP: Rgb = [20, 48, 104];
export const WATER_DEEP_M = 60;
export const SEA_COLOR: Rgb = WATER_DEEP;

export function waterColor(depthRealM: number): Rgb {
  const t = Math.min(1, Math.max(0, depthRealM / WATER_DEEP_M));
  return [
    WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * t,
    WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * t,
    WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * t,
  ];
}

/** Side-view sky bands, top to bottom, and the probe marker. Placeholders until H1. */
export const SKY_BANDS: readonly string[] = ['#16345f', '#1f4a80', '#2f6aa3', '#5a93c4'];
export const MARKER_COLOR = '#ffd34d';
