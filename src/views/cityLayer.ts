import { BUILDING_BAKE_BATCH, BUILDING_BAKE_MS, BUILDING_CACHE_TILES, BUILDING_DETAIL_MAX_MPP, BUILDING_MAX_MPP, BUILDING_PREBAKE_MIN_MPP, BUILDING_TILE_PX } from '../config/map';
import { BUILDING_SHADOW_ALPHA, ROOF_COLORS, ROOF_EDGE_COLOR, type Rgb } from '../config/palette';
import { ROOF_AWAY_LIGHT, SHADOW_MAX_PER_M, type Sun } from '../config/sun';
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

/**
 * The box of ground a building can ever cover: its roof, and the longest shadow in any direction the moving sun casts
 * one (west through north to east; the sun is never in the north).
 */
export function reachBox(b: MapBuilding): { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number } {
  const corners = roofCorners(b);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const reach = b.height * SHADOW_MAX_PER_M;
  return { minX: Math.min(...xs) - reach, maxX: Math.max(...xs) + reach, minY: Math.min(...ys), maxY: Math.max(...ys) + reach };
}

/** For each tile of side `tileM`, the buildings whose roof or shadow can reach into it, lowest first. */
export function buildingsByTile(buildings: readonly MapBuilding[], tileM: number): Map<string, MapBuilding[]> {
  const tiles = new Map<string, MapBuilding[]>();
  for (const b of [...buildings].sort((p, q) => p.height - q.height)) {
    const box = reachBox(b);
    for (let i = Math.floor(box.minX / tileM); i <= Math.floor(box.maxX / tileM); i++) {
      for (let j = Math.floor(box.minY / tileM); j <= Math.floor(box.maxY / tileM); j++) {
        const key = `${i},${j}`;
        const list = tiles.get(key);
        if (list) list.push(b);
        else tiles.set(key, [b]);
      }
    }
  }
  return tiles;
}

/**
 * Which of the tiles on screen to paint next: first one with nothing painted, then one painted for another sun.
 * `painted` is the sun a tile was painted for, or null. Null when all are up to date.
 */
export function nextToPaint<T extends { readonly painted: Sun | null }>(tiles: readonly T[], sun: Sun): T | null {
  return tiles.find((t) => t.painted === null) ?? tiles.find((t) => t.painted !== sun) ?? null;
}

/** Runs a job's steps until it ends or `ms` have passed, always at least one. True when it ended. */
export function runWithin(job: Iterator<unknown>, ms: number, now: () => number): boolean {
  const started = now();
  do {
    if (job.next().done) return true;
  } while (now() - started < ms);
  return false;
}

const rgb = (c: Rgb, k = 1): string => `rgb(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))})`;

function trace(ctx: CanvasRenderingContext2D, points: readonly P[]): void {
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

const between = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function paintRoof(ctx: CanvasRenderingContext2D, b: MapBuilding, mpp: number, sun: Sun): void {
  const corners = roofCorners(b);
  const color = roofColor(b);
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  trace(ctx, corners);
  ctx.fill();
  if (mpp > BUILDING_DETAIL_MAX_MPP) return;
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

function tileCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = BUILDING_TILE_PX;
  canvas.height = BUILDING_TILE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');
  return { canvas, ctx };
}

/**
 * Paints one tile into `ctx`, pausing after each batch of buildings. Shadows first, then the roofs. The shadows are
 * drawn solid on their own canvas and laid down once, so they do not darken where they overlap; one path holding them
 * all takes many times longer to fill on a dense tile.
 */
function* paintTile(ctx: CanvasRenderingContext2D, buildings: readonly MapBuilding[], level: number, i: number, j: number, sun: Sun): Generator<undefined, void> {
  const side = level * BUILDING_TILE_PX;
  const toWorld = (c: CanvasRenderingContext2D): void => c.setTransform(1 / level, 0, 0, -1 / level, (-i * side) / level, ((j + 1) * side) / level);
  const batches = Array.from({ length: Math.ceil(buildings.length / BUILDING_BAKE_BATCH) }, (_, n) => buildings.slice(n * BUILDING_BAKE_BATCH, (n + 1) * BUILDING_BAKE_BATCH));
  if (sun.strength > 0) {
    const shadows = tileCanvas();
    toWorld(shadows.ctx);
    shadows.ctx.fillStyle = '#000';
    for (const batch of batches) {
      shadows.ctx.beginPath();
      for (const b of batch) trace(shadows.ctx, shadowShape(b, sun));
      shadows.ctx.fill();
      yield;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = BUILDING_SHADOW_ALPHA * sun.strength;
    ctx.drawImage(shadows.canvas, 0, 0);
    ctx.globalAlpha = 1;
  }
  toWorld(ctx);
  for (const batch of batches) {
    for (const b of batch) paintRoof(ctx, b, level, sun);
    yield;
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
   * True when some tiles are still stand-ins or painted for another sun, so another frame would finish them.
   */
  draw(ctx: CanvasRenderingContext2D, f: MapFrame, view: Visible, sun: Sun): boolean;
  /** Bakes the zoomed-out tiles, which hold the most buildings each, so they are not built mid-flight. */
  warm(sun: Sun): void;
}

/** A painted tile and the sun it was painted for. */
interface Tile {
  readonly canvas: HTMLCanvasElement;
  readonly sun: Sun;
}

interface Job {
  readonly key: string;
  readonly level: number;
  readonly tile: Tile;
  readonly steps: Generator<undefined, void>;
}

export function createCityLayer(buildings: readonly MapBuilding[]): CityLayer {
  // Which buildings each tile holds, per level. Zoomed-out tiles are kept for good; close ones, oldest use first.
  const members = new Map<number, Map<string, MapBuilding[]>>();
  const kept = new Map<string, Tile>();
  const recent = new Map<string, Tile>();
  /** The tile being painted, over as many frames as it takes. */
  let job: Job | null = null;

  function membersAt(level: number): Map<string, MapBuilding[]> {
    let m = members.get(level);
    if (!m) {
      m = buildingsByTile(buildings, level * BUILDING_TILE_PX);
      members.set(level, m);
    }
    return m;
  }

  const cacheFor = (level: number): Map<string, Tile> => (level >= BUILDING_PREBAKE_MIN_MPP ? kept : recent);

  function start(level: number, i: number, j: number, list: readonly MapBuilding[], sun: Sun): Job {
    const { canvas, ctx } = tileCanvas();
    return { key: `${level},${i},${j}`, level, tile: { canvas, sun }, steps: paintTile(ctx, list, level, i, j, sun) };
  }

  /** Puts a finished tile in its cache, making room among the close ones. */
  function store(done: Job): void {
    const cache = cacheFor(done.level);
    cache.delete(done.key);
    while (cache === recent && recent.size >= BUILDING_CACHE_TILES) recent.delete(recent.keys().next().value as string);
    cache.set(done.key, done.tile);
  }

  /** Paints a whole tile at once. */
  function bake(level: number, i: number, j: number, list: readonly MapBuilding[], sun: Sun): Tile {
    const whole = start(level, i, j, list, sun);
    while (!whole.steps.next().done);
    store(whole);
    return whole.tile;
  }

  /** Stands in for a close tile with the same ground cut out of the stored zoomed-out one, stretched. */
  function drawStandIn(ctx: CanvasRenderingContext2D, level: number, i: number, j: number, sun: Sun, x: number, y: number, w: number, h: number): void {
    const fine = level * BUILDING_TILE_PX;
    const coarse = BUILDING_PREBAKE_MIN_MPP * BUILDING_TILE_PX;
    const cx = withinCoarse(i, fine, coarse);
    const cy = withinCoarse(j, fine, coarse);
    const list = membersAt(BUILDING_PREBAKE_MIN_MPP).get(`${cx.index},${cy.index}`);
    if (!list) return;
    const stored = kept.get(`${BUILDING_PREBAKE_MIN_MPP},${cx.index},${cy.index}`) ?? bake(BUILDING_PREBAKE_MIN_MPP, cx.index, cy.index, list, sun);
    const size = fine / BUILDING_PREBAKE_MIN_MPP;
    // Image rows run south, world y north.
    ctx.drawImage(stored.canvas, cx.offset / BUILDING_PREBAKE_MIN_MPP, (coarse - cy.offset - fine) / BUILDING_PREBAKE_MIN_MPP, size, size, x, y, w, h);
  }

  return {
    draw(ctx, f, view, sun) {
      const level = buildingLevel(f.mpp);
      if (level === null || buildings.length === 0) return false;
      const side = level * BUILDING_TILE_PX;
      const r = visibleTiles(f, view, side);
      const cache = cacheFor(level);
      const shown: { readonly key: string; readonly i: number; readonly j: number; readonly list: MapBuilding[] }[] = [];
      for (let j = r.j0; j <= r.j1; j++) {
        for (let i = r.i0; i <= r.i1; i++) {
          const list = membersAt(level).get(`${i},${j}`);
          if (list) shown.push({ key: `${level},${i},${j}`, i, j, list });
        }
      }
      // Seen again, so move to the fresh end.
      for (const t of shown) {
        const tile = recent.get(t.key);
        if (tile) {
          recent.delete(t.key);
          recent.set(t.key, tile);
        }
      }

      // A tile no longer on screen is not worth finishing.
      if (job && !shown.some((t) => t.key === job?.key)) job = null;
      const started = performance.now();
      do {
        if (!job) {
          const next = nextToPaint(shown.map((t) => ({ ...t, painted: cache.get(t.key)?.sun ?? null })), sun);
          if (!next) break;
          job = start(level, next.i, next.j, next.list, sun);
        }
        if (!runWithin(job.steps, BUILDING_BAKE_MS - (performance.now() - started), () => performance.now())) break;
        store(job);
        job = null;
      } while (performance.now() - started < BUILDING_BAKE_MS);

      // Tile edges are rounded from the map origin, so neighbors meet exactly.
      const left = (i: number): number => Math.round(f.ox + (i * side) / f.mpp);
      const top = (j: number): number => Math.round(f.oy + (f.mapHeight - (j + 1) * side) / f.mpp);
      let pending = false;
      for (const t of shown) {
        const x = left(t.i);
        const y = top(t.j);
        const w = left(t.i + 1) - x;
        const h = top(t.j - 1) - y;
        const tile = cache.get(t.key);
        if (tile?.sun !== sun) pending = true;
        if (tile) ctx.drawImage(tile.canvas, x, y, w, h);
        else drawStandIn(ctx, level, t.i, t.j, sun, x, y, w, h);
      }
      return pending;
    },
    warm(sun) {
      for (const level of ZOOM_LEVELS) {
        if (level > BUILDING_MAX_MPP) continue;
        // Sorting the buildings into tiles is worth doing now at every level; baking only the kept ones.
        const tiles = membersAt(level);
        if (level < BUILDING_PREBAKE_MIN_MPP) continue;
        for (const [key, list] of tiles) {
          const [i, j] = key.split(',').map(Number) as [number, number];
          bake(level, i, j, list, sun);
        }
      }
    },
  };
}
