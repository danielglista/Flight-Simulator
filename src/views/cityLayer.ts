import { BUILDING_BAKE_MS, BUILDING_CACHE_TILES, BUILDING_DETAIL_MAX_MPP, BUILDING_MAX_MPP, BUILDING_PREBAKE_MIN_MPP, BUILDING_TILE_PX } from '../config/map';
import { BUILDING_SHADOW_COLOR, ROOF_COLORS, ROOF_EDGE_COLOR, type Rgb } from '../config/palette';
import { ROOF_AWAY_LIGHT, type Sun } from '../config/sun';
import type { MapBuilding } from '../sim/world/mapFile';
import type { MapFrame, Visible } from './airportLayer';
import { ZOOM_LEVELS } from './camera';
import { shadowVector, towardSun } from './sunLight';

type P = readonly [number, number];

/** District styles whose roofs are pitched: residential and suburb. */
const GABLED = new Set([1, 2]);

/** The zoom level (world m per pixel) whose tiles to use, or null when too far out for buildings. */
export function buildingLevel(mpp: number): number | null {
  if (mpp > BUILDING_MAX_MPP * 1.3) return null;
  let best: number | null = null;
  for (const level of ZOOM_LEVELS) {
    if (level > BUILDING_MAX_MPP) continue;
    if (best === null || Math.abs(Math.log(level / mpp)) < Math.abs(Math.log(best / mpp))) best = level;
  }
  return best;
}

/** The four corners of a footprint, in order. */
export function roofCorners(b: Pick<MapBuilding, 'x' | 'y' | 'width' | 'depth' | 'angle'>): [P, P, P, P] {
  const a = (b.angle * Math.PI) / 180;
  const at = (i: number, j: number): P => {
    const u = (i * b.width) / 2;
    const v = (j * b.depth) / 2;
    return [b.x + Math.sin(a) * u + Math.cos(a) * v, b.y + Math.cos(a) * u - Math.sin(a) * v];
  };
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/** Convex hull, counterclockwise (monotone chain). */
export function hull(points: readonly P[]): P[] {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: P, a: P, b: P): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: readonly P[]): P[] => {
    const out: P[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2] as P, out[out.length - 1] as P, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The ground a building shades: its footprint swept away from the sun, farther the taller it is. */
export function shadowShape(b: MapBuilding, sun: Sun): P[] {
  const [east, north] = shadowVector(sun, b.height);
  const corners = roofCorners(b);
  return hull([...corners, ...corners.map(([x, y]): P => [x + east, y + north])]);
}

/** The half of a pitched roof that faces away from the sun. The ridge runs along the building's width. */
export function shadedHalf(b: MapBuilding, sun: Sun): P[] {
  const [sw, se, ne, nw] = roofCorners(b);
  const [east, north] = towardSun(sun);
  // The outward direction of the (nw, ne) half.
  const a = (b.angle * Math.PI) / 180;
  const away = Math.cos(a) * east - Math.sin(a) * north <= 0;
  const left = between(sw, nw);
  const right = between(se, ne);
  return away ? [left, right, ne, nw] : [sw, se, right, left];
}

/** A roof color for the building's district style, the same one every time for one building. */
export function roofColor(b: MapBuilding): Rgb {
  const choices = ROOF_COLORS[b.style] ?? (ROOF_COLORS[0] as readonly Rgb[]);
  const h = Math.abs(Math.imul(Math.round(b.x * 10), 73856093) ^ Math.imul(Math.round(b.y * 10), 19349663));
  return choices[h % choices.length] as Rgb;
}

export interface TileRange {
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
}

/** Tiles of side `tileM` under the frame-space rectangle `view`. Tile (i, j) starts at world (i, j) * tileM. */
export function visibleTiles(f: MapFrame, view: Visible, tileM: number): TileRange {
  const x = (px: number): number => (px - f.ox) * f.mpp;
  const y = (py: number): number => f.mapHeight - (py - f.oy) * f.mpp;
  return {
    i0: Math.floor(x(view.left) / tileM),
    i1: Math.floor(x(view.right) / tileM),
    j0: Math.floor(y(view.bottom) / tileM),
    j1: Math.floor(y(view.top) / tileM),
  };
}

/** For each tile of side `tileM`, the buildings whose roof or shadow reaches into it, lowest first. */
export function buildingsByTile(buildings: readonly MapBuilding[], tileM: number, sun: Sun): Map<string, MapBuilding[]> {
  const tiles = new Map<string, MapBuilding[]>();
  for (const b of [...buildings].sort((p, q) => p.height - q.height)) {
    const shape = shadowShape(b, sun);
    const xs = shape.map((p) => p[0]);
    const ys = shape.map((p) => p[1]);
    for (let i = Math.floor(Math.min(...xs) / tileM); i <= Math.floor(Math.max(...xs) / tileM); i++) {
      for (let j = Math.floor(Math.min(...ys) / tileM); j <= Math.floor(Math.max(...ys) / tileM); j++) {
        const key = `${i},${j}`;
        const list = tiles.get(key);
        if (list) list.push(b);
        else tiles.set(key, [b]);
      }
    }
  }
  return tiles;
}

const rgb = (c: Rgb, k = 1): string => `rgb(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))})`;

function trace(ctx: CanvasRenderingContext2D, points: readonly P[]): void {
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

const between = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Shadows first, all as one shape so they do not darken where they overlap, then the roofs. World coordinates. */
function paint(ctx: CanvasRenderingContext2D, buildings: readonly MapBuilding[], mpp: number, sun: Sun): void {
  ctx.fillStyle = BUILDING_SHADOW_COLOR;
  ctx.beginPath();
  for (const b of buildings) trace(ctx, shadowShape(b, sun));
  ctx.fill();

  const detail = mpp <= BUILDING_DETAIL_MAX_MPP;
  for (const b of buildings) {
    const corners = roofCorners(b);
    const color = roofColor(b);
    ctx.fillStyle = rgb(color);
    ctx.beginPath();
    trace(ctx, corners);
    ctx.fill();
    if (!detail) continue;
    if (GABLED.has(b.style)) {
      ctx.fillStyle = rgb(color, 1 - sun.strength * (1 - ROOF_AWAY_LIGHT));
      ctx.beginPath();
      trace(ctx, shadedHalf(b, sun));
      ctx.fill();
    } else {
      // A flat roof: a rim, and a plant room on the larger ones.
      ctx.fillStyle = rgb(color, 1.18);
      ctx.beginPath();
      trace(ctx, roofCorners({ ...b, width: b.width * 0.78, depth: b.depth * 0.78 }));
      ctx.fill();
      if (b.width * b.depth > 600) {
        ctx.fillStyle = rgb(color, 0.7);
        ctx.beginPath();
        trace(ctx, roofCorners({ ...b, width: b.width * 0.3, depth: b.depth * 0.3 }));
        ctx.fill();
      }
    }
    ctx.strokeStyle = ROOF_EDGE_COLOR;
    ctx.lineWidth = mpp;
    ctx.beginPath();
    trace(ctx, corners);
    ctx.stroke();
  }
}

/** Where fine tile `i` (side `fine` world m) lies inside the coarse tiles of side `coarse`: coarse index and offset in m. */
export function withinCoarse(i: number, fine: number, coarse: number): { index: number; offset: number } {
  const index = Math.floor((i * fine) / coarse);
  return { index, offset: i * fine - index * coarse };
}

export interface CityLayer {
  /**
   * Draws the buildings under `view` in the frame the terrain was drawn in (north up; the caller has rotated).
   * True when some tiles are still stand-ins, so another frame would sharpen them.
   */
  draw(ctx: CanvasRenderingContext2D, f: MapFrame, view: Visible, sun: Sun): boolean;
  /** Bakes the zoomed-out tiles, which hold the most buildings each, so they are not built mid-flight. */
  warm(sun: Sun): void;
}

export function createCityLayer(buildings: readonly MapBuilding[]): CityLayer {
  // Which buildings each tile holds, per level. Zoomed-out tiles are kept for good; close ones, oldest use first.
  const members = new Map<number, Map<string, MapBuilding[]>>();
  const kept = new Map<string, HTMLCanvasElement>();
  const recent = new Map<string, HTMLCanvasElement>();
  // The sun everything above was made for. Another one starts over (E8.2 will repaint tiles gradually instead).
  let bakedFor: Sun | null = null;
  function useSun(sun: Sun): void {
    if (sun === bakedFor) return;
    bakedFor = sun;
    members.clear();
    kept.clear();
    recent.clear();
  }

  function membersAt(level: number, sun: Sun): Map<string, MapBuilding[]> {
    let m = members.get(level);
    if (!m) {
      m = buildingsByTile(buildings, level * BUILDING_TILE_PX, sun);
      members.set(level, m);
    }
    return m;
  }

  function bake(level: number, i: number, j: number, list: readonly MapBuilding[], sun: Sun): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = BUILDING_TILE_PX;
    canvas.height = BUILDING_TILE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not supported');
    const side = level * BUILDING_TILE_PX;
    ctx.setTransform(1 / level, 0, 0, -1 / level, (-i * side) / level, ((j + 1) * side) / level);
    paint(ctx, list, level, sun);
    return canvas;
  }

  /** The tile's canvas; null where there are no buildings; undefined where it is not baked and `mayBake` is false. */
  function tile(level: number, i: number, j: number, sun: Sun, mayBake: boolean): HTMLCanvasElement | null | undefined {
    const list = membersAt(level, sun).get(`${i},${j}`);
    if (!list) return null;
    const key = `${level},${i},${j}`;
    const keep = level >= BUILDING_PREBAKE_MIN_MPP;
    const cache = keep ? kept : recent;
    let canvas = cache.get(key);
    if (canvas) {
      if (!keep) cache.delete(key); // move to the fresh end
    } else {
      if (!mayBake) return undefined;
      canvas = bake(level, i, j, list, sun);
      while (!keep && recent.size >= BUILDING_CACHE_TILES) recent.delete(recent.keys().next().value as string);
    }
    cache.set(key, canvas);
    return canvas;
  }

  /** Stands in for a close tile with the same ground cut out of the stored zoomed-out one, stretched. */
  function drawStandIn(ctx: CanvasRenderingContext2D, level: number, i: number, j: number, sun: Sun, x: number, y: number, w: number, h: number): void {
    const fine = level * BUILDING_TILE_PX;
    const coarse = BUILDING_PREBAKE_MIN_MPP * BUILDING_TILE_PX;
    const cx = withinCoarse(i, fine, coarse);
    const cy = withinCoarse(j, fine, coarse);
    const canvas = tile(BUILDING_PREBAKE_MIN_MPP, cx.index, cy.index, sun, true);
    if (!canvas) return;
    const size = fine / BUILDING_PREBAKE_MIN_MPP;
    // Image rows run south, world y north.
    ctx.drawImage(canvas, cx.offset / BUILDING_PREBAKE_MIN_MPP, (coarse - cy.offset - fine) / BUILDING_PREBAKE_MIN_MPP, size, size, x, y, w, h);
  }

  return {
    draw(ctx, f, view, sun) {
      useSun(sun);
      const level = buildingLevel(f.mpp);
      if (level === null || buildings.length === 0) return false;
      const side = level * BUILDING_TILE_PX;
      const r = visibleTiles(f, view, side);
      // Tile edges are rounded from the map origin, so neighbors meet exactly.
      const left = (i: number): number => Math.round(f.ox + (i * side) / f.mpp);
      const top = (j: number): number => Math.round(f.oy + (f.mapHeight - (j + 1) * side) / f.mpp);
      const started = performance.now();
      let pending = false;
      for (let j = r.j0; j <= r.j1; j++) {
        for (let i = r.i0; i <= r.i1; i++) {
          const canvas = tile(level, i, j, sun, performance.now() - started < BUILDING_BAKE_MS);
          if (canvas === null) continue;
          const x = left(i);
          const y = top(j);
          const w = left(i + 1) - x;
          const h = top(j - 1) - y;
          if (canvas) ctx.drawImage(canvas, x, y, w, h);
          else {
            pending = true;
            drawStandIn(ctx, level, i, j, sun, x, y, w, h);
          }
        }
      }
      return pending;
    },
    warm(sun) {
      useSun(sun);
      for (const level of ZOOM_LEVELS) {
        if (level > BUILDING_MAX_MPP) continue;
        // Sorting the buildings into tiles is worth doing now at every level; baking only the kept ones.
        const keys = membersAt(level, sun).keys();
        if (level < BUILDING_PREBAKE_MIN_MPP) continue;
        for (const key of keys) {
          const [i, j] = key.split(',').map(Number) as [number, number];
          tile(level, i, j, sun, true);
        }
      }
    },
  };
}
