import { createGrid, type WorldGrid } from '../../src/sim/world/grid';
import { Terrain } from '../../src/sim/world/terrain';
import { fillRings, strokePolyline, type CellPoint } from './fill';
import { applyReliefRules } from './mountains';
import type { Placement } from './place';
import { project, unproject, type PointKm } from './project';
import type { MapField } from './stamp';
import type { AuthoredRiver, MapBox, WaterFile } from './types';

export type LonLat = readonly [number, number];

/** Rings in lon/lat; the first is the outline and the rest are holes. */
export interface PolygonGeo {
  readonly rings: readonly (readonly LonLat[])[];
}

export interface RiverGeo {
  readonly name: string | null;
  readonly major: boolean;
  readonly line: readonly LonLat[];
}

export interface TerrainConfig {
  /** Sea cells are at least this deep, real m (negative). */
  readonly seaFloorMaxM: number;
  /** Land cells are at least this high, real m. */
  readonly landMinM: number;
  readonly lakeDepthM: number;
  readonly riverDepthM: number;
  /** World meters per cell. */
  readonly cellM: number;
  /** River widths in world meters: named rivers and minor ones. */
  readonly riverWidthMajorM: number;
  readonly riverWidthMinorM: number;
  /** Mountain rules (E_PLAN 5.2), radii in world meters. */
  readonly relief: { readonly compress: number; readonly baseRadiusM: number; readonly widenRadiusM: number };
  /** Everywhere on land: small seeded bumps (real m, with real km between bumps) that hide the data's stair steps. */
  readonly detailM: number;
  readonly detailFeatureKm: number;
  /** Ground patch sizes in world meters. */
  readonly patchBigM: number;
  readonly patchSmallM: number;
  /** Ground type thresholds, real m. */
  readonly snowM: number;
  readonly mountainM: number;
  readonly forestM: number;
  readonly farmlandMaxM: number;
  /** Airports: the ground blends back to the land over this distance, world km. */
  readonly airportBlendKm: number;
  /** Airports: margin added around each footprint rectangle, world km. */
  readonly airportShoulderKm: number;
  /** Fixed noise seed. */
  readonly seed: number;
  /** Vector edges closer than this to the map get subdivided before warping, real km. */
  readonly densifyKm: number;
}

export const DEFAULT_TERRAIN: TerrainConfig = {
  seaFloorMaxM: -3,
  landMinM: 2,
  lakeDepthM: 3,
  riverDepthM: 2,
  cellM: 10,
  riverWidthMajorM: 60,
  riverWidthMinorM: 30,
  relief: { compress: 1, baseRadiusM: 2000, widenRadiusM: 60 },
  detailM: 6,
  detailFeatureKm: 1.2,
  patchBigM: 2200,
  patchSmallM: 600,
  snowM: 1800,
  mountainM: 600,
  forestM: 250,
  farmlandMaxM: 200,
  airportBlendKm: 0.3,
  airportShoulderKm: 0.02,
  seed: 20260101,
  densifyKm: 0.5,
};

export interface SkeletonInput {
  readonly placement: Placement;
  readonly box: MapBox;
  readonly land: readonly PolygonGeo[];
  readonly lakes: readonly PolygonGeo[];
  readonly rivers: readonly RiverGeo[];
  /** Real meters at a lat/lon, negative at sea. */
  readonly elevationAt: (lat: number, lon: number) => number;
  /** Hand-drawn water that replaces Natural Earth inside its regions (data/map/water.json). */
  readonly water?: WaterFile;
}

export interface Skeleton {
  readonly grid: WorldGrid;
  /** Cell side in world km. */
  readonly cellKm: number;
  /** 1 where the vector coast says land (lakes count as land). */
  readonly land: Uint8Array;
  /** World km of the map's southwest corner (same frame as the placement). */
  readonly originKm: { readonly x: number; readonly y: number };
  /** Cell ranges that were flattened for airports. */
  readonly flattened: readonly { readonly id: string; readonly c0: number; readonly c1: number; readonly r0: number; readonly r1: number; readonly elevationM: number; /** Cell indices of the leveled footprint. */ readonly cells: readonly number[] }[];
}

// ---------- helpers ----------

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1, feature size `period` cells. */
export function valueNoise(col: number, row: number, period: number, seed: number): number {
  const fx = col / period;
  const fy = row / period;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
}

// ---------- build ----------

/** A rectangle of the map to build, world km (same frame as the placement). Defaults to the whole map box. */
export interface BuildWindow {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export function buildSkeleton(input: SkeletonInput, cfg: TerrainConfig = DEFAULT_TERRAIN, win?: BuildWindow): Skeleton {
  const { placement, box } = input;
  const cellKm = cfg.cellM / 1000;
  const cellsOf = (m: number): number => Math.max(1, Math.round(m / cfg.cellM));
  const { field } = placement;
  const wb = placement.box;
  const left = win ? win.left : wb.cx - wb.w / 2;
  const bottom = win ? win.bottom : wb.cy - wb.h / 2;
  const cols = Math.max(1, Math.round((win ? win.width : wb.w) / cellKm));
  const rows = Math.max(1, Math.round((win ? win.height : wb.h) / cellKm));
  // Cell numbering that does not depend on the window, so seeded noise agrees between windows at one cell size.
  const col0 = Math.round((left * 1000) / cfg.cellM);
  const row0 = Math.round((bottom * 1000) / cfg.cellM);
  const grid = createGrid(cols, rows, cfg.cellM);

  // Real-km window that vector edges are subdivided inside (box plus one degree).
  const sw = project(box.south - 1, box.west - 1);
  const ne = project(box.north + 1, box.east + 1);

  /** Project a line or ring, subdividing edges that touch the window so the warp bends them. */
  const toCells = (pts: readonly LonLat[]): CellPoint[] => {
    const real = pts.map((q) => project(q[1], q[0]));
    const out: CellPoint[] = [];
    const push = (x: number, y: number): void => {
      const w = field.toWorld(x, y);
      out.push([(w.x - left) / cellKm, (w.y - bottom) / cellKm]);
    };
    for (let i = 0; i < real.length; i++) {
      const a = real[i]!;
      push(a.x, a.y);
      const b = real[i + 1];
      if (!b) break;
      const touches = Math.max(a.x, b.x) >= sw.x && Math.min(a.x, b.x) <= ne.x && Math.max(a.y, b.y) >= sw.y && Math.min(a.y, b.y) <= ne.y;
      if (!touches) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.ceil(len / cfg.densifyKm);
      for (let s = 1; s < n; s++) push(a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n);
    }
    return out;
  };

  // 0. Real position of every cell center.
  const rx = new Float64Array(cols * rows);
  const ry = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const wy = bottom + (r + 0.5) * cellKm;
    for (let c = 0; c < cols; c++) {
      const p = field.toReal(left + (c + 0.5) * cellKm, wy);
      rx[r * cols + c] = p.x;
      ry[r * cols + c] = p.y;
    }
  }

  // 1. Land mask from the vector coast. Inside authored regions it is all land, then tidal authored water is cut out as sea.
  const land = new Uint8Array(cols * rows);
  for (const poly of input.land) fillRings(poly.rings.map(toCells), cols, rows, (i) => (land[i] = 1));
  const authored = new Uint8Array(cols * rows);
  for (const region of input.water?.regions ?? []) {
    const ring = region.ring.map((q) => project(q[1], q[0]));
    for (let i = 0; i < authored.length; i++) {
      if (pointInRing(rx[i] as number, ry[i] as number, ring)) {
        authored[i] = 1;
        land[i] = 1;
      }
    }
  }
  const frame: GridFrame = { left, bottom, cellKm, cols, rows };
  const minHalfCells = (input.water?.minWidthM ?? cfg.riverWidthMajorM) / cfg.cellM / 2;
  for (const river of input.water?.rivers ?? []) {
    if (river.tidal) strokeAuthored(river, field, cfg.densifyKm, minHalfCells, frame, (i) => (land[i] = 0));
  }

  // 2. Real elevation at every cell, plus seeded detail: small bumps everywhere on land, and hills over cities.
  const real = new Float32Array(cols * rows);
  const shape = placement.warp.profile.shape;
  const fbm = (x: number, y: number, featureKm: number, seed: number): number =>
    (valueNoise(x, y, featureKm, seed) * 0.6 + valueNoise(x, y, featureKm / 2.5, seed + 1) * 0.3 + valueNoise(x, y, featureKm / 6, seed + 2) * 0.1 - 0.5) * 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const p = { x: rx[i] as number, y: ry[i] as number };
      const ll = unproject(p.x, p.y);
      let e = input.elevationAt(ll.lat, ll.lon);
      if (land[i]) {
        e += cfg.detailM * fbm(p.x, p.y, cfg.detailFeatureKm, cfg.seed + 10);
        for (const pc of placement.cities) {
          const h = pc.city.hills;
          if (!h) continue;
          const d = Math.hypot(p.x - pc.real.x, p.y - pc.real.y);
          if (d >= shape.ringKm) continue;
          const t = Math.max(0, Math.min(1, (d - shape.rampKm) / (shape.ringKm - shape.rampKm)));
          e += h.amplitudeM * (1 - t * t * (3 - 2 * t)) * fbm(p.x, p.y, h.featureKm, cfg.seed + 20);
        }
      }
      real[i] = e;
    }
  }

  // 3. Mountain rules, then make the coast agree with the vector coast.
  applyReliefRules(real, cols, rows, { compress: cfg.relief.compress, baseRadiusCells: cellsOf(cfg.relief.baseRadiusM), widenRadiusCells: Math.round(cfg.relief.widenRadiusM / cfg.cellM) });
  for (let i = 0; i < real.length; i++) {
    const e = real[i] as number;
    real[i] = land[i] ? Math.max(e, cfg.landMinM) : Math.min(e, cfg.seaFloorMaxM);
  }

  // 4. Lakes and rivers: carve so the water surface sits at the old ground height.
  const water = grid.water;
  const carve = (i: number, depth: number): void => {
    if (!land[i] || authored[i] || (water[i] as number) >= depth) return;
    if ((water[i] as number) === 0) real[i] = (real[i] as number) - depth;
    else real[i] = (real[i] as number) + (water[i] as number) - depth;
    water[i] = depth;
  };
  for (const poly of input.lakes) fillRings(poly.rings.map(toCells), cols, rows, (i) => carve(i, cfg.lakeDepthM));
  for (const river of input.rivers) {
    const w = (river.major ? cfg.riverWidthMajorM : cfg.riverWidthMinorM) / cfg.cellM;
    strokePolyline(toCells(river.line), w, cols, rows, (i) => carve(i, cfg.riverDepthM));
  }
  // Authored rivers that are not tidal: cut in like any river, but also inside their regions.
  for (const river of input.water?.rivers ?? []) {
    if (river.tidal) continue;
    strokeAuthored(river, field, cfg.densifyKm, minHalfCells, frame, (i) => {
      if (!land[i] || (water[i] as number) >= cfg.riverDepthM) return;
      real[i] = (real[i] as number) + (water[i] as number) - cfg.riverDepthM;
      water[i] = cfg.riverDepthM;
    });
  }

  // 5. Airports: level, dry ground under the footprint (runways, apron), blended into the land around it.
  //    Water and hills inside the boundary but outside the footprint stay, so a river can run past a runway end.
  const flattened: Skeleton['flattened'][number][] = [];
  const blendCells = cfg.airportBlendKm / cellKm;
  for (const a of placement.airports) {
    const b = a.boundary;
    const scale = a.airport.boundaryKm.w / b.w;
    const rects = a.airport.footprint
      ? a.airport.footprint.map((f) => ({
          cx: b.cx + f.x / scale,
          cy: b.cy + f.y / scale,
          hl: f.length / scale / 2 + cfg.airportShoulderKm,
          hw: f.width / scale / 2 + cfg.airportShoulderKm,
          h: (f.headingDeg * Math.PI) / 180,
        }))
      : [{ cx: b.cx, cy: b.cy, hl: b.h / 2, hw: b.w / 2, h: 0 }];
    const mask = new Set<number>();
    for (const q of rects) {
      const reachKm = Math.hypot(q.hl, q.hw);
      const sinH = Math.sin(q.h);
      const cosH = Math.cos(q.h);
      const cA = Math.max(0, Math.floor((q.cx - reachKm - left) / cellKm));
      const cB = Math.min(cols - 1, Math.ceil((q.cx + reachKm - left) / cellKm));
      const rA = Math.max(0, Math.floor((q.cy - reachKm - bottom) / cellKm));
      const rB = Math.min(rows - 1, Math.ceil((q.cy + reachKm - bottom) / cellKm));
      for (let r = rA; r <= rB; r++) {
        for (let c = cA; c <= cB; c++) {
          const dx = left + (c + 0.5) * cellKm - q.cx;
          const dy = bottom + (r + 0.5) * cellKm - q.cy;
          if (Math.abs(dx * sinH + dy * cosH) <= q.hl && Math.abs(dx * cosH - dy * sinH) <= q.hw) mask.add(r * cols + c);
        }
      }
    }
    const cells = [...mask].sort((x, y) => x - y);
    if (cells.length === 0) continue;
    let c0 = cols;
    let c1 = -1;
    let r0 = rows;
    let r1 = -1;
    for (const i of cells) {
      const c = i % cols;
      const r = (i - c) / cols;
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
    }
    let target = a.airport.elevationM;
    if (target === undefined) {
      let sum = 0;
      let n = 0;
      for (const i of cells) {
        if (land[i]) {
          sum += (real[i] as number) + (water[i] as number);
          n++;
        }
      }
      target = n > 0 ? sum / n : cfg.landMinM + 1;
    }
    target = Math.max(cfg.landMinM + 1, Math.round(target));

    // Distance from the footprint (chamfer) over a window, to blend the ground back into the natural land.
    const reach = Math.ceil(blendCells);
    const wc0 = Math.max(0, c0 - reach);
    const wc1 = Math.min(cols - 1, c1 + reach);
    const wr0 = Math.max(0, r0 - reach);
    const wr1 = Math.min(rows - 1, r1 + reach);
    const ww = wc1 - wc0 + 1;
    const wh = wr1 - wr0 + 1;
    const dist = new Float32Array(ww * wh).fill(1e9);
    for (const i of cells) {
      const c = i % cols;
      dist[(Math.floor(i / cols) - wr0) * ww + (c - wc0)] = 0;
    }
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        let d = dist[y * ww + x] as number;
        if (x > 0) d = Math.min(d, (dist[y * ww + x - 1] as number) + 1);
        if (y > 0) {
          d = Math.min(d, (dist[(y - 1) * ww + x] as number) + 1);
          if (x > 0) d = Math.min(d, (dist[(y - 1) * ww + x - 1] as number) + 1.414);
          if (x < ww - 1) d = Math.min(d, (dist[(y - 1) * ww + x + 1] as number) + 1.414);
        }
        dist[y * ww + x] = d;
      }
    }
    for (let y = wh - 1; y >= 0; y--) {
      for (let x = ww - 1; x >= 0; x--) {
        let d = dist[y * ww + x] as number;
        if (x < ww - 1) d = Math.min(d, (dist[y * ww + x + 1] as number) + 1);
        if (y < wh - 1) {
          d = Math.min(d, (dist[(y + 1) * ww + x] as number) + 1);
          if (x < ww - 1) d = Math.min(d, (dist[(y + 1) * ww + x + 1] as number) + 1.414);
          if (x > 0) d = Math.min(d, (dist[(y + 1) * ww + x - 1] as number) + 1.414);
        }
        dist[y * ww + x] = d;
      }
    }
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const i = (wr0 + y) * cols + (wc0 + x);
        const d = dist[y * ww + x] as number;
        if (d === 0) {
          land[i] = 1;
          water[i] = 0;
          real[i] = target;
        } else if (d <= blendCells && land[i] && !water[i]) {
          const t = d / blendCells;
          const k = t * t * (3 - 2 * t);
          real[i] = target * (1 - k) + (real[i] as number) * k;
        }
      }
    }
    flattened.push({ id: a.airport.id, c0, c1, r0, r1, elevationM: target, cells });
  }

  // 6. Write the grid layers and choose ground types.
  const { elevation, terrain } = grid;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const e = real[i] as number;
      const ground = e + (water[i] as number);
      // A touch of seeded dither on land, so whole-meter steps do not show as terraces.
      const dither = land[i] && !(water[i] as number) ? hash2(col0 + c, row0 + r, cfg.seed + 30) - 0.5 : 0;
      elevation[i] = Math.max(-32768, Math.min(32767, Math.round(e + dither)));
      if (!land[i] || (water[i] as number) > 0) {
        terrain[i] = Terrain.seabed;
      } else if (ground >= cfg.snowM) {
        terrain[i] = Terrain.snow;
      } else if (ground >= cfg.mountainM) {
        terrain[i] = Terrain.mountain;
      } else if (ground >= cfg.forestM) {
        terrain[i] = Terrain.forest;
      } else {
        const big = valueNoise(col0 + c, row0 + r, cellsOf(cfg.patchBigM), cfg.seed);
        const small = valueNoise(col0 + c, row0 + r, cellsOf(cfg.patchSmallM), cfg.seed + 1);
        const patch = big * 0.7 + small * 0.3;
        if (ground < cfg.farmlandMaxM && patch > 0.5) terrain[i] = Terrain.farmland;
        else if (patch < 0.3) terrain[i] = Terrain.forest;
        else terrain[i] = Terrain.grass;
      }
    }
  }
  // Under the footprint the ground is plain grass; E3 lays the real surfaces over it.
  for (const f of flattened) for (const i of f.cells) terrain[i] = Terrain.grass;

  return { grid, cellKm, land, originKm: { x: left, y: bottom }, flattened };
}

/** Even-odd test of a point against a closed ring, both in real km. */
export function pointInRing(x: number, y: number, ring: readonly PointKm[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as PointKm;
    const b = ring[j] as PointKm;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Where a grid sits, for drawing into it in world km. */
export interface GridFrame {
  readonly left: number;
  readonly bottom: number;
  readonly cellKm: number;
  readonly cols: number;
  readonly rows: number;
}

/**
 * Fill a hand-drawn river. Its banks are offset from the centerline in real km and then passed
 * through the map field, so it is as wide as it really is at each place's scale and bends with the
 * warp and the airport stamps. Never narrower than `minHalfCells` each side.
 */
export function strokeAuthored(river: AuthoredRiver, field: MapField, maxStepKm: number, minHalfCells: number, g: GridFrame, set: (index: number) => void): void {
  const pts = river.points.map((q) => ({ ...project(q[1], q[0]), half: q[2] / 2000 }));
  // Densify the centerline in real km, finer where the river is narrow.
  const line: { x: number; y: number; half: number; nx: number; ny: number }[] = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k] as (typeof pts)[number];
    const b = pts[k + 1] as (typeof pts)[number];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const step = river.widthIn === 'world' ? Math.min(maxStepKm, 0.05) : Math.min(maxStepKm, Math.max(0.02, Math.min(a.half, b.half) / 2));
    const n = Math.max(1, Math.ceil(len / step));
    const last = k + 2 === pts.length;
    for (let s = 0; s <= (last ? n : n - 1); s++) {
      const t = s / n;
      line.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, half: a.half + (b.half - a.half) * t, nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len });
    }
  }
  // Normals from the neighbors, so the banks turn smoothly at the joints.
  for (let i = 1; i + 1 < line.length; i++) {
    const p = line[i - 1] as (typeof line)[number];
    const q = line[i + 1] as (typeof line)[number];
    const tx = q.x - p.x;
    const ty = q.y - p.y;
    const l = Math.hypot(tx, ty);
    const m = line[i] as (typeof line)[number];
    if (l > 0) {
      m.nx = -ty / l;
      m.ny = tx / l;
    }
  }
  const cell = (w: PointKm): CellPoint => [(w.x - g.left) / g.cellKm, (w.y - g.bottom) / g.cellKm];
  let prev: { l: CellPoint; r: CellPoint } | null = null;
  if (river.widthIn === 'world') {
    // Widths are world meters: offset the banks in world space, square to the river as drawn.
    const centers = line.map((p) => cell(field.toWorld(p.x, p.y)));
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i] as CellPoint;
      const a = centers[Math.max(0, i - 1)] as CellPoint;
      const b = centers[Math.min(centers.length - 1, i + 1)] as CellPoint;
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (tl === 0) continue;
      const nx = -(b[1] - a[1]) / tl;
      const ny = (b[0] - a[0]) / tl;
      const h = Math.max(minHalfCells, (line[i] as (typeof line)[number]).half / g.cellKm);
      const l: CellPoint = [c[0] + nx * h, c[1] + ny * h];
      const r: CellPoint = [c[0] - nx * h, c[1] - ny * h];
      if (prev) fillRings([[prev.l, l, r, prev.r]], g.cols, g.rows, set);
      strokePolyline([c], 2 * h, g.cols, g.rows, set);
      prev = { l, r };
    }
    return;
  }
  for (const p of line) {
    const c = cell(field.toWorld(p.x, p.y));
    const widen = (b: CellPoint): CellPoint => {
      const d = Math.hypot(b[0] - c[0], b[1] - c[1]);
      return d >= minHalfCells || d === 0 ? b : [c[0] + ((b[0] - c[0]) * minHalfCells) / d, c[1] + ((b[1] - c[1]) * minHalfCells) / d];
    };
    const l = widen(cell(field.toWorld(p.x + p.nx * p.half, p.y + p.ny * p.half)));
    const r = widen(cell(field.toWorld(p.x - p.nx * p.half, p.y - p.ny * p.half)));
    if (prev) fillRings([[prev.l, l, r, prev.r]], g.cols, g.rows, set);
    const rad = Math.min(Math.hypot(l[0] - c[0], l[1] - c[1]), Math.hypot(r[0] - c[0], r[1] - c[1]));
    strokePolyline([c], 2 * rad, g.cols, g.rows, set);
    prev = { l, r };
  }
}

/** Cell index containing a world-km point, or -1 when outside. */
export function cellAt(sk: Skeleton, xKm: number, yKm: number): number {
  const c = Math.floor((xKm - sk.originKm.x) / sk.cellKm);
  const r = Math.floor((yKm - sk.originKm.y) / sk.cellKm);
  if (c < 0 || r < 0 || c >= sk.grid.cols || r >= sk.grid.rows) return -1;
  return r * sk.grid.cols + c;
}
