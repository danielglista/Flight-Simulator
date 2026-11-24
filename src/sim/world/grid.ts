import type { ScaleConfig } from '../../config/scales';
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
}

export function createGrid(cols: number, rows: number, cellSize: number): WorldGrid {
  return {
    cols,
    rows,
    cellSize,
    elevation: new Int16Array(cols * rows),
    terrain: new Uint8Array(cols * rows),
    water: new Uint8Array(cols * rows),
  };
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

/** Elevation (real m) of a cell, with indices clamped to the map. */
export function elevationAtCell(grid: WorldGrid, col: number, row: number): number {
  const c = Math.min(grid.cols - 1, Math.max(0, col));
  const r = Math.min(grid.rows - 1, Math.max(0, row));
  return grid.elevation[r * grid.cols + c] ?? 0;
}

/** Terrain code of the cell containing (x, y), world meters. Outside the map: seabed. */
export function surfaceAt(grid: WorldGrid, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Terrain.seabed;
  const col = Math.floor(x / grid.cellSize);
  const row = Math.floor(y / grid.cellSize);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return Terrain.seabed;
  return grid.terrain[row * grid.cols + col] ?? Terrain.seabed;
}

/** Water surface of a cell in REAL meters above sea level, or NaN where it is dry. Indices are clamped. */
export function waterLevelAtCell(grid: WorldGrid, col: number, row: number): number {
  const c = Math.min(grid.cols - 1, Math.max(0, col));
  const r = Math.min(grid.rows - 1, Math.max(0, row));
  const i = r * grid.cols + c;
  const e = grid.elevation[i] ?? 0;
  const d = grid.water[i] ?? 0;
  if (d > 0) return e + d;
  return e < 0 ? 0 : NaN;
}

/**
 * Ground (solid bed) height in WORLD meters at (x, y): bilinear between cell
 * centers, the stored real elevation divided by the altitude scale. Outside the map: 0.
 */
export function groundAt(grid: WorldGrid, scale: ScaleConfig, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  if (x < 0 || y < 0 || x > worldWidth(grid) || y > worldHeight(grid)) return 0;
  const fx = x / grid.cellSize - 0.5;
  const fy = y / grid.cellSize - 0.5;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const tx = fx - c0;
  const ty = fy - r0;
  const south = elevationAtCell(grid, c0, r0) * (1 - tx) + elevationAtCell(grid, c0 + 1, r0) * tx;
  const north =
    elevationAtCell(grid, c0, r0 + 1) * (1 - tx) + elevationAtCell(grid, c0 + 1, r0 + 1) * tx;
  return (south * (1 - ty) + north * ty) / scale.altitude;
}

/**
 * Water surface height in WORLD meters at (x, y), or NaN where it is dry. Water
 * is flat per cell (nearest cell), so a river on a slope does not tilt. Outside
 * the map it is open sea at 0.
 */
export function waterLevelAt(grid: WorldGrid, scale: ScaleConfig, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
  if (x < 0 || y < 0 || x > worldWidth(grid) || y > worldHeight(grid)) return 0;
  const level = waterLevelAtCell(grid, Math.floor(x / grid.cellSize), Math.floor(y / grid.cellSize));
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
