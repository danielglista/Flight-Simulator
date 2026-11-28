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
  /** All parallel, along the heading. The first is the one starts and the route readout use. */
  readonly runways: readonly RunwayLayout[];
  /** Taxiway and apron lane center lines. */
  readonly taxiways: readonly (readonly ST[])[];
  /** Apron outlines. */
  readonly aprons: readonly (readonly ST[])[];
  /** Gate names and their lead-in lines, from the lane to where the plane stops. */
  readonly gates: readonly (readonly [string, readonly ST[]])[];
  /** Real m, where it is narrower than TAXI_WIDTH. */
  readonly taxiWidth?: number;
}

/** One runway in the airport's runway frame. */
interface RunwayLayout {
  /** The two thresholds along the frame, the first name's first. */
  readonly s0: number;
  readonly s1: number;
  readonly t: number;
  readonly width: number;
  readonly names: readonly [string, string];
  /** Where approaches aim, real m past either threshold; absent for the usual figure. */
  readonly aim?: number;
}

/** Real meters (§11.2). */
const TAXI_WIDTH = 36;
/** Hold-short bar: this far from the runway's center line, real meters. It is as long as the taxiway is wide. */
const HOLD_SHORT_M = 45;

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
      // Parallel, and into both runway ends: at 19 from 22 m short of it, so no pavement passes the end.
      [[-1092, 0], [-1092, -50], [-1052, -90], [1030, -90], [1070, -50], [1070, 0]],
      // Angled exits.
      [[-640, 0], [-550, -90]],
      [[-280, 0], [-370, -90]],
      [[250, 0], [340, -90]],
      [[610, 0], [520, -90]],
      [[760, 0], [850, -90]],
      // Terminal 2's three lanes, from the terminal out.
      ...splay([192, -337], [223, -140], -90),
      ...splay([439, -376], [476, -140], -90),
      ...splay([685, -415], [729, -140], -90),
      // Hangars and Terminal 1.
      ...splay([-300, -190], [-300, -140], -90),
      ...splay([-90, -258], [-90, -140], -90),
      // Round Terminal 1's concourse.
      [
        [-59, -264], [-76, -259], [-93, -258], [-111, -260], [-127, -266], [-143, -275], [-156, -286], [-167, -300],
        [-175, -316], [-180, -332], [-182, -350], [-180, -368], [-175, -384], [-167, -400], [-156, -414], [-143, -425],
        [-127, -434], [-111, -440], [-93, -442], [-76, -441], [-59, -436],
      ],
    ],
    aprons: [
      [[153, -358], [716, -447], [761, -165], [183, -165]],
      [[-215, -455], [10, -455], [10, -172], [-215, -172]],
      [[-375, -210], [-222, -210], [-222, -165], [-375, -165]],
    ],
    gates: [
      ['A1', [[-90, -258], [-90, -294]]],
      ['A2', [[-155, -285], [-130, -310]]],
      ['A3', [[-182, -350], [-146, -350]]],
      ['A4', [[-155, -415], [-130, -390]]],
      ['A5', [[-90, -442], [-90, -406]]],
      ['B1', [[200, -282], [221, -311], [282, -321]]],
      ['B2', [[210, -220], [231, -249], [292, -258]]],
      ['B3', [[220, -158], [241, -186], [302, -196]]],
      ['B4', [[447, -321], [419, -342], [348, -331]]],
      ['B5', [[457, -259], [428, -280], [357, -269]]],
      ['B6', [[467, -197], [438, -218], [367, -206]]],
      ['C1', [[447, -321], [468, -350], [539, -361]]],
      ['C2', [[457, -259], [478, -288], [549, -299]]],
      ['C3', [[467, -197], [488, -226], [559, -237]]],
      ['C4', [[694, -360], [666, -381], [604, -372]]],
      ['C5', [[704, -298], [675, -319], [614, -309]]],
      ['C6', [[714, -236], [685, -257], [624, -247]]],
    ],
  },
  PHL: {
    name: 'Philadelphia International',
    variationDeg: 12,
    middle: { x: 0, y: -250 },
    headingDeg: 80,
    runways: [
      { s0: -1436, s1: 1460, t: 0, width: 60, names: ['09R', '27L'] },
      { s0: -826, s1: 1460, t: -220, width: 46, names: ['09L', '27R'] },
    ],
    taxiways: [
      // Between the runways and along the terminal, each into both ends of its runway.
      [[-1436, 0], [-1436, -60], [-1386, -110], [1410, -110], [1460, -60], [1460, 0]],
      [[-826, -220], [-826, -270], [-786, -310], [1420, -310], [1460, -270], [1460, -220]],
      // Exits from 9R/27L, then from 9L/27R.
      [[-760, 0], [-650, -110]],
      [[-250, 0], [-360, -110]],
      [[450, 0], [560, -110]],
      [[950, 0], [840, -110]],
      [[-318, -220], [-228, -310]],
      [[532, -220], [442, -310]],
      [[1000, -220], [910, -310]],
      // Crossings between the runways.
      [[-100, -110], [10, -220], [100, -310]],
      [[1340, -110], [1230, -220], [1140, -310]],
      // Hangar link.
      [[-465, -370], [-465, -310]],
      // UPS.
      [[-350, 0], [-300, 50], [-300, 75]],
      [[420, 0], [370, 50], [370, 75]],
      [[-560, 75], [540, 75]],
      // Apron lanes between the piers.
      ...[170, 430, 690, 950, 1210].flatMap((s) => splay([s, -650], [s, -350], -310)),
    ],
    aprons: [
      [[130, -690], [1250, -690], [1250, -380], [130, -380]],
      [[-695, -480], [-235, -480], [-235, -340], [-695, -340]],
      [[-620, 35], [580, 35], [580, 195], [-620, 195]],
    ],
    gates: [
      // Pier A is angled.
      ['A1', [[236, -640], [280, -630]]],
      ['A2', [[222, -576], [266, -566]]],
      ['A3', [[207, -513], [251, -503]]],
      ['A4', [[392, -604], [348, -614]]],
      ['A5', [[378, -541], [334, -551]]],
      ['A6', [[363, -477], [319, -487]]],
      ...row('B', 1, 480, 525, [-620, -555, -490]),
      ...row('B', 4, 640, 595, [-620, -555, -490]),
      ...row('C', 1, 740, 785, [-620, -555, -490]),
      ...row('C', 4, 900, 855, [-620, -555, -490]),
      ...row('D', 1, 1000, 1045, [-620, -555]),
      ...row('D', 3, 1160, 1115, [-620, -555]),
    ],
  },
  // The small airport (E6B): one runway, a parallel taxiway on the side away from the town, one apron, no gates.
  SBY: {
    name: 'Salisbury Regional',
    variationDeg: 11,
    middle: { x: 0, y: 0 },
    headingDeg: 39,
    // Short, so approaches aim closer in than usual: the usual point leaves too little to stop in.
    runways: [{ s0: -762, s1: 762, t: 0, width: 30, names: ['05', '23'], aim: 120 }],
    taxiways: [
      [[-762, 0], [-762, 50], [-722, 90], [722, 90], [762, 50], [762, 0]],
      // Exits.
      [[-350, 0], [-260, 90]],
      [[0, 0], [0, 90]],
      [[350, 0], [260, 90]],
    ],
    aprons: [[[-220, 95], [220, 95], [220, 195], [-220, 195]]],
    gates: [],
    taxiWidth: 18,
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
        const h = (l.taxiWidth ?? TAXI_WIDTH) / 2 / Math.hypot(off[0] - on[0], off[1] - on[1]);
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
    runways: l.runways.map((r) => ({ a: at(r.s0, r.t), b: at(r.s1, r.t), width: r.width * RUNWAY_WIDTH_MULT, names: r.names, ...(r.aim === undefined ? {} : { aimM: r.aim }) })),
    taxiways: l.taxiways.map((line) => ({ points: line.map(atST), width: l.taxiWidth ?? TAXI_WIDTH })),
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
