import { RUNWAY_WIDTH_MULT } from '../../config/map';
import { buildAirport, type Airport, type AirportDef, type Vec2 } from './airport';
import { MID_ATLANTIC_BUILDINGS, type ST } from './midAtlanticBuildings';
import type { MapAirport } from './mapFile';
import { withAirports } from './placeAirports';
import { Terrain } from './terrain';
import type { GameMap } from './mapFile';
import type { WorldGrid } from './grid';

/**
 * The layouts of the Mid-Atlantic airports: runways, taxiways, aprons, gates (E7_PLAN §11) and
 * buildings (E7.9, in `midAtlanticBuildings.ts`).
 * Where each airport sits and which ground is level and dry come from the map file; here everything is in the runway's
 * own frame: `s` along its heading from its middle, `t` to the right of it, real meters. All numbers provisional.
 */
interface Layout {
  readonly name: string;
  /** Degrees west: a runway name is the true heading plus this. */
  readonly variationDeg: number;
  /** Middle of the runway frame (the first runway's middle, E3), local real meters from the airport center. */
  readonly middle: Vec2;
  /** True, degrees clockwise from north. */
  readonly headingDeg: number;
  /** All parallel, along the heading. The first is the one starts and the route line use. */
  readonly runways: readonly RunwayLayout[];
  /** Taxiway and apron lane center lines. */
  readonly taxiways: readonly (readonly ST[])[];
  /** Apron outlines. */
  readonly aprons: readonly (readonly ST[])[];
  /** Gate names and their lead-in lines, from the lane to where the plane stops. */
  readonly gates: readonly (readonly [string, readonly ST[]])[];
}

/** One runway in the airport's runway frame. */
interface RunwayLayout {
  /** The two thresholds along the frame, the first name's first. */
  readonly s0: number;
  readonly s1: number;
  readonly t: number;
  readonly width: number;
  readonly names: readonly [string, string];
}

/** Real meters (§11.2). */
const TAXI_WIDTH = 36;
/** Hold-short bar: this far from the runway's center line, and this long. Real meters. */
const HOLD_SHORT_M = 70;
const HOLD_BAR_M = 36;

/** An apron lane square to the taxiway at `t = to`, splitting 45 degrees both ways into it. */
const splay = (from: ST, bend: ST, to: number): ST[][] => {
  const d = Math.abs(to - bend[1]);
  return [[from, bend, [bend[0] + d, to]], [bend, [bend[0] - d, to]]];
};

/** Straight lead-ins from a lane at `s = lane` to stands at `s = stand`, numbered on from `first`. */
const row = (pier: string, first: number, lane: number, stand: number, ts: readonly number[]): [string, ST[]][] =>
  ts.map((t, i) => [pier + String(first + i), [[lane, t], [stand, t]]]);

export const MID_ATLANTIC_LAYOUTS: Readonly<Record<string, Layout>> = {
  DCA: {
    name: 'Reagan National',
    variationDeg: 11,
    middle: { x: 350, y: -240 },
    headingDeg: 2,
    runways: [{ s0: -1092.5, s1: 1092.5, t: 0, width: 46, names: ['01', '19'] }],
    taxiways: [
      // Parallel, and into both runway ends.
      [[-1092, 0], [-1092, -80], [-992, -180], [992, -180], [1092, -80], [1092, 0]],
      // Angled exits.
      [[-640, 0], [-460, -180]],
      [[-280, 0], [-460, -180]],
      [[250, 0], [430, -180]],
      [[610, 0], [430, -180]],
      [[760, 0], [940, -180]],
      // Terminal 2's three lanes, from the terminal out.
      ...splay([192, -427], [223, -230], -180),
      ...splay([439, -466], [476, -230], -180),
      ...splay([685, -505], [729, -230], -180),
      // Hangars and Terminal 1.
      ...splay([-300, -280], [-300, -230], -180),
      ...splay([-90, -348], [-90, -230], -180),
      // Round Terminal 1's concourse.
      [
        [-59, -354], [-76, -349], [-93, -348], [-111, -350], [-127, -356], [-143, -365], [-156, -376], [-167, -390],
        [-175, -406], [-180, -422], [-182, -440], [-180, -458], [-175, -474], [-167, -490], [-156, -504], [-143, -515],
        [-127, -524], [-111, -530], [-93, -532], [-76, -531], [-59, -526],
      ],
    ],
    aprons: [
      [[153, -448], [716, -537], [761, -255], [183, -255]],
      [[-215, -545], [10, -545], [10, -262], [-215, -262]],
      [[-375, -300], [-222, -300], [-222, -255], [-375, -255]],
    ],
    gates: [
      ['A1', [[-90, -348], [-90, -384]]],
      ['A2', [[-155, -375], [-130, -400]]],
      ['A3', [[-182, -440], [-146, -440]]],
      ['A4', [[-155, -505], [-130, -480]]],
      ['A5', [[-90, -532], [-90, -496]]],
      ['B1', [[200, -372], [221, -401], [282, -411]]],
      ['B2', [[210, -310], [231, -339], [292, -348]]],
      ['B3', [[220, -248], [241, -276], [302, -286]]],
      ['B4', [[447, -411], [419, -432], [348, -421]]],
      ['B5', [[457, -349], [428, -370], [357, -359]]],
      ['B6', [[467, -287], [438, -308], [367, -296]]],
      ['C1', [[447, -411], [468, -440], [539, -451]]],
      ['C2', [[457, -349], [478, -378], [549, -389]]],
      ['C3', [[467, -287], [488, -316], [559, -327]]],
      ['C4', [[694, -450], [666, -471], [604, -462]]],
      ['C5', [[704, -388], [675, -409], [614, -399]]],
      ['C6', [[714, -326], [685, -347], [624, -337]]],
    ],
  },
  PHL: {
    name: 'Philadelphia International',
    variationDeg: 12,
    middle: { x: 0, y: -250 },
    headingDeg: 80,
    runways: [
      { s0: -1829, s1: 1829, t: 0, width: 60, names: ['09R', '27L'] },
      { s0: -899, s1: 1997, t: -430, width: 46, names: ['09L', '27R'] },
    ],
    taxiways: [
      // Between the runways and along the terminal, each into both ends of its runway.
      [[-1829, 0], [-1829, -115], [-1729, -215], [1729, -215], [1829, -115], [1829, 0]],
      [[-899, -430], [-899, -530], [-799, -610], [1897, -610], [1997, -530], [1997, -430]],
      // Exits from 9R/27L, then from 9L/27R.
      [[-1100, 0], [-885, -215]],
      [[-300, 0], [-515, -215]],
      [[600, 0], [815, -215]],
      [[1400, 0], [1185, -215]],
      [[-150, -430], [30, -610]],
      [[700, -430], [520, -610]],
      [[1500, -430], [1320, -610]],
      // Crossings between the runways.
      [[-100, -215], [115, -430], [295, -610]],
      [[1500, -215], [1285, -430], [1105, -610]],
      // Cargo link.
      [[-1215, -420], [-1215, -215]],
      // UPS.
      [[-350, 0], [-280, 70], [-280, 130]],
      [[420, 0], [350, 70], [350, 130]],
      [[-560, 130], [540, 130]],
      // Apron lanes between the piers.
      ...[170, 430, 690, 950, 1210].flatMap((s) => splay([s, -950], [s, -650], -610)),
    ],
    aprons: [
      [[130, -990], [1250, -990], [1250, -680], [130, -680]],
      [[-1440, -520], [-990, -520], [-990, -300], [-1440, -300]],
      [[-620, 90], [580, 90], [580, 250], [-620, 250]],
    ],
    gates: [
      // Pier A is angled.
      ['A1', [[236, -940], [280, -930]]],
      ['A2', [[222, -876], [266, -866]]],
      ['A3', [[207, -813], [251, -803]]],
      ['A4', [[392, -904], [348, -914]]],
      ['A5', [[378, -841], [334, -851]]],
      ['A6', [[363, -777], [319, -787]]],
      ...row('B', 1, 480, 525, [-920, -855, -790]),
      ...row('B', 4, 640, 595, [-920, -855, -790]),
      ...row('C', 1, 740, 785, [-920, -855, -790]),
      ...row('C', 4, 900, 855, [-920, -855, -790]),
      ...row('D', 1, 1000, 1045, [-920, -855]),
      ...row('D', 3, 1160, 1115, [-920, -855]),
    ],
  },
};

/** A bar across every piece of taxiway that starts or ends on a runway's center line, short of it. */
function holdShortBars(l: Layout): [ST, ST][] {
  const out: [ST, ST][] = [];
  for (const line of l.taxiways) {
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1] as ST;
      const q = line[i] as ST;
      for (const [on, off] of [[p, q], [q, p]] as const) {
        const rw = l.runways.find((r) => on[1] === r.t && on[0] >= r.s0 - 1 && on[0] <= r.s1 + 1);
        const across = Math.abs(off[1] - on[1]);
        if (!rw || across < HOLD_SHORT_M) continue;
        const k = HOLD_SHORT_M / across;
        const c: ST = [on[0] + (off[0] - on[0]) * k, on[1] + (off[1] - on[1]) * k];
        const h = HOLD_BAR_M / 2 / Math.hypot(off[0] - on[0], off[1] - on[1]);
        const n: ST = [-(off[1] - on[1]) * h, (off[0] - on[0]) * h];
        out.push([[c[0] + n[0], c[1] + n[1]], [c[0] - n[0], c[1] - n[1]]]);
      }
    }
  }
  return out;
}

/** The definition of one airport on this map. Throws for an airport with no layout. */
export function midAtlanticDef(placed: MapAirport, buildingHeightScale: number): AirportDef {
  const l = MID_ATLANTIC_LAYOUTS[placed.id];
  if (!l) throw new Error(`No layout for airport ${placed.id}`);
  const h = (l.headingDeg * Math.PI) / 180;
  const u = { x: Math.sin(h), y: Math.cos(h) };
  const at = (s: number, t: number): Vec2 => ({ x: l.middle.x + u.x * s + u.y * t, y: l.middle.y + u.y * s - u.x * t });

  const atST = ([s, t]: ST): Vec2 => at(s, t);

  const built = MID_ATLANTIC_BUILDINGS[placed.id];

  // The boundary encloses the ground, snapped outward to whole fine cells from the anchor.
  const cell = 2;
  const snap = cell * placed.scale;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of placed.ground.flat()) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y);
    maxY = Math.max(maxY, q.y);
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
    runways: l.runways.map((r) => ({ a: at(r.s0, r.t), b: at(r.s1, r.t), width: r.width * RUNWAY_WIDTH_MULT, names: r.names })),
    taxiways: l.taxiways.map((line) => ({ points: line.map(atST), width: TAXI_WIDTH })),
    paving: [...l.aprons, ...(built?.pavement ?? [])].map((a) => ({ kind: 'polygon', code: Terrain.airport, points: a.map(atST) })),
    structures: (built?.solids ?? []).map((s) => ('plan' in s ? { ...s, points: s.plan.map(atST) } : { ...s, center: atST(s.round) })),
    groundPaint: (built?.paint ?? []).map((p) => ({ ...p, points: p.plan.map(atST) })),
    buildingHeightScale,
    holdShort: holdShortBars(l).map(([a, b]) => [atST(a), atST(b)] as const),
    gates: l.gates.map(([name, leadIn]) => ({ name, leadIn: leadIn.map(atST) })),
  };
}

/** The map with its airports laid on it. Throws, naming the airport, if one does not fit the ground the map made. */
export function midAtlanticGrid(map: GameMap): WorldGrid {
  const airports: Airport[] = map.airports.map((a) => buildAirport(midAtlanticDef(a, map.buildingHeightScale)));
  return withAirports(map.grid, airports);
}
