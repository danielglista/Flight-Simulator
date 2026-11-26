import { Terrain } from '../../src/sim/world/terrain';
import type { Placement } from './place';
import { Raster, type Rgb } from './raster';
import type { Skeleton } from './skeleton';

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const GROUND: Record<number, Rgb> = {
  [Terrain.seabed]: [120, 150, 100],
  [Terrain.grass]: [140, 175, 100],
  [Terrain.forest]: [70, 125, 70],
  [Terrain.farmland]: [200, 190, 120],
  [Terrain.mountain]: [140, 120, 100],
  [Terrain.snow]: [245, 245, 250],
};

/** Color of one cell: water by depth, land by ground type, shaded by slope (light from the northwest, like the game's shadows). */
function cellColor(sk: Skeleton, c: number, r: number, altitudeScale: number): Rgb {
  const { cols, rows, elevation, terrain, water, cellSize } = sk.grid;
  const i = r * cols + c;
  const e = elevation[i] as number;
  const h = (cc: number, rr: number): number => (elevation[Math.max(0, Math.min(rows - 1, rr)) * cols + Math.max(0, Math.min(cols - 1, cc))] as number) / altitudeScale;
  if (!sk.land[i]) return mix([150, 200, 235], [30, 80, 150], Math.min(1, -e / 60));
  if ((water[i] as number) > 0) return [90, 150, 215];
  const base = GROUND[terrain[i] as number] ?? [140, 175, 100];
  const dx = (h(c + 1, r) - h(c - 1, r)) / (2 * cellSize);
  const dy = (h(c, r + 1) - h(c, r - 1)) / (2 * cellSize); // row + 1 is north
  const lit = Math.max(0.55, Math.min(1.45, 1 + (dx * 2.2 - dy * 2.2) * 0.6));
  return [Math.min(255, base[0] * lit), Math.min(255, base[1] * lit), Math.min(255, base[2] * lit)];
}

/** Draw the footprints and overlays; `px` and `py` turn world km into image pixels. */
function overlays(img: Raster, sk: Skeleton, placement: Placement, px: (x: number) => number, py: (y: number) => number, pxPerKm: number): void {
  for (const c of placement.cities) img.box(px(c.core.cx), py(c.core.cy), c.core.w * pxPerKm, c.core.h * pxPerKm, [215, 40, 40], 2);
  for (const a of placement.airports) {
    img.box(px(a.boundary.cx), py(a.boundary.cy), a.boundary.w * pxPerKm, a.boundary.h * pxPerKm, [0, 0, 0], 1);
    img.polyline(a.corridor.map((p) => [px(p.x), py(p.y)] as const), [150, 60, 190], true);
  }
  void sk;
}

/** Whole map, one pixel per cell, north up. Footprints are tinted gray. */
export function renderTerrain(sk: Skeleton, placement: Placement, altitudeScale: number): Raster {
  const { cols, rows } = sk.grid;
  const img = new Raster(cols, rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) img.pixel(c, rows - 1 - r, cellColor(sk, c, r, altitudeScale));
  for (const f of sk.flattened) {
    for (const i of f.cells) {
      const c = i % cols;
      img.pixel(c, rows - 1 - (i - c) / cols, [190, 190, 195]);
    }
  }
  const pxPerKm = 1 / sk.cellKm;
  overlays(img, sk, placement, (x) => (x - sk.originKm.x) * pxPerKm, (y) => rows - (y - sk.originKm.y) * pxPerKm, pxPerKm);
  return img;
}

/** Like renderCrop, but each pixel comes from the first skeleton that covers it: pass the patches, then the base. */
export function renderLayered(layers: readonly Skeleton[], placement: Placement, altitudeScale: number, centerKm: { x: number; y: number }, halfKm: number, pxPerKm: number): Raster {
  const size = Math.round(halfKm * 2 * pxPerKm);
  const img = new Raster(size, size);
  const footprints = layers.map((sk) => {
    const s = new Set<number>();
    for (const f of sk.flattened) for (const i of f.cells) s.add(i);
    return s;
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = centerKm.x - halfKm + (x + 0.5) / pxPerKm;
      const wy = centerKm.y + halfKm - (y + 0.5) / pxPerKm;
      for (let k = 0; k < layers.length; k++) {
        const sk = layers[k] as Skeleton;
        const c = Math.floor((wx - sk.originKm.x) / sk.cellKm);
        const r = Math.floor((wy - sk.originKm.y) / sk.cellKm);
        if (c < 0 || r < 0 || c >= sk.grid.cols || r >= sk.grid.rows) continue;
        img.pixel(x, y, footprints[k]?.has(r * sk.grid.cols + c) ? [190, 190, 195] : cellColor(sk, c, r, altitudeScale));
        break;
      }
    }
  }
  const base = layers[layers.length - 1] as Skeleton;
  overlays(img, base, placement, (xk) => (xk - (centerKm.x - halfKm)) * pxPerKm, (yk) => (centerKm.y + halfKm - yk) * pxPerKm, pxPerKm);
  return img;
}

/** A window of the map centered on a world point, at a fixed pixels-per-km so crops from different cell sizes compare directly. */
export function renderCrop(sk: Skeleton, placement: Placement, altitudeScale: number, centerKm: { x: number; y: number }, halfKm: number, pxPerKm: number): Raster {
  const size = Math.round(halfKm * 2 * pxPerKm);
  const img = new Raster(size, size);
  const { cols, rows } = sk.grid;
  const footprint = new Set<number>();
  for (const f of sk.flattened) for (const i of f.cells) footprint.add(i);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = centerKm.x - halfKm + (x + 0.5) / pxPerKm;
      const wy = centerKm.y + halfKm - (y + 0.5) / pxPerKm;
      const c = Math.floor((wx - sk.originKm.x) / sk.cellKm);
      const r = Math.floor((wy - sk.originKm.y) / sk.cellKm);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      img.pixel(x, y, footprint.has(r * cols + c) ? [190, 190, 195] : cellColor(sk, c, r, altitudeScale));
    }
  }
  overlays(img, sk, placement, (xk) => (xk - (centerKm.x - halfKm)) * pxPerKm, (yk) => (centerKm.y + halfKm - yk) * pxPerKm, pxPerKm);
  return img;
}
