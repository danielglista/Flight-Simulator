/**
 * Terrain codes. They will be written to files, so the numbers must not change.
 * A const object rather than an enum, so the values stay plain numbers.
 */
export const Terrain = {
  /** What the ground is made of under open water (and the default). Water itself is not a terrain code. */
  seabed: 0,
  grass: 1,
  forest: 2,
  farmland: 3,
  desert: 4,
  mountain: 5,
  snow: 6,
  urban: 7,
  road: 8,
  /** Apron: the paved parking area of an airport. */
  airport: 9,
  runway: 10,
  taxiway: 11,
} as const;

export type TerrainCode = (typeof Terrain)[keyof typeof Terrain];

export const TERRAIN_NAMES: Readonly<Record<number, string>> = {
  [Terrain.seabed]: 'seabed',
  [Terrain.grass]: 'grass',
  [Terrain.forest]: 'forest',
  [Terrain.farmland]: 'farmland',
  [Terrain.desert]: 'desert',
  [Terrain.mountain]: 'mountain',
  [Terrain.snow]: 'snow',
  [Terrain.urban]: 'urban',
  [Terrain.road]: 'road',
  [Terrain.airport]: 'apron',
  [Terrain.runway]: 'runway',
  [Terrain.taxiway]: 'taxiway',
};
