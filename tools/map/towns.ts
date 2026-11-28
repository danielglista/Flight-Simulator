import { TOWN_RADIUS_M } from '../../src/config/map';
import type { MapLandmark } from '../../src/sim/world/mapFile';
import { footprintPoints, footprintsOverlap, inRing } from './buildings';
import { buildLandmarks } from './landmarks';
import { project, type PointKm } from './project';
import type { MapField } from './stamp';
import type { BuiltArea, KitFile, KitPiece, Town } from './types';

/** Corners of a town's outline. */
const SIDES = 8;

/** A town's center, world km: only this point goes through the map warp, then the hand offset. */
export function townCenter(town: Town, field: Pick<MapField, 'toWorld'>): PointKm {
  const real = project(town.lat, town.lon);
  const w = field.toWorld(real.x, real.y);
  return { x: w.x + town.offsetM.x / 1000, y: w.y + town.offsetM.y / 1000 };
}

/** The outline: a regular octagon in world km with flat sides north, east, south and west, its size's radius to its corners. */
export function townRing(town: Town, field: Pick<MapField, 'toWorld'>): PointKm[] {
  const c = townCenter(town, field);
  const r = TOWN_RADIUS_M[town.size] / 1000;
  return Array.from({ length: SIDES }, (_, i) => {
    const a = ((i + 0.5) / SIDES) * Math.PI * 2;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/** A town as the ground painter and the house generator see it: one housing district. Its id seeds its houses. */
export const townArea = (town: Town): BuiltArea => ({ id: `town-${town.id}`, type: 'housing', density: town.density, ring: [], style: { streetDeg: town.streetDeg } });

/** Room a piece keeps from its neighbors, from houses and from a highway, world m. */
const PIECE_GAP_M = 4;
/** A piece whose spot is taken moves out in rings this far apart, world m, trying this many ways round each. */
const SEARCH_STEP_M = 6;
const SEARCH_WAYS = 24;
/** A piece too big to go inside the outline may stand just outside it, its middle within this many radii. */
const OUTSIDE_REACH = 1.5;

/** A kit piece where it stands, world m. */
export interface PlacedPiece {
  readonly id: string;
  readonly piece: string;
  readonly x: number;
  readonly y: number;
  /** Degrees clockwise, as a landmark is turned. */
  readonly turn: number;
  readonly enlarge: number;
  /** The plan before turning: east to west and north to south. */
  readonly width: number;
  readonly depth: number;
}

/** The rectangle in the house generator's terms: its width runs along a compass heading. */
export const pieceShape = (p: PlacedPiece, grow = 0) => ({ x: p.x, y: p.y, width: p.width + grow * 2, depth: p.depth + grow * 2, angle: 90 + p.turn });

export interface TownGround {
  /** Town center and outline, world m. */
  readonly center: { readonly x: number; readonly y: number };
  readonly ring: readonly (readonly [number, number])[];
  /** Is the point the town's own ground? Water never is. */
  readonly open: (x: number, y: number) => boolean;
  /** Is the point dry land, inside the town or not? */
  readonly dry: (x: number, y: number) => boolean;
  /** Distance to the nearest highway edge, world m. */
  readonly roadDistance: (x: number, y: number) => number;
}

function pieceOf(kit: KitFile, id: string): KitPiece {
  const piece = kit.pieces.find((p) => p.id === id);
  if (!piece) throw new Error(`kit: unknown piece "${id}"`);
  return piece;
}

/** The rectangle about a piece's middle that holds its solids, wires and ground decoration, real m. */
export function planM(piece: KitPiece): { readonly width: number; readonly depth: number } {
  let x = 0;
  let y = 0;
  const reach = (cx: number, cy: number, halfW: number, halfD: number): void => {
    x = Math.max(x, Math.abs(cx) + halfW);
    y = Math.max(y, Math.abs(cy) + halfD);
  };
  for (const s of piece.solids) reach(s.x, s.y, s.w / 2, s.d / 2);
  for (const w of piece.wires ?? []) for (let i = 0; i < w.points.length; i += 3) reach(w.points[i] as number, w.points[i + 1] as number, 0, 0);
  for (const d of piece.decor) {
    if (d.kind === 'rect') reach(d.x, d.y, d.w / 2, d.d / 2);
    else if (d.kind === 'line') for (let i = 0; i < d.points.length; i += 2) reach(d.points[i] as number, d.points[i + 1] as number, d.width / 2, d.width / 2);
    else {
      const r = d.radius + (d.kind === 'ring' ? d.width / 2 : 0);
      reach(d.x, d.y, r, r);
    }
  }
  return { width: 2 * x, depth: 2 * y };
}

/**
 * Stands the pieces of the town's type in it, in layout order, turned with its streets. The first of the signature
 * piece is the enlarged one. A piece goes to its spot, or to the nearest clear one: inside the outline, on dry ground,
 * off highways and apart from the pieces before it. One that fits nowhere inside stands just outside, on dry land.
 */
export function placeKit(town: Town, kit: KitFile, footprintScale: number, ground: TownGround): PlacedPiece[] {
  const spots = kit.layouts[town.type]?.[town.size];
  if (!spots) throw new Error(`town ${town.id}: no layout for a ${town.type} town of size ${town.size}`);
  const radius = TOWN_RADIUS_M[town.size];
  const signature = spots.findIndex((s) => s.piece === town.signature.piece);
  if (signature < 0) throw new Error(`town ${town.id}: no "${town.signature.piece}" among the ${town.type} ${town.size} pieces`);
  const a = (town.streetDeg * Math.PI) / 180;
  const out: PlacedPiece[] = [];
  for (const [n, spot] of spots.entries()) {
    const enlarge = n === signature ? town.signature.enlarge : kit.enlarge;
    const plan = planM(pieceOf(kit, spot.piece));
    const k = footprintScale / enlarge;
    const base = {
      id: `${town.id}-${spot.piece}-${n}`,
      piece: spot.piece,
      turn: town.streetDeg + spot.turn,
      enlarge,
      width: plan.width / k,
      depth: plan.depth / k,
    };
    const home = { x: ground.center.x + spot.x * Math.cos(a) + spot.y * Math.sin(a), y: ground.center.y - spot.x * Math.sin(a) + spot.y * Math.cos(a) };
    const clear = (p: PlacedPiece, outside: boolean): boolean =>
      (!outside || Math.hypot(p.x - ground.center.x, p.y - ground.center.y) <= radius * OUTSIDE_REACH) &&
      footprintPoints(pieceShape(p)).every(([x, y]) => (outside ? ground.dry(x, y) : inRing(x, y, ground.ring) && ground.open(x, y)) && ground.roadDistance(x, y) >= PIECE_GAP_M) &&
      !out.some((o) => footprintsOverlap(pieceShape(p, PIECE_GAP_M / 2), pieceShape(o, PIECE_GAP_M / 2)));
    /** The nearest clear place to the spot, in rings round it. */
    const search = (outside: boolean): PlacedPiece | undefined => {
      for (let ring = 0; ring <= (radius * (outside ? OUTSIDE_REACH * 2 : 1)) / SEARCH_STEP_M; ring++) {
        for (let way = 0; way < (ring === 0 ? 1 : SEARCH_WAYS); way++) {
          const b = (way / SEARCH_WAYS) * Math.PI * 2;
          const p = { ...base, x: home.x + Math.cos(b) * ring * SEARCH_STEP_M, y: home.y + Math.sin(b) * ring * SEARCH_STEP_M };
          if (clear(p, outside)) return p;
        }
      }
      return undefined;
    };
    const found = search(false) ?? search(true);
    if (!found) throw new Error(`town ${town.id}: no room for ${spot.piece}`);
    out.push(found);
  }
  return out;
}

/** The placed pieces as landmarks, so both views draw them and they are hit like any other (E6). */
export function kitLandmarks(placed: readonly PlacedPiece[], kit: KitFile, footprintScale: number, heightScale: number): MapLandmark[] {
  return placed.flatMap((p) => {
    // The position is already in world m: the spec's city and latitude and longitude are not used.
    const spec = { ...pieceOf(kit, p.piece), id: p.id, cityId: '', lat: 0, lon: 0, turn: p.turn, enlarge: p.enlarge };
    return buildLandmarks({ footprintScale, landmarks: [spec] }, () => p, heightScale);
  });
}

/** Ground the houses leave to the pieces: each one's clear radius, and its plan with a gap round it. */
export function kitClear(placed: readonly PlacedPiece[], kit: KitFile, footprintScale: number): (x: number, y: number) => boolean {
  const areas = placed.map((p) => ({ p, radius: (pieceOf(kit, p.piece).clearRadiusM * p.enlarge) / footprintScale, ring: corners(p) }));
  return (x, y) => areas.some((a) => Math.hypot(x - a.p.x, y - a.p.y) < a.radius || inRing(x, y, a.ring));
}

function corners(p: PlacedPiece): [number, number][] {
  const s = pieceShape(p, PIECE_GAP_M);
  const a = (s.angle * Math.PI) / 180;
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([i, j]) => {
    const u = (i * s.width) / 2;
    const v = (j * s.depth) / 2;
    return [s.x + Math.sin(a) * u + Math.cos(a) * v, s.y + Math.cos(a) * u - Math.sin(a) * v];
  });
}
