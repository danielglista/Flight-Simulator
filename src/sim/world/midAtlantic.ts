import { buildAirport, type Airport, type AirportDef, type PavingDef, type Vec2 } from './airport';
import type { MapAirport } from './mapFile';
import { withAirports } from './placeAirports';
import { Terrain } from './terrain';
import type { GameMap } from './mapFile';
import type { WorldGrid } from './grid';

/**
 * The first layouts of the Mid-Atlantic airports (E3): the main runway, one taxiway and one apron each, with the rest
 * of the field left as grass for later gates and taxiways. Where each airport sits and which ground is level and dry
 * come from the map file; here everything is in the runway's own frame: `s` along its heading from its middle, `t` to
 * the right of it, real meters. All numbers provisional.
 */
interface Layout {
  readonly name: string;
  /** Degrees west: a runway name is the true heading plus this. */
  readonly variationDeg: number;
  /** Runway middle, local real meters from the airport center. */
  readonly middle: Vec2;
  /** True, degrees clockwise from north. */
  readonly headingDeg: number;
  readonly length: number;
  readonly width: number;
  readonly names: readonly [string, string];
  /** Taxiway centerline pieces, [s, t] pairs. */
  readonly taxiways: readonly (readonly [readonly [number, number], readonly [number, number]])[];
  /** Apron as a strip along the runway direction. */
  readonly apron: { readonly s0: number; readonly s1: number; readonly t: number; readonly width: number };
}

const TAXI_WIDTH = 24;

export const MID_ATLANTIC_LAYOUTS: Readonly<Record<string, Layout>> = {
  DCA: {
    name: 'Reagan National',
    variationDeg: 11,
    middle: { x: 350, y: -240 },
    headingDeg: 2,
    length: 2185,
    width: 46,
    names: ['01', '19'],
    taxiways: [
      [[-300, -180], [950, -180]],
      [[-300, -180], [-300, 0]],
      [[950, -180], [950, 0]],
      [[250, -400], [250, -180]],
    ],
    apron: { s0: 20, s1: 700, t: -480, width: 240 },
  },
  PHL: {
    name: 'Philadelphia International',
    variationDeg: 12,
    middle: { x: 0, y: -250 },
    headingDeg: 80,
    length: 3200,
    width: 60,
    names: ['09R', '27L'],
    taxiways: [
      [[-700, -190], [1250, -190]],
      [[-700, -190], [-700, 0]],
      [[1250, -190], [1250, 0]],
      [[300, -420], [300, -190]],
    ],
    apron: { s0: -200, s1: 1000, t: -500, width: 280 },
  },
};

/** The definition of one airport on this map. Throws for an airport with no layout. */
export function midAtlanticDef(placed: MapAirport): AirportDef {
  const l = MID_ATLANTIC_LAYOUTS[placed.id];
  if (!l) throw new Error(`No layout for airport ${placed.id}`);
  const h = (l.headingDeg * Math.PI) / 180;
  const u = { x: Math.sin(h), y: Math.cos(h) };
  const at = (s: number, t: number): Vec2 => ({ x: l.middle.x + u.x * s + u.y * t, y: l.middle.y + u.y * s - u.x * t });

  const paving: PavingDef[] = l.taxiways.map(([a, b]) => ({ kind: 'strip', code: Terrain.taxiway, a: at(...a), b: at(...b), width: TAXI_WIDTH }));
  // A strip reaches half its width past each end.
  paving.push({ kind: 'strip', code: Terrain.airport, a: at(l.apron.s0 + l.apron.width / 2, l.apron.t), b: at(l.apron.s1 - l.apron.width / 2, l.apron.t), width: l.apron.width });

  // The boundary encloses the ground, snapped outward to whole fine cells from the anchor.
  const cell = 2;
  const snap = cell * placed.scale;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of placed.ground) {
    const gh = (g.headingDeg * Math.PI) / 180;
    const ex = (Math.abs(Math.sin(gh)) * g.length + Math.abs(Math.cos(gh)) * g.width) / 2;
    const ey = (Math.abs(Math.cos(gh)) * g.length + Math.abs(Math.sin(gh)) * g.width) / 2;
    minX = Math.min(minX, g.x - ex);
    maxX = Math.max(maxX, g.x + ex);
    minY = Math.min(minY, g.y - ey);
    maxY = Math.max(maxY, g.y + ey);
  }

  return {
    ident: placed.id,
    name: l.name,
    anchor: { x: placed.x, y: placed.y },
    scale: placed.scale,
    variationDeg: l.variationDeg,
    ground: placed.ground,
    boundary: {
      minX: Math.floor(minX / snap) * snap,
      minY: Math.floor(minY / snap) * snap,
      maxX: Math.ceil(maxX / snap) * snap,
      maxY: Math.ceil(maxY / snap) * snap,
    },
    blend: 0,
    fieldElevationM: placed.elevationM,
    cellSize: cell,
    runways: [{ a: at(-l.length / 2, 0), b: at(l.length / 2, 0), width: l.width, names: l.names }],
    paving,
  };
}

/** The map with its airports laid on it. Throws, naming the airport, if one does not fit the ground the map made. */
export function midAtlanticGrid(map: GameMap): WorldGrid {
  const airports: Airport[] = map.airports.map((a) => buildAirport(midAtlanticDef(a)));
  return withAirports(map.grid, airports);
}
