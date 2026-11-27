import { createGrid, type GridPatch, type WorldGrid } from './grid';
import type { Polygon } from './polygon';

/** An airport as the generator placed it: where it is and which ground it leveled. */
export interface MapAirport {
  readonly id: string;
  /** Center, world meters. */
  readonly x: number;
  readonly y: number;
  /** Field height, real meters. */
  readonly elevationM: number;
  /** Real meters per world meter of `ground`. */
  readonly scale: number;
  /** Leveled, dry polygons, local real meters from the center. */
  readonly ground: readonly Polygon[];
}

/** One piece of highway: all over land, or all a bridge. */
export interface MapRoad {
  readonly kind: 'major' | 'minor';
  readonly bridge: boolean;
  /** x, y, x, y ... world meters. */
  readonly points: readonly number[];
}

/** One building: a rectangle standing on the ground at its center. */
export interface MapBuilding {
  /** Center, world m. */
  readonly x: number;
  readonly y: number;
  /** Along the street heading, and across it, world m. */
  readonly width: number;
  readonly depth: number;
  /** Degrees clockwise from north. */
  readonly angle: number;
  /** Roof above the ground, world m. */
  readonly height: number;
  /** Index of its district type (0 downtown, 1 residential, 2 suburb, 3 industrial). */
  readonly style: number;
}

/**
 * One piece of a landmark (E6): a rectangle, north-aligned or turned, that may narrow toward its top, so a shaft, a pyramid or a
 * hipped roof is one solid; or a circle, standing straight or tapered (`drum`) or rounded over (`dome`), where `width`
 * and `depth` are its diameter; or a flat-topped `prism` on any convex outline, for walls that do not run north to south. World m; `bottom` and `top` are above the ground at the landmark's center.
 */
export interface LandmarkSolid {
  readonly x: number;
  readonly y: number;
  /** East to west, and north to south, at the bottom and at the top. */
  readonly width: number;
  readonly depth: number;
  readonly topWidth: number;
  readonly topDepth: number;
  readonly bottom: number;
  readonly top: number;
  /** Names a color in config/palette.ts. */
  readonly material: string;
  /** Absent for a rectangle. */
  readonly shape?: 'drum' | 'dome' | 'prism';
  /** A rectangle's turn, degrees clockwise: `width` then runs that far round from east. */
  readonly turn?: number;
  /** Part of the ground itself, such as a hill: drawn under the rest, whose shadows then fall on it. */
  readonly base?: boolean;
  /** A prism's plan: x, y of each corner of a convex outline, counterclockwise. Its x, y, width and depth are then the box round it. */
  readonly points?: readonly number[];
  /** The color of the top from above, where it differs from the walls. */
  readonly cap?: string;
  /** Spacing of the columns or windows drawn up its walls, world m. Absent for a plain wall. */
  readonly columns?: number;
}

/** Flat ground decoration around a landmark: drawn from above only. World m. */
export type LandmarkDecor =
  | { readonly kind: 'rect'; readonly material: string; readonly x: number; readonly y: number; readonly width: number; readonly depth: number; readonly turn?: number }
  | { readonly kind: 'disc'; readonly material: string; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly kind: 'ring'; readonly material: string; readonly x: number; readonly y: number; readonly radius: number; readonly width: number }
  | { readonly kind: 'line'; readonly material: string; readonly width: number; readonly points: readonly number[] };

/** A thin line in the air, such as a cable or a brace: drawn, not solid. World m; z above the landmark's ground. */
export interface LandmarkWire {
  readonly material: string;
  /** x, y, z, x, y, z ... */
  readonly points: readonly number[];
}

export interface MapLandmark {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly solids: readonly LandmarkSolid[];
  readonly decor: readonly LandmarkDecor[];
  readonly wires?: readonly LandmarkWire[];
  /** A circle of flag poles: drawn, not solid. */
  readonly posts?: { readonly x: number; readonly y: number; readonly radius: number; readonly count: number; readonly height: number };
}

export interface GameMap {
  readonly grid: WorldGrid;
  readonly altitudeScale: number;
  readonly geoDistance: number;
  readonly airports: readonly MapAirport[];
}

interface LayerMeta {
  readonly cols: number;
  readonly rows: number;
  readonly cellM: number;
  readonly originKm: { readonly x: number; readonly y: number };
}

interface Meta {
  readonly geoDistance: number;
  readonly scales: { readonly altitude: number };
  readonly base: LayerMeta;
  readonly patches: readonly (LayerMeta & { readonly id: string })[];
  readonly airports: readonly MapAirport[];
  /** Absent in files built before E5.2. */
  readonly roads?: readonly MapRoad[];
  /** x, y, width, depth, angle, height, style each. Absent in files built before E5.3. */
  readonly buildings?: readonly (readonly [number, number, number, number, number, number, number])[];
  /** Absent in files built before E6. */
  readonly landmarks?: readonly MapLandmark[];
}

const MAGIC = 'FSMAP2';
const HEAD_BYTES = 10;

/**
 * Reads a file written by `tools/build-map.mjs`: magic, JSON length (u32 LE), JSON meta, then for the base and each
 * patch: elevation (int16 LE), terrain (u8), water (u8). The base grid's southwest corner becomes world (0, 0).
 */
export function parseMap(buffer: ArrayBuffer): GameMap {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC.length));
  if (bytes.length < HEAD_BYTES || magic !== MAGIC) throw new Error('Not a map file (expected FSMAP2)');
  const view = new DataView(buffer);
  const metaLength = view.getUint32(MAGIC.length, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(HEAD_BYTES, HEAD_BYTES + metaLength))) as Meta;
  if (!meta.airports) throw new Error('Map file has no airports; rebuild it with tools/build-map.mjs');

  let at = HEAD_BYTES + metaLength;
  const layer = (m: LayerMeta): WorldGrid => {
    const cells = m.cols * m.rows;
    if (at + cells * 4 > bytes.length) throw new Error('Map file is cut short');
    const grid = createGrid(m.cols, m.rows, m.cellM);
    for (let i = 0; i < cells; i++) grid.elevation[i] = view.getInt16(at + i * 2, true);
    grid.terrain.set(bytes.subarray(at + cells * 2, at + cells * 3));
    grid.water.set(bytes.subarray(at + cells * 3, at + cells * 4));
    at += cells * 4;
    return grid;
  };

  const base = layer(meta.base);
  const patches: GridPatch[] = meta.patches.map((p) => ({
    id: p.id,
    // Patches are snapped to base cell edges; rounding removes the float noise of km differences.
    x: Math.round((p.originKm.x - meta.base.originKm.x) * 1000),
    y: Math.round((p.originKm.y - meta.base.originKm.y) * 1000),
    grid: layer(p),
  }));
  const buildings = (meta.buildings ?? []).map(([x, y, width, depth, angle, height, style]) => ({ x, y, width, depth, angle, height, style }));
  return { grid: { ...base, patches, roads: meta.roads ?? [], buildings, landmarks: meta.landmarks ?? [] }, altitudeScale: meta.scales.altitude, geoDistance: meta.geoDistance, airports: meta.airports };
}
