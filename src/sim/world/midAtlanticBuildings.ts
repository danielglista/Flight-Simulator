/**
 * What stands on the Mid-Atlantic airports (E7.9; E7_PLAN §11.3, §11.4, read off the accepted drawings). Positions are
 * in each airport's runway frame as in `midAtlantic.ts`: `s` along the heading, `t` to the right of it. All real
 * meters, heights above the field. All numbers provisional.
 */
export type ST = readonly [number, number];

interface Look {
  readonly bottom: number;
  readonly top: number;
  readonly material: string;
  readonly cap?: string;
  readonly columns?: number;
}

export type BuildingPiece = Look & ({ readonly plan: readonly ST[] } | { readonly round: ST; readonly diameter: number });

export interface PaintPiece {
  readonly material: string;
  readonly plan: readonly ST[];
  /** Shown only close in. */
  readonly detail?: boolean;
}

export interface AirportBuildings {
  readonly solids: readonly BuildingPiece[];
  /** Flat paint: parked aircraft, and cars and trucks. */
  readonly paint: readonly PaintPiece[];
  /** Paved ground that is not apron: parking lots and truck yards. */
  readonly pavement: readonly (readonly ST[])[];
}

const rect = (s0: number, s1: number, t0: number, t1: number): ST[] => [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];

const block = (plan: readonly ST[], top: number, wall: string, roof: string, columns?: number): BuildingPiece => ({
  plan,
  bottom: 0,
  top,
  material: wall,
  cap: roof,
  ...(columns ? { columns } : {}),
});

const terminal = (plan: readonly ST[], top = 15): BuildingPiece => block(plan, top, 'terminal-wall', 'terminal-roof', 8);
const garage = (plan: readonly ST[]): BuildingPiece => block(plan, 12, 'garage-wall', 'garage-roof', 10);

/** A hangar with a darker strip along the ridge of its roof, which runs across `s` or across `t`. */
const hangar = (s0: number, s1: number, t0: number, t1: number): BuildingPiece[] => {
  const s = (s0 + s1) / 2;
  return [block(rect(s0, s1, t0, t1), 20, 'hangar-wall', 'hangar-roof'), { plan: rect(s - 3, s + 3, t0, t1), bottom: 20, top: 21, material: 'hangar-ridge' }];
};

/** A control tower 45 m high on a low base `side` m square. */
const tower = (s: number, t: number, side: number): BuildingPiece[] => [
  block(rect(s - side / 2, s + side / 2, t - side / 2, t + side / 2), 8, 'tower-wall', 'garage-roof'),
  { round: [s, t], diameter: 14, bottom: 8, top: 37, material: 'tower-wall' },
  { round: [s, t], diameter: 26, bottom: 37, top: 43, material: 'tower-glass', columns: 4 },
  { round: [s, t], diameter: 22, bottom: 43, top: 45, material: 'tower-roof' },
];

const CAR_COLORS = ['car-white', 'car-dark', 'car-silver', 'car-blue', 'car-white', 'car-red', 'car-silver', 'car-dark'];

/** Cars 2 by 4.5 m nose to nose in double rows along `s`, with a few spaces left empty. */
const cars = (s0: number, s1: number, t0: number, t1: number): PaintPiece[] => {
  const out: PaintPiece[] = [];
  let n = 0;
  for (let t = t0 + 4; t + 10 <= t1; t += 17) {
    for (let s = s0 + 4; s + 2 <= s1 - 4; s += 3.2) {
      for (const near of [t, t + 5.2]) {
        n++;
        if ((n * 7) % 11 === 0) continue;
        out.push({ material: CAR_COLORS[(n * 5) % CAR_COLORS.length] as string, plan: rect(s, s + 2, near, near + 4.5), detail: true });
      }
    }
  }
  return out;
};

/** A parked freighter, nose toward lower `t`: the outline from the drawing, with its tail painted. */
const freighter = (s: number): PaintPiece[] => {
  const half: ST[] = [[4, 188], [4, 198], [20, 204], [20, 208], [4, 206], [3, 212], [9, 218]];
  const plan: ST[] = [[s, 180], ...half.map(([a, t]): ST => [s + a, t]), ...[...half].reverse().map(([a, t]): ST => [s - a, t])];
  return [
    { material: 'freighter', plan },
    { material: 'ups-brown', plan: rect(s - 1.5, s + 1.5, 204, 218) },
  ];
};

/** Where trailers stand in the UPS truck yard, by their lower `s`. */
const TRAILERS = [
  -605, -589, -573, -557, -525, -509, -493, -477, -461, -445, -413, -397, -381, -349, -333, -317, -285, -269, -253, -237,
  -221, -189, -173, -157, -125, -109, -77, -61, -45, -13, 19, 83, 99,
];

const PARKING_DCA = rect(-375, -205, -648, -545);
const TRUCK_YARD = rect(-620, 150, 335, 375);

export const MID_ATLANTIC_BUILDINGS: Readonly<Record<string, AirportBuildings>> = {
  DCA: {
    solids: [
      // Terminal 2, skewed 9 degrees, and its two piers.
      terminal([[149, -504], [702, -591], [711, -536], [158, -449]]),
      terminal([[286, -470], [326, -476], [358, -271], [319, -264]], 12),
      terminal([[543, -511], [582, -517], [615, -311], [575, -305]], 12),
      // Terminal 1: the hall, its link to Terminal 2, and the passage to the round concourse.
      terminal(rect(5, 105, -505, -405)),
      terminal([[90, -500], [165, -492], [160, -462], [90, -462]], 12),
      terminal(rect(-60, 8, -454, -426), 10),
      { round: [-90, -440], diameter: 68, bottom: 0, top: 15, material: 'terminal-wall', columns: 8 },
      // Garages behind Terminal 2.
      garage([[184, -568], [397, -602], [404, -554], [192, -521]]),
      garage([[436, -608], [649, -642], [656, -594], [444, -561]]),
      ...hangar(-378, -308, -390, -300),
      ...hangar(-292, -222, -390, -300),
      ...tower(850, -450, 36),
    ],
    paint: cars(-375, -205, -648, -545),
    pavement: [PARKING_DCA],
  },
  PHL: {
    solids: [
      terminal(rect(140, 1240, -1060, -990)),
      // Piers A (angled) to D, which ends in a T.
      terminal([[309, -995], [249, -735], [291, -725], [351, -985]], 12),
      terminal(rect(538, 582, -990, -740), 12),
      terminal(rect(798, 842, -990, -740), 12),
      terminal(rect(1058, 1102, -990, -780), 12),
      terminal(rect(990, 1170, -780, -740), 12),
      garage(rect(160, 480, -1170, -1085)),
      garage(rect(530, 850, -1170, -1085)),
      garage(rect(900, 1220, -1170, -1085)),
      ...hangar(-1450, -1320, -640, -545),
      ...hangar(-1290, -1160, -640, -545),
      ...hangar(-1130, -1000, -640, -545),
      ...tower(1460, -762, 56),
      // UPS: the sorting hall, a gold band along its roof, and four docks.
      block(rect(-600, 130, 175, 295), 15, 'ups-wall', 'ups-roof', 12),
      { plan: rect(-600, 130, 225, 248), bottom: 15, top: 15.6, material: 'ups-gold' },
      ...[-540, -350, -160, 30].map((s) => block(rect(s, s + 80, 295, 330), 8, 'ups-wall', 'ups-roof')),
    ],
    paint: [
      ...[220, 320, 420, 520].flatMap(freighter),
      ...TRAILERS.map((s): PaintPiece => ({ material: 'car-white', plan: rect(s, s + 8, 340, 370), detail: true })),
    ],
    pavement: [TRUCK_YARD],
  },
};
