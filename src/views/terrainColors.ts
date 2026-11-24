import { SEA_COLOR, TERRAIN_COLORS, waterColor, type Rgb } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import { CHUNK_CELLS, elevationAtCell, waterLevelAtCell, type WorldGrid } from '../sim/world/grid';
import { Terrain } from '../sim/world/terrain';

/**
 * Vertical exaggeration for shading only (the world altitude scale makes real
 * slopes very gentle). Not used for heights, flight or the side view.
 */
export const SHADE_EXAGGERATION = 4;
/** How strongly slope changes brightness, before quantizing. Tune by eye. */
export const SHADE_GAIN = 12;
/** Elevation bands (real meters): each band is a little lighter and warmer. */
export const TINT_BAND_M = 100;
export const TINT_PER_BAND = 0.04;
export const TINT_MAX = 0.4;
const TINT_COLOR: Rgb = [255, 236, 200];
/** Contour line every this many real meters; lines darken the cell by this factor. */
export const CONTOUR_M = 100;
export const CONTOUR_DARKEN = 0.72;
/** Brightness change per shading step. */
export const SHADE_STEP = 0.14;
const MAX_STEP = 2;

// Light from the northwest, above. x is east, y is north.
const LIGHT = normalize(-1, 1, 1.2);
const FLAT_LIGHT = LIGHT[2];

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/** Elevation for shading and contours: the sea floor counts as sea level, so coasts are not cliffs. */
function landElevation(grid: WorldGrid, col: number, row: number): number {
  return Math.max(0, elevationAtCell(grid, col, row));
}

/**
 * Hillshade step in -2..2 for a cell, from the WHOLE grid (not the chunk), so
 * chunk borders have no seams. 0 is flat; positive is lit.
 */
export function shadeStep(grid: WorldGrid, scale: ScaleConfig, col: number, row: number): number {
  const run = (2 * grid.cellSize * scale.altitude) / SHADE_EXAGGERATION;
  const sx =
    (landElevation(grid, col + 1, row) - landElevation(grid, col - 1, row)) / run;
  const sy =
    (landElevation(grid, col, row + 1) - landElevation(grid, col, row - 1)) / run;
  const [nx, ny, nz] = normalize(-sx, -sy, 1);
  const lit = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  const step = Math.round(((lit - FLAT_LIGHT) / FLAT_LIGHT) * SHADE_GAIN);
  return Math.max(-MAX_STEP, Math.min(MAX_STEP, step));
}

function shaded(color: Rgb, step: number): Rgb {
  const k = 1 + SHADE_STEP * step;
  return [color[0] * k, color[1] * k, color[2] * k];
}

/** Lighter, warmer color for higher elevation bands. */
export function tinted(color: Rgb, elevationM: number): Rgb {
  const t = Math.min(TINT_MAX, Math.floor(elevationM / TINT_BAND_M) * TINT_PER_BAND);
  return [
    color[0] + (TINT_COLOR[0] - color[0]) * t,
    color[1] + (TINT_COLOR[1] - color[1]) * t,
    color[2] + (TINT_COLOR[2] - color[2]) * t,
  ];
}

/** True where the contour level changes between this cell and its east or north neighbor. */
export function onContour(grid: WorldGrid, col: number, row: number): boolean {
  const here = Math.floor(landElevation(grid, col, row) / CONTOUR_M);
  return (
    here !== Math.floor(landElevation(grid, col + 1, row) / CONTOUR_M) ||
    here !== Math.floor(landElevation(grid, col, row + 1) / CONTOUR_M)
  );
}

const NO_CONTOUR = new Set<number>([
  Terrain.seabed,
  Terrain.road,
  Terrain.urban,
  Terrain.airport,
  Terrain.runway,
  Terrain.taxiway,
]);

/**
 * RGBA bytes for one chunk, one pixel per cell. Image row 0 is the NORTH row
 * of the chunk, so this is the one place the y flip happens for pixels.
 * Cells beyond the grid are sea.
 */
export function colorChunk(
  grid: WorldGrid,
  scale: ScaleConfig,
  chunkCol: number,
  chunkRow: number,
  size: number = CHUNK_CELLS,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const row = chunkRow * size + (size - 1 - y);
    for (let x = 0; x < size; x++) {
      const col = chunkCol * size + x;
      let color: Rgb = SEA_COLOR;
      if (col < grid.cols && row < grid.rows) {
        const code = grid.terrain[row * grid.cols + col] ?? Terrain.seabed;
        const level = waterLevelAtCell(grid, col, row);
        if (!Number.isNaN(level)) {
          // Wet: colored by depth, so shelves and river beds show. No hillshade or contours.
          color = waterColor(level - elevationAtCell(grid, col, row));
        } else {
          color = tinted(TERRAIN_COLORS[code] ?? SEA_COLOR, elevationAtCell(grid, col, row));
          color = shaded(color, shadeStep(grid, scale, col, row));
          if (!NO_CONTOUR.has(code) && onContour(grid, col, row)) {
            color = [color[0] * CONTOUR_DARKEN, color[1] * CONTOUR_DARKEN, color[2] * CONTOUR_DARKEN];
          }
        }
      }
      const o = (y * size + x) * 4;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Halves an RGBA image by averaging each 2 x 2 block. `size` is the source side. */
export function reduce2x(src: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const half = size / 2;
  const out = new Uint8ClampedArray(half * half * 4);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const a = ((2 * y) * size + 2 * x) * 4;
      const b = a + 4;
      const c = a + size * 4;
      const d = c + 4;
      const o = (y * half + x) * 4;
      for (let k = 0; k < 4; k++) {
        out[o + k] = ((src[a + k] ?? 0) + (src[b + k] ?? 0) + (src[c + k] ?? 0) + (src[d + k] ?? 0)) / 4;
      }
    }
  }
  return out;
}
