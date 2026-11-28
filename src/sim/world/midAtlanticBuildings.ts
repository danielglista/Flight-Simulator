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
const hangar = (s0: number, s1: number, t0: number, t1: number, top = 20): BuildingPiece[] => {
  const s = (s0 + s1) / 2;
  return [block(rect(s0, s1, t0, t1), top, 'hangar-wall', 'hangar-roof'), { plan: rect(s - 3, s + 3, t0, t1), bottom: top, top: top + 1, material: 'hangar-ridge' }];
};

/** A control tower 45 m high on a low base `side` m square. */
const tower = (s: number, t: number, side: number): BuildingPiece[] => [
  block(rect(s - side / 2, s + side / 2, t - side / 2, t + side / 2), 8, 'tower-wall', 'garage-roof'),
  { round: [s, t], diameter: 14, bottom: 8, top: 37, material: 'tower-wall' },
  { round: [s, t], diameter: 26, bottom: 37, top: 43, material: 'tower-glass', columns: 4 },
  { round: [s, t], diameter: 22, bottom: 43, top: 45, material: 'tower-roof' },
];

/** The short tower of a small airport, 22 m high. */
const smallTower = (s: number, t: number): BuildingPiece[] => [
  block(rect(s - 6, s + 6, t - 6, t + 6), 5, 'tower-wall', 'garage-roof'),
  { round: [s, t], diameter: 7, bottom: 5, top: 16, material: 'tower-wall' },
  { round: [s, t], diameter: 13, bottom: 16, top: 20, material: 'tower-glass', columns: 3 },
  { round: [s, t], diameter: 11, bottom: 20, top: 22, material: 'tower-roof' },
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
  const half: ST[] = [[4, 133], [4, 143], [20, 149], [20, 153], [4, 151], [3, 157], [9, 163]];
  const plan: ST[] = [[s, 125], ...half.map(([a, t]): ST => [s + a, t]), ...[...half].reverse().map(([a, t]): ST => [s - a, t])];
  return [
    { material: 'freighter', plan },
    { material: 'ups-brown', plan: rect(s - 1.5, s + 1.5, 149, 163) },
  ];
};

/** Where trailers stand in the UPS truck yard, by their lower `s`. */
const TRAILERS = [
  -605, -589, -573, -557, -525, -509, -493, -477, -461, -445, -413, -397, -381, -349, -333, -317, -285, -269, -253, -237,
  -221, -189, -173, -157, -125, -109, -77, -61, -45, -13, 19, 83, 99,
];

const PARKING_DCA = rect(-375, -205, -558, -455);
const TRUCK_YARD = rect(-620, 150, 280, 320);

export const MID_ATLANTIC_BUILDINGS: Readonly<Record<string, AirportBuildings>> = {
  DCA: {
    solids: [
      // Terminal 2, skewed 9 degrees, and its two piers.
      terminal([[149, -414], [702, -501], [711, -446], [158, -359]]),
      terminal([[286, -380], [326, -386], [358, -181], [319, -174]], 12),
      terminal([[543, -421], [582, -427], [615, -221], [575, -215]], 12),
      // Terminal 1: the hall, its link to Terminal 2, and the passage to the round concourse.
      terminal(rect(5, 105, -415, -315)),
      terminal([[90, -410], [165, -402], [160, -372], [90, -372]], 12),
      terminal(rect(-60, 8, -364, -336), 10),
      { round: [-90, -350], diameter: 68, bottom: 0, top: 15, material: 'terminal-wall', columns: 8 },
      // Garages behind Terminal 2.
      garage([[184, -478], [397, -512], [404, -464], [192, -431]]),
      garage([[436, -518], [649, -552], [656, -504], [444, -471]]),
      ...hangar(-378, -308, -300, -210),
      ...hangar(-292, -222, -300, -210),
      ...tower(850, -360, 36),
    ],
    paint: cars(-375, -205, -558, -455),
    pavement: [PARKING_DCA],
  },
  PHL: {
    solids: [
      terminal(rect(140, 1240, -760, -690)),
      // Piers A (angled) to D, which ends in a T.
      terminal([[309, -695], [249, -435], [291, -425], [351, -685]], 12),
      terminal(rect(538, 582, -690, -440), 12),
      terminal(rect(798, 842, -690, -440), 12),
      terminal(rect(1058, 1102, -690, -480), 12),
      terminal(rect(990, 1170, -480, -440), 12),
      garage(rect(160, 480, -870, -785)),
      garage(rect(530, 850, -870, -785)),
      garage(rect(900, 1220, -870, -785)),
      ...hangar(-700, -570, -575, -480),
      ...hangar(-540, -410, -575, -480),
      ...hangar(-380, -250, -575, -480),
      ...tower(1320, -480, 56),
      // UPS: the sorting hall, a gold band along its roof, and four docks.
      block(rect(-600, 130, 120, 240), 15, 'ups-wall', 'ups-roof', 12),
      { plan: rect(-600, 130, 170, 193), bottom: 15, top: 15.6, material: 'ups-gold' },
      ...[-540, -350, -160, 30].map((s) => block(rect(s, s + 80, 240, 275), 8, 'ups-wall', 'ups-roof')),
    ],
    paint: [
      ...[220, 320, 420, 520].flatMap(freighter),
      ...TRAILERS.map((s): PaintPiece => ({ material: 'car-white', plan: rect(s, s + 8, 285, 315), detail: true })),
    ],
    pavement: [TRUCK_YARD],
  },
  // Salisbury (E6B.4): a small terminal, four hangars along the back of the apron, a short tower and a parking lot.
  SBY: {
    solids: [
      terminal(rect(-45, 45, 196, 218), 8),
      block(rect(-12, 12, 188, 196), 5, 'terminal-wall', 'terminal-roof', 4),
      ...hangar(-215, -170, 196, 232, 10),
      ...hangar(-155, -110, 196, 232, 10),
      ...hangar(115, 160, 196, 232, 10),
      ...hangar(175, 220, 196, 232, 10),
      ...smallTower(72, 208),
    ],
    paint: cars(-45, 45, 222, 248),
    pavement: [rect(-45, 45, 222, 248)],
  },
};
