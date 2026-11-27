import type { MapRoad } from '../../src/sim/world/mapFile';
import { nearestOnOutline, type Polygon } from '../../src/sim/world/polygon';
import { project, type PointKm } from './project';
import type { ShapeLine } from './shapefile';
import type { RoadsFile } from './types';

export interface RoadInput {
  readonly lines: readonly ShapeLine[];
  readonly config: RoadsFile;
  /** Real km to world km. */
  readonly toWorld: (xKm: number, yKm: number) => PointKm;
  /** World km of the map's southwest corner, and the map's size in world meters. */
  readonly originKm: PointKm;
  readonly width: number;
  readonly height: number;
  /** True over water, game frame world meters. */
  readonly wet: (x: number, y: number) => boolean;
  /** Convex counterclockwise shapes around the airports, game frame world meters: roads go around them. */
  readonly avoid?: readonly Polygon[];
}

type P = readonly [number, number];

/** Which class a road name belongs to, or null when it is left out. */
export function roadClass(name: string, config: RoadsFile): MapRoad['kind'] | null {
  if (config.exclude.some((s) => name.includes(s))) return null;
  if (config.major.prefixes.some((s) => name.startsWith(s)) || config.major.names.includes(name)) return 'major';
  return config.minor.names.includes(name) ? 'minor' : null;
}

/** Douglas-Peucker: drop points closer than `tolerance` to the line through their neighbors that stay. */
export function simplify(points: readonly P[], tolerance: number): P[] {
  if (points.length <= 2) return [...points];
  const a = points[0] as P;
  const b = points[points.length - 1] as P;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  let far = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i] as P;
    const d = len === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len;
    if (d > far) {
      far = d;
      at = i;
    }
  }
  if (far <= tolerance) return [a, b];
  return [...simplify(points.slice(0, at + 1), tolerance), ...simplify(points.slice(at), tolerance).slice(1)];
}

/** Cut a line into pieces over land and pieces over water, looking every `step` meters. Neighbors share their end point. */
export function splitAtWater(line: readonly P[], wet: (x: number, y: number) => boolean, step: number): { bridge: boolean; points: P[] }[] {
  const dense: P[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as P;
    const b = line[i + 1] as P;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 0; s < n; s++) dense.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
  }
  dense.push(line[line.length - 1] as P);
  const out: { bridge: boolean; points: P[] }[] = [];
  for (let i = 0; i + 1 < dense.length; i++) {
    const a = dense[i] as P;
    const b = dense[i + 1] as P;
    const bridge = wet((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const last = out[out.length - 1];
    if (last && last.bridge === bridge) last.points.push(b);
    else out.push({ bridge, points: [a, b] });
  }
  return out;
}

const round = (v: number): number => Math.round(v * 2) / 2;

/** Join lines of one name that share an end point, so a road can be rerouted as a whole. */
export function joinLines(lines: readonly ShapeLine[]): ShapeLine[] {
  const key = (name: string, p: P): string => `${name}|${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const ends = new Map<string, number[]>();
  lines.forEach((l, i) => {
    for (const p of [l.line[0] as P, l.line[l.line.length - 1] as P]) {
      const k = key(l.name, p);
      ends.set(k, [...(ends.get(k) ?? []), i]);
    }
  });
  const used = new Array<boolean>(lines.length).fill(false);
  const out: ShapeLine[] = [];
  lines.forEach((first, i) => {
    if (used[i]) return;
    used[i] = true;
    let chain: P[] = [...first.line];
    for (let turn = 0; turn < 2; turn++) {
      for (;;) {
        const end = chain[chain.length - 1] as P;
        const next = (ends.get(key(first.name, end)) ?? []).find((k) => !used[k]);
        if (next === undefined) break;
        used[next] = true;
        const l = (lines[next] as ShapeLine).line;
        const forward = key(first.name, l[0] as P) === key(first.name, end);
        chain = chain.concat((forward ? [...l] : [...l].reverse()).slice(1));
      }
      chain.reverse(); // then grow the other end
    }
    out.push({ name: first.name, line: chain });
  });
  return out;
}

/** Strictly inside a convex counterclockwise polygon: left of every side. */
const within = (p: P, shape: Polygon): boolean =>
  shape.every((a, i) => {
    const b = shape[(i + 1) % shape.length] as Polygon[number];
    return (b.x - a.x) * (p[1] - a.y) - (b.y - a.y) * (p[0] - a.x) > 0;
  });

/** Where the segment from `out` (outside) to `inner` (inside) meets the edge of the shape. */
function crossing(out: P, inner: P, shape: Polygon): P {
  let lo = 0;
  let hi = 1;
  const at = (t: number): P => [out[0] + (inner[0] - out[0]) * t, out[1] + (inner[1] - out[1]) * t];
  for (let k = 0; k < 24; k++) {
    const m = (lo + hi) / 2;
    if (within(at(m), shape)) hi = m;
    else lo = m;
  }
  return at(lo);
}

/** The shorter way along the outline from one point on it to another, including any corners passed. */
function alongEdge(from: P, to: P, shape: Polygon): P[] {
  /** Distance counterclockwise from the first corner to each corner. */
  const starts: number[] = [];
  let total = 0;
  shape.forEach((a, i) => {
    const b = shape[(i + 1) % shape.length] as Polygon[number];
    starts.push(total);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  });
  const where = (p: P): number => {
    const { edge, t } = nearestOnOutline(shape, p[0], p[1]);
    const start = starts[edge] as number;
    return start + t * ((starts[edge + 1] ?? total) - start);
  };
  const t0 = where(from);
  const ahead = (where(to) - t0 + total) % total;
  const sign = ahead <= total - ahead ? 1 : -1;
  const span = sign > 0 ? ahead : total - ahead;
  const passed = shape
    .map((v, i) => [(((((starts[i] as number) - t0) * sign) % total) + total) % total, [v.x, v.y] as P] as const)
    .filter(([d]) => d > 0 && d < span)
    .sort((a, c) => a[0] - c[0])
    .map(([, c]) => c);
  return [from, ...passed, to];
}

/** Reroute a line around a convex shape: each run inside it follows the edge instead. A run with a loose end is cut off. */
export function skirt(line: readonly P[], shape: Polygon): P[][] {
  const out: P[][] = [];
  let piece: P[] = [];
  let entry: P | null = null;
  for (let i = 0; i < line.length; i++) {
    const p = line[i] as P;
    const prev = line[i - 1];
    if (within(p, shape)) {
      if (prev && !within(prev, shape)) entry = crossing(prev, p, shape);
      continue;
    }
    if (prev && within(prev, shape)) {
      const exit = crossing(p, prev, shape);
      if (entry) piece.push(...alongEdge(entry, exit, shape));
      else {
        out.push(piece);
        piece = [exit];
      }
      entry = null;
    }
    piece.push(p);
  }
  if (entry) piece.push(entry);
  out.push(piece);
  return out.filter((q) => q.length > 1);
}

/** Segments closer than about 35 degrees in direction run alongside each other; others cross. */
const PARALLEL_COS = 0.8;
const HASH_M = 100;

interface Placed {
  readonly a: P;
  readonly b: P;
  readonly line: number;
  /** Distance along its own line, so a line is not merged into the stretch just behind. */
  readonly at: number;
}

function nearestOn(p: P, a: P, b: P): P {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return [a[0] + dx * t, a[1] + dy * t];
}

/** The road segments placed so far, to find the one a new segment runs alongside. */
function createCover(reach: number): { add(s: Placed): void; find(s: Placed): Placed | null } {
  const cells = new Map<string, Placed[]>();
  const cell = (v: number): number => Math.floor(v / HASH_M);
  return {
    add(s) {
      for (let x = cell(Math.min(s.a[0], s.b[0]) - reach); x <= cell(Math.max(s.a[0], s.b[0]) + reach); x++) {
        for (let y = cell(Math.min(s.a[1], s.b[1]) - reach); y <= cell(Math.max(s.a[1], s.b[1]) + reach); y++) {
          const list = cells.get(`${x},${y}`);
          if (list) list.push(s);
          else cells.set(`${x},${y}`, [s]);
        }
      }
    },
    find(s) {
      const mid: P = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
      let best: Placed | null = null;
      let bestD = reach;
      for (const o of cells.get(`${cell(mid[0])},${cell(mid[1])}`) ?? []) {
        if (o.line === s.line && Math.abs(o.at - s.at) < reach * 3) continue;
        const olen = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) || 1;
        const cos = Math.abs((s.b[0] - s.a[0]) * (o.b[0] - o.a[0]) + (s.b[1] - s.a[1]) * (o.b[1] - o.a[1])) / (len * olen);
        if (cos < PARALLEL_COS) continue;
        const q = nearestOn(mid, o.a, o.b);
        const d = Math.hypot(mid[0] - q[0], mid[1] - q[1]);
        if (d <= bestD) {
          best = o;
          bestD = d;
        }
      }
      return best;
    },
  };
}

/**
 * Real roads laid on the map: warped like the coast, clipped to the map, thinned, and split where they cross water.
 * A stretch running alongside one already placed is dropped, so the two directions of a highway (and the several names
 * one stretch carries) become a single centerline. Points are game-frame world meters.
 */
export function buildRoads(input: RoadInput): MapRoad[] {
  const { config } = input;
  const cover = createCover(config.mergeM);
  let lineId = 0;
  const out: MapRoad[] = [];
  const inside = (p: P): boolean => p[0] >= 0 && p[1] >= 0 && p[0] <= input.width && p[1] <= input.height;

  for (const kind of ['major', 'minor'] as const) {
    for (const road of joinLines(input.lines.filter((l) => roadClass(l.name, config) === kind))) {
      const real = road.line.map(([lon, lat]) => project(lat, lon));
      // Warp, bending long edges.
      const world: P[] = [];
      for (let i = 0; i + 1 < real.length; i++) {
        const a = real[i] as PointKm;
        const b = real[i + 1] as PointKm;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / config.densifyKm));
        for (let s = i === 0 ? 0 : 1; s <= n; s++) {
          const w = input.toWorld(a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n);
          world.push([(w.x - input.originKm.x) * 1000, (w.y - input.originKm.y) * 1000]);
        }
      }
      let lines: P[][] = [world];
      for (const shape of input.avoid ?? []) lines = lines.flatMap((l) => skirt(l, shape));

      for (const line of lines) {
        let piece: P[] = [];
        const flush = (): void => {
          if (piece.length > 1) {
            for (const part of splitAtWater(simplify(piece, config.simplifyM), input.wet, config.bridgeStepM)) {
              const points = simplify(part.points, 0.5).flatMap((p) => [round(p[0]), round(p[1])]);
              out.push({ kind, bridge: part.bridge, points });
            }
          }
          piece = [];
        };
        const id = lineId++;
        let at = 0;
        let covered: Placed | null = null;
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i] as P;
          const b = line[i + 1] as P;
          const segment: Placed = { a, b, line: id, at };
          at += Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (!(inside(a) || inside(b))) {
            flush();
            covered = null;
            continue;
          }
          const other = cover.find(segment);
          if (other) {
            // Leaving off here: run into the road that carries on, so there is no gap.
            if (piece.length) piece.push(nearestOn(b, other.a, other.b));
            flush();
            covered = other;
            continue;
          }
          cover.add(segment);
          if (!piece.length) piece.push(...(covered ? [nearestOn(a, covered.a, covered.b), a] : [a]));
          covered = null;
          piece.push(b);
        }
        flush();
      }
    }
  }

  return out;
}

/** Length of a road piece, meters. */
export function roadLength(road: MapRoad): number {
  let sum = 0;
  for (let i = 2; i < road.points.length; i += 2) sum += Math.hypot((road.points[i] as number) - (road.points[i - 2] as number), (road.points[i + 1] as number) - (road.points[i - 1] as number));
  return sum;
}
