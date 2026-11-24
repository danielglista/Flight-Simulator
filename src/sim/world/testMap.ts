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
/** Real meters. Exported so the side view can fill the snow cap down to it. */
export const SNOW_LINE_M = 1400;
/** Cells around a river point that must not be lower than the river. */
const RIVER_BANK_CELLS = 4;
/** Water depths, real meters. */
const RIVER_DEPTH_M = 5;
const LAKE_MAX_DEPTH_M = 30;
const LAKE_EDGE_DEPTH_M = 4;
/** Sea floor deepens this much per cell from the coast, down to a cap. */
const SHELF_START_M = 3;
const SHELF_SLOPE_M = 7;
const SHELF_MAX_M = 300;
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
 * Order: coast, base land, hills and ridge, lake and river, sea floor, terrain by height,
 * level area, farmland, desert, town, road.
 */
export function buildTestMap(): WorldGrid {
  const n = TEST_MAP_CELLS;
  const grid = createGrid(n, n, TEST_MAP_CELL_SIZE);
  const { elevation, terrain, water } = grid;
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
  const isLake = new Uint8Array(n * n);
  for (let r = lake.row - 20; r <= lake.row + 20; r++) {
    for (let c = lake.col - 20; c <= lake.col + 20; c++) {
      const d = distance(c, r, lake.col, lake.row);
      if (inMap(c, r) && d <= TEST_MAP_LANDMARKS.lakeRadius) {
        // Deepest in the middle; the water surface is flat at the lake level.
        const depth = Math.round(
          LAKE_EDGE_DEPTH_M + (LAKE_MAX_DEPTH_M - LAKE_EDGE_DEPTH_M) * (1 - d / TEST_MAP_LANDMARKS.lakeRadius),
        );
        elevation[at(c, r)] = LAKE_LEVEL_M - depth;
        water[at(c, r)] = depth;
        carved[at(c, r)] = 1;
        isLake[at(c, r)] = 1;
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
      // The river must lie below the land around it: take the lowest nearby land
      // (not yet carved) as its level, so it never sits on a ridge above its banks.
      let lowest = Infinity;
      for (let dy = -RIVER_BANK_CELLS; dy <= RIVER_BANK_CELLS; dy++) {
        for (let dx = -RIVER_BANK_CELLS; dx <= RIVER_BANK_CELLS; dx++) {
          const c = cx + dx;
          const r = cy + dy;
          if (!inMap(c, r) || carved[at(c, r)] || !isLand[at(c, r)]) continue;
          if (dx * dx + dy * dy > RIVER_BANK_CELLS * RIVER_BANK_CELLS) continue;
          lowest = Math.min(lowest, elevation[at(c, r)] ?? 0);
        }
      }
      if (lowest !== Infinity) running = Math.min(running, Math.max(1, lowest - 2));
      // 4 cells wide: a disc of radius 2 so it survives zooming out.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const c = cx + dx;
          const r = cy + dy;
          if (!inMap(c, r) || dx * dx + dy * dy > 5) continue;
          if (r < SEA_BORDER_CELLS || c < SEA_BORDER_CELLS) continue;
          // Only land is carved: the lake keeps its own bed and the sea stays sea.
          if (!isLand[at(c, r)] || isLake[at(c, r)]) continue;
          elevation[at(c, r)] = running - RIVER_DEPTH_M;
          water[at(c, r)] = RIVER_DEPTH_M;
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

  // 5. Sea floor: it deepens with distance from the coast (a chamfer distance transform).
  const dist = new Float32Array(n * n);
  for (let i = 0; i < dist.length; i++) dist[i] = isLand[i] || carved[i] ? 0 : 1e9;
  const relax = (c: number, r: number, dc: number, dr: number, w: number): void => {
    if (!inMap(c + dc, r + dr)) return;
    const v = (dist[at(c + dc, r + dr)] as number) + w;
    if (v < (dist[at(c, r)] as number)) dist[at(c, r)] = v;
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      relax(c, r, -1, 0, 1);
      relax(c, r, 0, -1, 1);
      relax(c, r, -1, -1, 1.4142);
      relax(c, r, 1, -1, 1.4142);
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    for (let c = n - 1; c >= 0; c--) {
      relax(c, r, 1, 0, 1);
      relax(c, r, 0, 1, 1);
      relax(c, r, 1, 1, 1.4142);
      relax(c, r, -1, 1, 1.4142);
    }
  }
  for (let i = 0; i < dist.length; i++) {
    if (isLand[i] || carved[i]) continue;
    elevation[i] = -Math.round(Math.min(SHELF_MAX_M, SHELF_START_M + SHELF_SLOPE_M * (dist[i] as number)));
  }

  // 6. Terrain by bed height and noise. The sea keeps the seabed code; lake and
  // river beds are ordinary ground with water over them.
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = at(c, r);
      if (!isLand[i] && !carved[i]) {
        terrain[i] = Terrain.seabed;
        continue;
      }
      const e = elevation[i] ?? 0;
      if (e >= SNOW_LINE_M) terrain[i] = Terrain.snow;
      else if (e >= MOUNTAIN_LINE_M) terrain[i] = Terrain.mountain;
      else if (noise(c, r) > 0.15) terrain[i] = Terrain.forest;
      else terrain[i] = Terrain.grass;
    }
  }

  /** Wet: inland water over the ground, or ground below sea level. */
  const isWet = (i: number): boolean => (water[i] ?? 0) > 0 || (elevation[i] ?? 0) < 0;

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
        const cur = terrain[at(c, r)] ?? Terrain.seabed;
        if (only ? only.includes(cur) && !isWet(at(c, r)) : !isWet(at(c, r))) terrain[at(c, r)] = code;
      }
    }
  };
  const open = [Terrain.grass, Terrain.forest];

  // Flat grass for the runway area (exact rectangle).
  paint(lv.colMin, lv.colMax, lv.rowMin, lv.rowMax, Terrain.grass);

  // 7. Farmland patchwork, desert, town.
  paint(175, 260, 140, 200, Terrain.farmland, open);
  paint(270, 340, 125, 190, Terrain.farmland, open);
  paint(100, 170, 160, 215, Terrain.farmland, open);
  paint(285, 380, 200, 270, Terrain.desert, open);
  const tw = TEST_MAP_LANDMARKS.town;
  for (let r = tw.rowMin; r <= tw.rowMax; r++) {
    for (let c = tw.colMin; c <= tw.colMax; c++) {
      if (isWet(at(c, r))) continue;
      terrain[at(c, r)] = c % 8 === 0 || r % 8 === 0 ? Terrain.road : Terrain.urban;
    }
  }

  // 8. Road, 2 cells wide: east from the town, and a spur down to the level area.
  paint(tw.colMax, 340, 132, 133, Terrain.road);
  paint(255, 256, lv.rowMax + 1, 133, Terrain.road);

  return grid;
}
