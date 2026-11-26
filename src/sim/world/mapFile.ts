import type { GroundRect } from './airport';
import { createGrid, type GridPatch, type WorldGrid } from './grid';

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
  /** Leveled, dry rectangles, local real meters from the center. */
  readonly ground: readonly GroundRect[];
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
  return { grid: { ...base, patches }, altitudeScale: meta.scales.altitude, geoDistance: meta.geoDistance, airports: meta.airports };
}
