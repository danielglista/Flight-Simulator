import type { LandmarkDecor, LandmarkSolid, MapLandmark } from './mapFile';
import { contains, type Polygon } from './polygon';
import { Terrain } from './terrain';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** A runway in WORLD meters. Endpoints are the stored truth; length and heading come from them. */
export interface Runway {
  /** Thresholds. */
  readonly a: Vec2;
  readonly b: Vec2;
  readonly width: number;
  /** Landing from a, landing from b: ['07', '25']. */
  readonly names: readonly [string, string];
  readonly length: number;
  /** a -> b, radians clockwise from north, 0..2pi. */
  readonly heading: number;
}

/** A numbered parking stand, WORLD meters. */
export interface Gate {
  /** `B4` */
  readonly name: string;
  /** Where the plane stops: the end of the lead-in line. */
  readonly stand: Vec2;
  /** Facing at the stand, radians clockwise from north, 0..2pi. */
  readonly heading: number;
  /** Lead-in line from the taxi lane to the stand. */
  readonly leadIn: readonly Vec2[];
}

export interface Airport {
  readonly ident: string;
  readonly name: string;
  /** Axis-aligned boundary, WORLD meters. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Width of the band inside the boundary where ground blends to the base terrain, WORLD m. */
  readonly blend: number;
  /** REAL meters above sea level (divided by the altitude scale, not the airport scale). */
  readonly fieldElevationM: number;
  /** WORLD meters per fine-grid cell side. */
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  /** Terrain codes, row 0 south, column 0 west. Runways are not in here. */
  readonly surface: Uint8Array;
  readonly runways: readonly Runway[];
  readonly variationDeg?: number;
  /** Taxiway centerlines, for the markings. Their pavement is in `surface`. */
  readonly taxiways?: readonly (readonly Vec2[])[];
  /** Hold-short bars across the ways onto a runway, end to end. */
  readonly holdShort?: readonly (readonly [Vec2, Vec2])[];
  readonly gates?: readonly Gate[];
  /** Buildings and what is painted around them (E7.9), world m: solid, and drawn as a landmark is. */
  readonly structures?: MapLandmark;
  /**
   * The airport covers only its ground cells; elsewhere in the boundary (`OFF_AIRPORT`) the map shows through, so a
   * river may pass inside it. There is no blend band: the map under the ground must already be flat and dry.
   */
  readonly masked?: boolean;
}

/** Fine-grid code of a cell that is not part of a masked airport. */
export const OFF_AIRPORT = 255;

// ---- Authoring format: LOCAL REAL meters (x east, y north from the anchor) ----

export type PavingDef =
  | { readonly kind: 'strip'; readonly code: number; readonly a: Vec2; readonly b: Vec2; readonly width: number }
  | {
      readonly kind: 'rect';
      readonly code: number;
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    }
  | { readonly kind: 'polygon'; readonly code: number; readonly points: Polygon };

/** A building piece: straight walls on a convex plan, or a round drum. Local real m; heights real m above the field. */
export type StructureDef = {
  readonly bottom: number;
  readonly top: number;
  readonly material: string;
  /** Roof color, where it differs from the walls (not for a drum). */
  readonly cap?: string;
  /** Spacing of the windows or columns up the walls. */
  readonly columns?: number;
} & ({ readonly points: readonly Vec2[] } | { readonly center: Vec2; readonly diameter: number });

/** Flat paint on the ground, local real m. */
export type GroundPaintDef = { readonly material: string; readonly points: readonly Vec2[]; readonly detail?: boolean };

export interface AirportDef {
  readonly ident: string;
  readonly name: string;
  /** WORLD meters. */
  readonly anchor: Vec2;
  /** Real meters per world meter of this layout. Never used for altitude. */
  readonly scale: number;
  /** Degrees a runway name stands above its true heading (magnetic = true + this, west positive). Default 0. */
  readonly variationDeg?: number;
  /**
   * When given, the airport is masked: only inside these polygons (cleared, level; local real meters) is airport
   * ground, and `boundary` must enclose them.
   */
  readonly ground?: readonly Polygon[];
  /** Local real meters, relative to the anchor. */
  readonly boundary: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  /** Local real meters. */
  readonly blend: number;
  /** REAL meters above sea level. */
  readonly fieldElevationM: number;
  /** WORLD meters. */
  readonly cellSize: number;
  readonly runways: readonly {
    readonly a: Vec2;
    readonly b: Vec2;
    readonly width: number;
    readonly names: readonly [string, string];
  }[];
  readonly paving: readonly PavingDef[];
  /** Center lines paved `width` real m wide, under `paving`. */
  readonly taxiways?: readonly { readonly points: readonly Vec2[]; readonly width: number }[];
  readonly holdShort?: readonly (readonly [Vec2, Vec2])[];
  readonly gates?: readonly { readonly name: string; readonly leadIn: readonly Vec2[] }[];
  readonly structures?: readonly StructureDef[];
  readonly groundPaint?: readonly GroundPaintDef[];
  /** Real meters of building height per world meter. Needed with `structures`. */
  readonly buildingHeightScale?: number;
}

/** Position along a runway (0 at a) and across it (right of the a -> b direction is positive). */
export function runwayFrame(rw: Runway, x: number, y: number): { along: number; across: number } {
  const ux = (rw.b.x - rw.a.x) / rw.length;
  const uy = (rw.b.y - rw.a.y) / rw.length;
  const dx = x - rw.a.x;
  const dy = y - rw.a.y;
  return { along: dx * ux + dy * uy, across: dx * uy - dy * ux };
}

export function onRunway(rw: Runway, x: number, y: number): boolean {
  const { along, across } = runwayFrame(rw, x, y);
  return along >= 0 && along <= rw.length && Math.abs(across) <= rw.width / 2;
}

/**
 * Where the infinite line from `origin` along `heading` is inside the runway
 * rectangle: distances along the line (may be negative), or null if it misses.
 */
export function runwaySpan(
  rw: Runway,
  origin: Vec2,
  heading: number,
): { readonly enter: number; readonly exit: number } | null {
  const f = runwayFrame(rw, origin.x, origin.y);
  const dx = Math.sin(heading);
  const dy = Math.cos(heading);
  const ux = (rw.b.x - rw.a.x) / rw.length;
  const uy = (rw.b.y - rw.a.y) / rw.length;
  const dAlong = dx * ux + dy * uy;
  const dAcross = dx * uy - dy * ux;
  let lo = -Infinity;
  let hi = Infinity;
  const clip = (p: number, rate: number, min: number, max: number): boolean => {
    if (Math.abs(rate) < 1e-12) return p >= min && p <= max;
    const t0 = (min - p) / rate;
    const t1 = (max - p) / rate;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
    return true;
  };
  if (!clip(f.along, dAlong, 0, rw.length)) return null;
  if (!clip(f.across, dAcross, -rw.width / 2, rw.width / 2)) return null;
  return lo <= hi ? { enter: lo, exit: hi } : null;
}

export function airportContains(a: Airport, x: number, y: number): boolean {
  return x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY;
}

/** 0 at the boundary, 1 from `blend` inside it. Smooth, so ground has no kink. A masked airport has no band. */
export function blendWeight(a: Airport, x: number, y: number): number {
  if (a.masked) return 1;
  const d = Math.min(x - a.minX, a.maxX - x, y - a.minY, a.maxY - y);
  const t = Math.min(1, Math.max(0, d / a.blend));
  return t * t * (3 - 2 * t);
}

/** Fine-grid terrain code at (x, y), ignoring runway objects. Caller checks the boundary. */
export function fineSurfaceAt(a: Airport, x: number, y: number): number {
  const col = Math.min(a.cols - 1, Math.max(0, Math.floor((x - a.minX) / a.cellSize)));
  const row = Math.min(a.rows - 1, Math.max(0, Math.floor((y - a.minY) / a.cellSize)));
  return a.surface[row * a.cols + col] ?? Terrain.grass;
}

/** Nearest ten degrees as a two-digit runway number, 01..36. */
export function runwayNumber(heading: number): string {
  let n = Math.round((heading * 180) / Math.PI / 10) % 36;
  if (n <= 0) n += 36;
  return String(n).padStart(2, '0');
}

function stripContains(a: Vec2, b: Vec2, width: number, x: number, y: number): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const along = (x - a.x) * ux + (y - a.y) * uy;
  const across = (x - a.x) * uy - (y - a.y) * ux;
  // Ends extend half a width, so joints have no notch.
  return along >= -width / 2 && along <= len + width / 2 && Math.abs(across) <= width / 2;
}

/** Converts an authored definition (local real meters) to world meters and paints the fine grid. */
export function buildAirport(def: AirportDef): Airport {
  const k = def.scale;
  const toWorld = (p: Vec2): Vec2 => ({ x: def.anchor.x + p.x / k, y: def.anchor.y + p.y / k });
  const minX = def.anchor.x + def.boundary.minX / k;
  const minY = def.anchor.y + def.boundary.minY / k;
  const maxX = def.anchor.x + def.boundary.maxX / k;
  const maxY = def.anchor.y + def.boundary.maxY / k;
  const cols = Math.round((maxX - minX) / def.cellSize);
  const rows = Math.round((maxY - minY) / def.cellSize);
  const surface = new Uint8Array(cols * rows).fill(def.ground ? OFF_AIRPORT : Terrain.grass);

  const ground = (def.ground ?? []).map((g) => g.map(toWorld));
  for (let r = 0; r < rows && ground.length > 0; r++) {
    const y = minY + (r + 0.5) * def.cellSize;
    for (let c = 0; c < cols; c++) {
      const x = minX + (c + 0.5) * def.cellSize;
      if (ground.some((g) => contains(g, x, y))) surface[r * cols + c] = Terrain.grass;
    }
  }

  const lanes: PavingDef[] = (def.taxiways ?? []).flatMap((t) =>
    t.points.slice(1).map((b, i): PavingDef => ({ kind: 'strip', code: Terrain.taxiway, a: t.points[i] as Vec2, b, width: t.width })),
  );
  for (const p of [...lanes, ...def.paving]) {
    let test: (x: number, y: number) => boolean;
    if (p.kind === 'strip') {
      const a = toWorld(p.a);
      const b = toWorld(p.b);
      const w = p.width / k;
      test = (x, y) => stripContains(a, b, w, x, y);
    } else if (p.kind === 'polygon') {
      const points = p.points.map(toWorld);
      test = (x, y) => contains(points, x, y);
    } else {
      const lo = toWorld({ x: p.minX, y: p.minY });
      const hi = toWorld({ x: p.maxX, y: p.maxY });
      test = (x, y) => x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y;
    }
    for (let r = 0; r < rows; r++) {
      const y = minY + (r + 0.5) * def.cellSize;
      for (let c = 0; c < cols; c++) {
        if (test(minX + (c + 0.5) * def.cellSize, y)) surface[r * cols + c] = p.code;
      }
    }
  }

  const runways: Runway[] = def.runways.map((r) => {
    const a = toWorld(r.a);
    const b = toWorld(r.b);
    const h = Math.atan2(b.x - a.x, b.y - a.y);
    return {
      a,
      b,
      width: r.width / k,
      names: r.names,
      length: Math.hypot(b.x - a.x, b.y - a.y),
      heading: h < 0 ? h + Math.PI * 2 : h,
    };
  });

  const gates: Gate[] = (def.gates ?? []).map((g) => {
    const leadIn = g.leadIn.map(toWorld);
    const stand = leadIn[leadIn.length - 1] as Vec2;
    const from = leadIn[leadIn.length - 2] as Vec2;
    const h = Math.atan2(stand.x - from.x, stand.y - from.y);
    return { name: g.name, stand, heading: h < 0 ? h + Math.PI * 2 : h, leadIn };
  });

  const hk = def.buildingHeightScale ?? 1;
  const flat = (points: readonly Vec2[]): number[] => points.flatMap((p) => { const w = toWorld(p); return [w.x, w.y]; });
  const solids = (def.structures ?? []).map((s): LandmarkSolid => {
    const shared = { bottom: s.bottom / hk, top: s.top / hk, material: s.material, ...(s.columns ? { columns: s.columns / k } : {}) };
    if ('center' in s) {
      const d = s.diameter / k;
      return { ...toWorld(s.center), width: d, depth: d, topWidth: d, topDepth: d, shape: 'drum', ...shared };
    }
    // A prism's corners run counterclockwise.
    const area = s.points.reduce((sum, p, i) => { const q = s.points[(i + 1) % s.points.length] as Vec2; return sum + p.x * q.y - q.x * p.y; }, 0);
    const points = flat(area < 0 ? [...s.points].reverse() : s.points);
    const xs = points.filter((_, i) => i % 2 === 0);
    const ys = points.filter((_, i) => i % 2 === 1);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);
    return { x: Math.min(...xs) + width / 2, y: Math.min(...ys) + depth / 2, width, depth, topWidth: width, topDepth: depth, shape: 'prism', points, ...(s.cap ? { cap: s.cap } : {}), ...shared };
  });
  const decor = (def.groundPaint ?? []).map((p): LandmarkDecor => ({ kind: 'polygon', material: p.material, points: flat(p.points), ...(p.detail ? { detail: true } : {}) }));
  // Heights are measured from the ground at this point, so it must be on the airport.
  const first = runways[0];
  const structures: MapLandmark | undefined =
    first && (solids.length > 0 || decor.length > 0) ? { id: def.ident, x: (first.a.x + first.b.x) / 2, y: (first.a.y + first.b.y) / 2, solids, decor } : undefined;

  return {
    ident: def.ident,
    name: def.name,
    minX,
    minY,
    maxX,
    maxY,
    blend: def.blend / k,
    fieldElevationM: def.fieldElevationM,
    cellSize: def.cellSize,
    cols,
    rows,
    surface,
    runways,
    ...(def.taxiways ? { taxiways: def.taxiways.map((t) => t.points.map(toWorld)) } : {}),
    ...(def.holdShort ? { holdShort: def.holdShort.map(([a, b]) => [toWorld(a), toWorld(b)] as const) } : {}),
    ...(def.gates ? { gates } : {}),
    ...(structures ? { structures } : {}),
    ...(def.variationDeg === undefined ? {} : { variationDeg: def.variationDeg }),
    ...(def.ground ? { masked: true } : {}),
  };
}
