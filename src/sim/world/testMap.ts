import { createGrid, type WorldGrid } from './grid';
import { Terrain } from './terrain';

/** Map size in cells. 512 x 512 at 10 m is 5.12 km square, four 256-cell chunks. */
export const TEST_MAP_CELLS = 512;
export const TEST_MAP_CELL_SIZE = 10;

interface Cell {
  readonly col: number;
  readonly row: number;
}

/** Hand-chosen places, in cell coordinates (row 0 is south). Used by tests and the start camera. */
export const TEST_MAP_LANDMARKS = {
  peak: { col: 375, row: 375 } as Cell,
  riverSource: { col: 350, row: 360 } as Cell,
  lakeCenter: { col: 150, row: 300 } as Cell,
  lakeRadius: 18,
  town: { colMin: 130, colMax: 165, rowMin: 120, rowMax: 145 },
  /** Constant-elevation area for the runway (about 1,500 x 500 world m). */
  level: { colMin: 181, colMax: 331, rowMin: 70, rowMax: 120, elevationM: 30 },
} as const;

const LAND_CENTER = 256;
const LAND_RADIUS_COLS = 225;
const LAND_RADIUS_ROWS = 215;
const SEA_BORDER_CELLS = 4;
const SNOW_LINE_M = 1400;
const MOUNTAIN_LINE_M = 600;

function distance(c: number, r: number, c0: number, r0: number): number {
  return Math.hypot(c - c0, r - r0);
}

/** Distance from a point to a line segment. */
function segmentDistance(
  c: number,
  r: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((c - ax) * dx + (r - ay) * dy) / (dx * dx + dy * dy)));
  return distance(c, r, ax + t * dx, ay + t * dy);
}

/** Smooth bump: 1 at the center, 0 at `radius`. */
function bump(dist: number, radius: number, power = 1.5): number {
  return dist >= radius ? 0 : Math.pow(1 - dist / radius, power);
}

/** Cheap deterministic noise in about [-1, 1]. No random numbers anywhere. */
function noise(c: number, r: number): number {
  return (
    0.5 * Math.sin(c * 0.071 + 1.3) * Math.sin(r * 0.093 + 2.1) +
    0.3 * Math.sin(c * 0.033 + r * 0.047 + 0.7) +
    0.2 * Math.sin(c * 0.19 - r * 0.15)
  );
}

/**
 * Builds the invented island. Same output every time.
 * Order: coast, base land, hills and ridge, lake and river, terrain by height,
 * level area, farmland, desert, town, road.
 */
export function buildTestMap(): WorldGrid {
  const n = TEST_MAP_CELLS;
  const grid = createGrid(n, n, TEST_MAP_CELL_SIZE);
  const { elevation, terrain } = grid;
  const at = (c: number, r: number): number => r * n + c;
  const inMap = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < n && r < n;

  // 1. Coast and base land, rising gently inland.
  const isLand = new Uint8Array(n * n);
  /** Lake and river cells; they stay water whatever the height rules say. */
  const carved = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dx = (c + 0.5 - LAND_CENTER) / LAND_RADIUS_COLS;
      const dy = (r + 0.5 - LAND_CENTER) / LAND_RADIUS_ROWS;
      const theta = Math.atan2(dy, dx);
      const wobble = 1 + 0.06 * Math.sin(3 * theta + 1) + 0.04 * Math.sin(5 * theta + 2);
      const d = Math.hypot(dx, dy) / wobble;
      const border =
        c < SEA_BORDER_CELLS || r < SEA_BORDER_CELLS || c >= n - SEA_BORDER_CELLS || r >= n - SEA_BORDER_CELLS;
      if (d < 1 && !border) {
        isLand[at(c, r)] = 1;
        elevation[at(c, r)] = Math.round(1 + 70 * (1 - d));
      }
    }
  }

  // 2. Hills and a ridge toward the peak (real meters added to the base).
  const hills = [
    { c: 180, r: 200, rad: 30, h: 80 },
    { c: 300, r: 170, rad: 40, h: 100 },
    { c: 90, r: 330, rad: 35, h: 120 },
    { c: 200, r: 380, rad: 45, h: 150 },
    { c: 250, r: 260, rad: 35, h: 90 },
  ];
  const peaks = [
    { c: 375, r: 375, rad: 90, h: 1800 },
    { c: 340, r: 345, rad: 60, h: 1200 },
    { c: 405, r: 330, rad: 55, h: 1000 },
    { c: 350, r: 410, rad: 55, h: 1100 },
  ];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = at(c, r);
      if (!isLand[i]) continue;
      let add = 0;
      for (const h of hills) add = Math.max(add, h.h * bump(distance(c, r, h.c, h.r), h.rad, 2));
      add = Math.max(add, 500 * bump(segmentDistance(c, r, 290, 290, 345, 345), 28, 1));
      for (const p of peaks) add = Math.max(add, p.h * bump(distance(c, r, p.c, p.r), p.rad));
      elevation[i] = (elevation[i] ?? 0) + Math.round(add);
    }
  }

  // 3. Lake, then river carved after it so water sits below its banks.
  const lake = TEST_MAP_LANDMARKS.lakeCenter;
  const LAKE_LEVEL_M = 25;
  for (let r = lake.row - 20; r <= lake.row + 20; r++) {
    for (let c = lake.col - 20; c <= lake.col + 20; c++) {
      if (inMap(c, r) && distance(c, r, lake.col, lake.row) <= TEST_MAP_LANDMARKS.lakeRadius) {
        elevation[at(c, r)] = LAKE_LEVEL_M;
        terrain[at(c, r)] = Terrain.water;
        carved[at(c, r)] = 1;
        isLand[at(c, r)] = 0;
      }
    }
  }
  const riverPath: Array<[number, number]> = [
    [350, 360],
    [320, 330],
    [270, 310],
    [210, 300],
    [150, 300],
    [110, 290],
    [5, 285],
  ];
  let running = Infinity;
  for (let s = 0; s < riverPath.length - 1; s++) {
    const [ax, ay] = riverPath[s] as [number, number];
    const [bx, by] = riverPath[s + 1] as [number, number];
    const steps = Math.ceil(distance(ax, ay, bx, by));
    for (let k = 0; k <= steps; k++) {
      const cx = Math.round(ax + ((bx - ax) * k) / steps);
      const cy = Math.round(ay + ((by - ay) * k) / steps);
      running = Math.min(running, Math.max(1, (elevation[at(cx, cy)] ?? 0) - 2));
      // 4 cells wide: a disc of radius 2 so it survives zooming out.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const c = cx + dx;
          const r = cy + dy;
          if (!inMap(c, r) || dx * dx + dy * dy > 5) continue;
          if (r < SEA_BORDER_CELLS || c < SEA_BORDER_CELLS) continue;
          // Open sea (elevation 0, not land) stays at 0; land and lake cells take the river level.
          if (isLand[at(c, r)] || (elevation[at(c, r)] ?? 0) > 0) elevation[at(c, r)] = running;
          terrain[at(c, r)] = Terrain.water;
          carved[at(c, r)] = 1;
        }
      }
    }
  }

  // 4. Level area for the runway, blended into the land around it.
  const lv = TEST_MAP_LANDMARKS.level;
  const BLEND = 12;
  for (let r = lv.rowMin - BLEND; r <= lv.rowMax + BLEND; r++) {
    for (let c = lv.colMin - BLEND; c <= lv.colMax + BLEND; c++) {
      if (!inMap(c, r) || !isLand[at(c, r)]) continue;
      const out = Math.max(lv.colMin - c, c - lv.colMax, lv.rowMin - r, r - lv.rowMax, 0);
      const t = 1 - Math.min(1, out / BLEND);
      const e = elevation[at(c, r)] ?? 0;
      elevation[at(c, r)] = Math.round(e + (lv.elevationM - e) * t);
    }
  }

  // 5. Terrain by height and noise (river and lake cells stay water).
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = at(c, r);
      if (!isLand[i]) {
        terrain[i] = Terrain.water;
        continue;
      }
      if (carved[i]) {
        terrain[i] = Terrain.water;
        continue;
      }
      const e = elevation[i] ?? 0;
      if (e >= SNOW_LINE_M) terrain[i] = Terrain.snow;
      else if (e >= MOUNTAIN_LINE_M) terrain[i] = Terrain.mountain;
      else if (noise(c, r) > 0.15) terrain[i] = Terrain.forest;
      else terrain[i] = Terrain.grass;
    }
  }

  const paint = (
    colMin: number,
    colMax: number,
    rowMin: number,
    rowMax: number,
    code: number,
    only?: readonly number[],
  ): void => {
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        if (!inMap(c, r)) continue;
        const cur = terrain[at(c, r)] ?? Terrain.water;
        if (only ? only.includes(cur) : cur !== Terrain.water) terrain[at(c, r)] = code;
      }
    }
  };
  const open = [Terrain.grass, Terrain.forest];

  // Flat grass for the runway area (exact rectangle).
  paint(lv.colMin, lv.colMax, lv.rowMin, lv.rowMax, Terrain.grass);

  // 6. Farmland patchwork, desert, town.
  paint(175, 260, 140, 200, Terrain.farmland, open);
  paint(270, 340, 125, 190, Terrain.farmland, open);
  paint(100, 170, 160, 215, Terrain.farmland, open);
  paint(285, 380, 200, 270, Terrain.desert, open);
  const tw = TEST_MAP_LANDMARKS.town;
  for (let r = tw.rowMin; r <= tw.rowMax; r++) {
    for (let c = tw.colMin; c <= tw.colMax; c++) {
      if (terrain[at(c, r)] === Terrain.water) continue;
      terrain[at(c, r)] = c % 8 === 0 || r % 8 === 0 ? Terrain.road : Terrain.urban;
    }
  }

  // 7. Road, 2 cells wide: east from the town, and a spur down to the level area.
  paint(tw.colMax, 340, 132, 133, Terrain.road);
  paint(255, 256, lv.rowMax + 1, 133, Terrain.road);

  return grid;
}
