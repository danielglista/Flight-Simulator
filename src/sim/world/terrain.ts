/**
 * Terrain codes. They will be written to files, so the numbers must not change.
 * A const object rather than an enum, so the values stay plain numbers.
 */
export const Terrain = {
  water: 0,
  grass: 1,
  forest: 2,
  farmland: 3,
  desert: 4,
  mountain: 5,
  snow: 6,
  urban: 7,
  road: 8,
  airport: 9,
} as const;

export type TerrainCode = (typeof Terrain)[keyof typeof Terrain];

export const TERRAIN_NAMES: Readonly<Record<number, string>> = {
  [Terrain.water]: 'water',
  [Terrain.grass]: 'grass',
  [Terrain.forest]: 'forest',
  [Terrain.farmland]: 'farmland',
  [Terrain.desert]: 'desert',
  [Terrain.mountain]: 'mountain',
  [Terrain.snow]: 'snow',
  [Terrain.urban]: 'urban',
  [Terrain.road]: 'road',
  [Terrain.airport]: 'airport',
};
