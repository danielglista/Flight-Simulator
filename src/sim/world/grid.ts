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
  /** REAL meters above sea level. */
  readonly elevation: Int16Array;
  readonly terrain: Uint8Array;
}

export function createGrid(cols: number, rows: number, cellSize: number): WorldGrid {
  return {
    cols,
    rows,
    cellSize,
    elevation: new Int16Array(cols * rows),
    terrain: new Uint8Array(cols * rows),
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

/** Terrain code of the cell containing (x, y), world meters. Outside the map: water. */
export function surfaceAt(grid: WorldGrid, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Terrain.water;
  const col = Math.floor(x / grid.cellSize);
  const row = Math.floor(y / grid.cellSize);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return Terrain.water;
  return grid.terrain[row * grid.cols + col] ?? Terrain.water;
}

/**
 * Ground height in WORLD meters at (x, y): bilinear between cell centers, with
 * the stored real elevation divided by the altitude scale. Outside the map: 0.
 */
export function heightAt(grid: WorldGrid, scale: ScaleConfig, x: number, y: number): number {
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
