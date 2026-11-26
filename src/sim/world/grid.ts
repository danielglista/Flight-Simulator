import { PATCH_BLEND_M } from '../../config/map';
import type { ScaleConfig } from '../../config/scales';
import { airportContains, blendWeight, fineSurfaceAt, OFF_AIRPORT, onRunway, type Airport, type Runway } from './airport';
import { Terrain } from './terrain';

/** Cells per chunk side. Chunks are a drawing and loading unit only. */
export const CHUNK_CELLS = 256;

/**
 * Index is `row * cols + col`. Column 0 is west and row 0 is SOUTH, so row
 * increases with world y. World (0, 0) is the southwest corner of cell (0, 0).
 */
export interface WorldGrid {
  readonly cols: number;
  readonly rows: number;
  /** World meters per cell side. */
  readonly cellSize: number;
  /** The SOLID ground, REAL meters above sea level; negative is below it (sea floor, lake bed). */
  readonly elevation: Int16Array;
  /** What the ground is made of (even under water). */
  readonly terrain: Uint8Array;
  /**
   * Depth of inland water (lakes, rivers) over the ground, REAL meters; 0 is none.
   * The water surface is then elevation + depth. Open sea is implied instead:
   * any cell whose ground is below sea level is wet, with its surface at 0.
   */
  readonly water: Uint8Array;
  /** Airports laid over the base grid (fine surface, exact runways, flat ground). Usually few. */
  readonly airports: readonly Airport[];
  /** Finer grids laid over parts of this one (airports, city cores). Lookups use a patch where one covers the point. */
  readonly patches?: readonly GridPatch[];
}

/** A finer grid whose southwest corner sits at (x, y) world meters. Its own airports and patches are not used. */
export interface GridPatch {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly grid: WorldGrid;
}

/** The first patch covering (x, y), or null. */
export function patchAt(grid: WorldGrid, x: number, y: number): GridPatch | null {
  if (!grid.patches) return null;
  for (const p of grid.patches) {
    if (x >= p.x && y >= p.y && x < p.x + p.grid.cols * p.grid.cellSize && y < p.y + p.grid.rows * p.grid.cellSize) return p;
  }
  return null;
}

export function createGrid(cols: number, rows: number, cellSize: number): WorldGrid {
  return {
    cols,
    rows,
    cellSize,
    elevation: new Int16Array(cols * rows),
    terrain: new Uint8Array(cols * rows),
    water: new Uint8Array(cols * rows),
    airports: [],
  };
}

/** The airport whose ground contains (x, y), or null: its boundary, or for a masked airport its ground cells. */
export function airportAt(grid: WorldGrid, x: number, y: number): Airport | null {
  for (const a of grid.airports) {
    if (airportContains(a, x, y) && !(a.masked && fineSurfaceAt(a, x, y) === OFF_AIRPORT)) return a;
  }
  return null;
}

/** The airport and runway under (x, y), or null. */
export function runwayAt(
  grid: WorldGrid,
  x: number,
  y: number,
): { readonly airport: Airport; readonly runway: Runway } | null {
  const airport = airportAt(grid, x, y);
  if (!airport) return null;
  for (const runway of airport.runways) if (onRunway(runway, x, y)) return { airport, runway };
  return null;
}

export function cellIndex(grid: WorldGrid, col: number, row: number): number {
  return row * grid.cols + col;
}

export function worldWidth(grid: WorldGrid): number {
  return grid.cols * grid.cellSize;
}

export function worldHeight(grid: WorldGrid): number {
  return grid.rows * grid.cellSize;
}

/** Elevation (real m) of a BASE cell, with indices clamped to the map. Ignores airports. */
export function elevationAtCell(grid: WorldGrid, col: number, row: number): number {
  const c = Math.min(grid.cols - 1, Math.max(0, col));
  const r = Math.min(grid.rows - 1, Math.max(0, row));
  return grid.elevation[r * grid.cols + c] ?? 0;
}

/**
 * Terrain code at (x, y), world meters. Inside an airport: the runway if on
 * one, else its fine grid; otherwise the base cell. Outside the map: seabed.
 */
export function surfaceAt(grid: WorldGrid, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Terrain.seabed;
  const col = Math.floor(x / grid.cellSize);
  const row = Math.floor(y / grid.cellSize);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return Terrain.seabed;
  const airport = airportAt(grid, x, y);
  if (airport) {
    for (const rw of airport.runways) if (onRunway(rw, x, y)) return Terrain.runway;
    return fineSurfaceAt(airport, x, y);
  }
  const patch = patchAt(grid, x, y);
  if (patch) {
    const c = Math.floor((x - patch.x) / patch.grid.cellSize);
    const r = Math.floor((y - patch.y) / patch.grid.cellSize);
    return patch.grid.terrain[r * patch.grid.cols + c] ?? Terrain.seabed;
  }
  return grid.terrain[row * grid.cols + col] ?? Terrain.seabed;
}

/** Water surface of a BASE cell in REAL meters above sea level, or NaN where it is dry. Indices are clamped. Ignores airports. */
export function waterLevelAtCell(grid: WorldGrid, col: number, row: number): number {
  const c = Math.min(grid.cols - 1, Math.max(0, col));
  const r = Math.min(grid.rows - 1, Math.max(0, row));
  const i = r * grid.cols + c;
  const e = grid.elevation[i] ?? 0;
  const d = grid.water[i] ?? 0;
  if (d > 0) return e + d;
  return e < 0 ? 0 : NaN;
}

/** Bilinear elevation between cell centers, REAL meters, at grid-local (x, y). */
function bilinear(grid: WorldGrid, x: number, y: number): number {
  const fx = x / grid.cellSize - 0.5;
  const fy = y / grid.cellSize - 0.5;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const tx = fx - c0;
  const ty = fy - r0;
  const south = elevationAtCell(grid, c0, r0) * (1 - tx) + elevationAtCell(grid, c0 + 1, r0) * tx;
  const north =
    elevationAtCell(grid, c0, r0 + 1) * (1 - tx) + elevationAtCell(grid, c0 + 1, r0 + 1) * tx;
  return south * (1 - ty) + north * ty;
}

/** Map elevation (REAL m), airports ignored: a patch where there is one, blended to the base near its edge. */
function mapElevation(grid: WorldGrid, x: number, y: number): number {
  const patch = patchAt(grid, x, y);
  if (!patch) return bilinear(grid, x, y);
  const lx = x - patch.x;
  const ly = y - patch.y;
  const fine = bilinear(patch.grid, lx, ly);
  const edge = Math.min(lx, ly, patch.grid.cols * patch.grid.cellSize - lx, patch.grid.rows * patch.grid.cellSize - ly);
  if (edge >= PATCH_BLEND_M) return fine;
  const t = edge / PATCH_BLEND_M;
  const coarse = bilinear(grid, x, y);
  return coarse + (fine - coarse) * (t * t * (3 - 2 * t));
}

/**
 * Ground (solid bed) height in WORLD meters at (x, y): bilinear between cell
 * centers, the stored real elevation divided by the altitude scale. Outside the map: 0.
 */
export function groundAt(grid: WorldGrid, scale: ScaleConfig, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  if (x < 0 || y < 0 || x > worldWidth(grid) || y > worldHeight(grid)) return 0;
  const base = mapElevation(grid, x, y) / scale.altitude;
  const airport = airportAt(grid, x, y);
  if (!airport) return base;
  // Flat at the field elevation inside the blend band, the base ground at the boundary.
  const field = airport.fieldElevationM / scale.altitude;
  return base + (field - base) * blendWeight(airport, x, y);
}

/**
 * Water surface height in WORLD meters at (x, y), or NaN where it is dry. Water
 * is flat per cell (nearest cell), so a river on a slope does not tilt. Outside
 * the map it is open sea at 0.
 */
export function waterLevelAt(grid: WorldGrid, scale: ScaleConfig, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
  if (x < 0 || y < 0 || x > worldWidth(grid) || y > worldHeight(grid)) return 0;
  if (airportAt(grid, x, y)) return NaN; // validated dry (a masked airport only where its ground is)
  const patch = patchAt(grid, x, y);
  const layer = patch ? patch.grid : grid;
  const level = waterLevelAtCell(layer, Math.floor((x - (patch?.x ?? 0)) / layer.cellSize), Math.floor((y - (patch?.y ?? 0)) / layer.cellSize));
  return level / scale.altitude;
}

/**
 * Height of whatever is on top, in WORLD meters: the water surface where it is
 * wet (never below the bed), else the ground. This is what flight sees.
 * Outside the map: 0.
 */
export function heightAt(grid: WorldGrid, scale: ScaleConfig, x: number, y: number): number {
  const g = groundAt(grid, scale, x, y);
  const w = waterLevelAt(grid, scale, x, y);
  return Number.isNaN(w) ? g : Math.max(g, w);
}
