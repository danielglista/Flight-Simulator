import type { MapBuilding, MapRoad } from '../../src/sim/world/mapFile';
import { districtCode, districtStyleIndex } from './districts';
import type { District, DistrictsFile, HousingLevel } from './types';

type P = readonly [number, number];
type Shape = Pick<MapBuilding, 'x' | 'y' | 'width' | 'depth' | 'angle'>;

/** Everything about the layout that is not set in the district data. World meters. */
export const BUILDING_LAYOUT = {
  /** Downtown and industrial: space between neighboring lots, and a street after this many lots along and across. */
  lotGapM: 2,
  streetM: 10,
  blockLots: [4, 2] as readonly [number, number],
  /** Ground left between a building and the edge of a highway. */
  roadGapM: 4,
  /** Spacing of the points checked under a footprint. */
  sampleM: 8,
} as const;

/** Points across a footprint, no farther apart than the sample spacing, corners and edges included. */
export function footprintPoints(b: Shape): P[] {
  const a = (b.angle * Math.PI) / 180;
  // Width runs along the district's street heading, depth across it.
  const ux = Math.sin(a);
  const uy = Math.cos(a);
  const nu = Math.max(1, Math.ceil(b.width / BUILDING_LAYOUT.sampleM));
  const nv = Math.max(1, Math.ceil(b.depth / BUILDING_LAYOUT.sampleM));
  const out: P[] = [];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = (i / nu - 0.5) * b.width;
      const v = (j / nv - 0.5) * b.depth;
      out.push([b.x + ux * u + uy * v, b.y + uy * u - ux * v]);
    }
  }
  return out;
}

/** Distance from a point to the nearest highway edge, world m (negative on the road, Infinity when none is near). */
export function createRoadDistance(roads: readonly MapRoad[], halfWidthM: Readonly<Record<MapRoad['kind'], number>>): (x: number, y: number) => number {
  const CELL = 100;
  const cells = new Map<string, (readonly [number, number, number, number, number])[]>();
  for (const r of roads) {
    const half = halfWidthM[r.kind];
    for (let i = 0; i + 3 < r.points.length; i += 2) {
      const [ax, ay, bx, by] = r.points.slice(i, i + 4) as [number, number, number, number];
      for (let cx = Math.floor((Math.min(ax, bx) - CELL / 2) / CELL); cx <= Math.floor((Math.max(ax, bx) + CELL / 2) / CELL); cx++) {
        for (let cy = Math.floor((Math.min(ay, by) - CELL / 2) / CELL); cy <= Math.floor((Math.max(ay, by) + CELL / 2) / CELL); cy++) {
          const list = cells.get(`${cx},${cy}`);
          if (list) list.push([ax, ay, bx, by, half]);
          else cells.set(`${cx},${cy}`, [[ax, ay, bx, by, half]]);
        }
      }
    }
  }
  return (x, y) => {
    let best = Infinity;
    for (const [ax, ay, bx, by, half] of cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []) {
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t) - half);
    }
    return best;
  };
}

/** Do two footprints overlap? Separating axis test on the two rectangles. */
export function footprintsOverlap(a: Shape, b: Shape): boolean {
  const axes = (q: Shape): [P, P] => {
    const r = (q.angle * Math.PI) / 180;
    return [
      [Math.sin(r), Math.cos(r)],
      [Math.cos(r), -Math.sin(r)],
    ];
  };
  const reach = (q: Shape, n: P): number => {
    const [u, v] = axes(q);
    return (Math.abs(u[0] * n[0] + u[1] * n[1]) * q.width + Math.abs(v[0] * n[0] + v[1] * n[1]) * q.depth) / 2;
  };
  return [...axes(a), ...axes(b)].every((n) => Math.abs((b.x - a.x) * n[0] + (b.y - a.y) * n[1]) < reach(a, n) + reach(b, n));
}

/** Small seeded generator (mulberry32). */
function randomFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from the district's name, so editing one district does not reshuffle the others. */
function seedOf(id: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function inRing(x: number, y: number, ring: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as P;
    const b = ring[j] as P;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** One district's lot grid: its density level, or its type's settings turned into the same form. */
type Layout = HousingLevel;

/** The layout of a district, or null when it has no buildings. */
function layoutOf(d: District, types: DistrictsFile['types']): Layout | null {
  if (d.type === 'park') return null;
  if (d.type === 'housing') {
    const level = types.housing?.[(d.density ?? 1) - 1];
    return level ? { ...level, ...d.style } : null;
  }
  const base = types[d.type];
  if (!base) return null;
  const { coverage, footprintM, ...common } = { ...base, ...d.style };
  const { lotGapM, streetM, blockLots } = BUILDING_LAYOUT;
  const [nu, nv] = blockLots;
  const [fMin, fMax] = footprintM;
  const pitch = fMax + lotGapM;
  // Enough lots built that roofs cover the wanted share of a whole block, street included.
  const fill = Math.min(1, (coverage * (nu * pitch + streetM) * (nv * pitch + streetM)) / (nu * nv) / ((fMin + fMax) / 2) ** 2);
  return { ...common, alongM: footprintM, acrossM: footprintM, lotGapM, streetM, blockLots, fill };
}

export interface BuildingInput {
  readonly districts: readonly District[];
  /** Defaults per district type; a type without an entry has no buildings. */
  readonly styles: DistrictsFile['types'];
  /** A district's outline in game-frame world meters. */
  readonly ringWorld: (district: District) => P[];
  /** Terrain code at a point, as painted (water and airports never carry a district code). */
  readonly code: (x: number, y: number) => number;
  /** Ground height, world m. */
  readonly ground: (x: number, y: number) => number;
  readonly roadDistance: (x: number, y: number) => number;
  /** Ground kept for something else, such as a landmark (E6). */
  readonly blocked?: (x: number, y: number) => boolean;
  /** Real meters of building height per world meter. */
  readonly heightScale: number;
  readonly seed: number;
}

export interface BuildingResult {
  readonly buildings: readonly MapBuilding[];
}

/**
 * Fills the districts with buildings: lots on a grid at the district's street angle, a street every few lots, and in
 * each lot a rectangle or nothing. A building is kept only if all of it stands on its own district's ground, outside
 * every later district, and clear of highways and other buildings.
 */
export function generateBuildings(input: BuildingInput): BuildingResult {
  const L = BUILDING_LAYOUT;
  const out: MapBuilding[] = [];
  const near = new Map<string, MapBuilding[]>();
  const HASH = 100;
  const rings = input.districts.map((d) => {
    const ring = input.ringWorld(d);
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return { ring, left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
  });
  /** Is the point inside a district listed after number `n`? Neighbors of one ground color are told apart only this way. */
  const taken = (n: number, x: number, y: number): boolean =>
    rings.some((r, k) => k > n && x >= r.left && x <= r.right && y >= r.bottom && y <= r.top && inRing(x, y, r.ring));

  // Later districts paint over earlier ones, so they are filled first.
  for (let n = input.districts.length - 1; n >= 0; n--) {
    const d = input.districts[n] as District;
    const layout = layoutOf(d, input.styles);
    if (!layout) continue;
    const { ring } = rings[n] as (typeof rings)[number];
    const angle = (layout.streetDeg * Math.PI) / 180;
    const u: P = [Math.sin(angle), Math.cos(angle)];
    const v: P = [Math.cos(angle), -Math.sin(angle)];
    const [aMin, aMax] = layout.alongM;
    const [cMin, cMax] = layout.acrossM;
    const [nu, nv] = layout.blockLots;
    const pitchU = aMax + layout.lotGapM;
    const pitchV = cMax + layout.lotGapM;
    const rand = randomFrom(seedOf(d.id, input.seed));
    const position = (i: number, per: number, pitch: number): number => i * pitch + Math.floor(i / per) * layout.streetM + pitch / 2;
    const firstLot = (value: number, per: number, pitch: number): number => Math.floor(value / (per * pitch + layout.streetM)) * per;

    const along = ring.map((p) => p[0] * u[0] + p[1] * u[1]);
    const across = ring.map((p) => p[0] * v[0] + p[1] * v[1]);
    for (let i = firstLot(Math.min(...along), nu, pitchU); i <= firstLot(Math.max(...along), nu, pitchU) + nu; i++) {
      for (let j = firstLot(Math.min(...across), nv, pitchV); j <= firstLot(Math.max(...across), nv, pitchV) + nv; j++) {
        // Draw every lot's numbers, used or not, so the layout does not shift when a check changes.
        const take = rand() < layout.fill;
        const width = Math.round(aMin + (aMax - aMin) * rand());
        const depth = Math.round(cMin + (cMax - cMin) * rand());
        const ju = (rand() - 0.5) * (pitchU - layout.lotGapM - width) * layout.nudge;
        const jv = (rand() - 0.5) * (pitchV - layout.lotGapM - depth) * layout.nudge;
        const tall = rand() ** layout.heightSkew;
        if (!take) continue;
        const cu = position(i, nu, pitchU) + ju;
        const cv = position(j, nv, pitchV) + jv;
        const x = Math.round((u[0] * cu + v[0] * cv) * 10) / 10;
        const y = Math.round((u[1] * cu + v[1] * cv) * 10) / 10;
        if (!inRing(x, y, ring)) continue;
        const shape: Shape = { x, y, width, depth, angle: layout.streetDeg };
        const points = footprintPoints(shape);
        const want = districtCode(d);
        if (!points.every(([px, py]) => input.code(px, py) === want && input.roadDistance(px, py) >= L.roadGapM && !taken(n, px, py) && !input.blocked?.(px, py))) continue;

        const hx = Math.floor(x / HASH);
        const hy = Math.floor(y / HASH);
        let clash = false;
        for (let a = hx - 1; a <= hx + 1 && !clash; a++) {
          for (let b = hy - 1; b <= hy + 1 && !clash; b++) clash = (near.get(`${a},${b}`) ?? []).some((o) => footprintsOverlap(shape, o));
        }
        if (clash) continue;

        const [hMin, hMax] = layout.heightM;
        const height = Math.round(((hMin + (hMax - hMin) * tall) / input.heightScale) * 2) / 2;
        const building: MapBuilding = { ...shape, height, style: districtStyleIndex(d) };
        out.push(building);
        const key = `${hx},${hy}`;
        const list = near.get(key);
        if (list) list.push(building);
        else near.set(key, [building]);
      }
    }
  }
  return { buildings: out };
}

/** The file form: x, y, width, depth, angle, height, style for each building. */
export const packBuildings = (buildings: readonly MapBuilding[]): number[][] => buildings.map((b) => [b.x, b.y, b.width, b.depth, b.angle, b.height, b.style]);
