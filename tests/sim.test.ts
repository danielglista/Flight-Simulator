import { describe, expect, it } from 'vitest';
import { createStepper } from '../src/app/stepper';
import { wrapHeading } from '../src/sim/angles';
import type { Command } from '../src/sim/commands';
import { interpolate } from '../src/sim/interpolate';
import { initialState, type SimState } from '../src/sim/state';
import { CEILING_Z, PLACE_CLEARANCE, START_Z } from '../src/config/motion';
import { SCALES } from '../src/config/scales';
import { groundAt, heightAt, surfaceAt, waterLevelAt, worldHeight, worldWidth } from '../src/sim/world/grid';
import { withAirports } from '../src/sim/world/placeAirports';
import { buildTestAirport } from '../src/sim/world/testAirport';
import { buildTestMap, TEST_MAP_LANDMARKS } from '../src/sim/world/testMap';
import { Terrain } from '../src/sim/world/terrain';

const realGrid = () => withAirports(buildTestMap(), [buildTestAirport(SCALES)]);
import { advance, applyCommands, type SimWorld } from '../src/sim/step';

const B: SimWorld = { width: 5120, height: 5120, heightAt: () => 0 };
const at = (heading: number, speed = 60, x = 2560, y = 2560): SimState => {
  const s = initialState();
  return { ...s, craft: { x, y, z: s.craft.z, heading, speed, pathAngle: 0 } };
};
const run = (s: SimState, n: number): SimState => {
  for (let i = 0; i < n; i++) s = advance(s, B);
  return s;
};

describe('advance', () => {
  it('moves 60 m in 60 steps at 60 m/s', () => {
    const s = run(at(0), 60);
    expect(s.craft.y).toBeCloseTo(2620, 6);
    expect(s.tick).toBe(60);
  });
  it('moves north, east, south, west', () => {
    const d = (h: number) => {
      const c = run(at(h), 60).craft;
      return [Math.round(c.x - 2560), Math.round(c.y - 2560)];
    };
    expect(d(0)).toEqual([0, 60]);
    expect(d(Math.PI / 2)).toEqual([60, 0]);
    expect(d(Math.PI)).toEqual([0, -60]);
    expect(d((3 * Math.PI) / 2)).toEqual([-60, 0]);
  });
  it('D increases heading and 12 s of turn returns to start', () => {
    let s = applyCommands(at(1), [{ kind: 'turn', value: 1 }], B);
    s = run(s, 1);
    expect(s.craft.heading).toBeGreaterThan(1);
    s = run(s, 719);
    expect(s.craft.heading).toBeCloseTo(1, 6);
  });
  it('limits speed at both ends', () => {
    let s = applyCommands(at(0), [{ kind: 'throttle', value: 1 }], B);
    s = run(s, 600);
    expect(s.craft.speed).toBe(150);
    s = applyCommands(s, [{ kind: 'throttle', value: -1 }], B);
    s = run(s, 600);
    expect(s.craft.speed).toBe(0);
  });
  it('clamps at each edge and corner', () => {
    expect(run(at(0, 150, 100, 5119), 60).craft.y).toBe(5120);
    expect(run(at(Math.PI / 2, 150, 5119, 100), 60).craft.x).toBe(5120);
    expect(run(at(Math.PI, 150, 100, 1), 60).craft.y).toBe(0);
    expect(run(at((3 * Math.PI) / 2, 150, 1, 100), 60).craft.x).toBe(0);
    const c = run(at((7 * Math.PI) / 4, 150, 1, 5119), 60).craft;
    expect([c.x, c.y]).toEqual([0, 5120]);
    const slide = run(at(Math.PI / 4, 150, 100, 5120), 60).craft;
    expect(slide.y).toBe(5120);
    expect(slide.x).toBeGreaterThan(100);
  });
  it('never produces NaN', () => {
    let s = initialState();
    for (let i = 0; i < 10000; i++) {
      const cmds: Command[] = [
        { kind: 'turn', value: ([-1, 0, 1] as const)[i % 3]! },
        { kind: 'throttle', value: ([1, 1, -1, 0] as const)[i % 4]! },
        { kind: 'pitch', value: ([1, 0, -1, -1, 0] as const)[i % 5]! },
      ];
      s = advance(applyCommands(s, cmds, B), B);
    }
    for (const v of Object.values(s.craft)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('applyCommands', () => {
  it('never changes the tick', () => {
    const s = { ...initialState(), tick: 7 };
    const r = applyCommands(s, [{ kind: 'place', x: 1, y: 2 }, { kind: 'rotate', by: 1 }], B);
    expect(r.tick).toBe(7);
  });
  it('place clamps', () => {
    const r = applyCommands(initialState(), [{ kind: 'place', x: -5, y: 99999 }], B);
    expect([r.craft.x, r.craft.y]).toEqual([0, 5120]);
  });
  it('rotate wraps both ways through north', () => {
    expect(applyCommands(at(0.1), [{ kind: 'rotate', by: -0.2 }], B).craft.heading).toBeCloseTo(
      2 * Math.PI - 0.1,
      9,
    );
    expect(
      applyCommands(at(2 * Math.PI - 0.1), [{ kind: 'rotate', by: 0.2 }], B).craft.heading,
    ).toBeCloseTo(0.1, 9);
    expect(wrapHeading(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 9);
  });
  it('ignores non-finite and invalid values', () => {
    const s = initialState();
    const r = applyCommands(
      s,
      [
        { kind: 'place', x: NaN, y: 1 },
        { kind: 'rotate', by: Infinity },
        { kind: 'turn', value: 5 as never },
      ],
      B,
    );
    expect(r).toEqual(s);
  });
});

describe('interpolate', () => {
  const a = { x: 0, y: 0, z: 100, heading: 1, speed: 0, pathAngle: 0 };
  const b = { x: 10, y: 20, z: 200, heading: 2, speed: 10, pathAngle: 0.2 };
  it('ends are exact and midpoint blends', () => {
    expect(interpolate(a, b, 0)).toEqual(a);
    expect(interpolate(a, b, 1)).toEqual(b);
    expect(interpolate(a, b, 0.5)).toEqual({ x: 5, y: 10, z: 150, heading: 1.5, speed: 5, pathAngle: 0.1 });
  });
  it('passes through north, not the long way', () => {
    const d = Math.PI / 180;
    const h = interpolate({ ...a, heading: 359 * d }, { ...a, heading: 1 * d }, 0.5).heading;
    expect(Math.min(h, 2 * Math.PI - h)).toBeLessThan(1e-9);
  });
});

const hold = (s: SimState, pitch: -1 | 0 | 1): SimState => applyCommands(s, [{ kind: 'pitch', value: pitch }], B);
const DEG = Math.PI / 180;

describe('climb', () => {
  it('S raises z and W lowers it', () => {
    expect(run(hold(at(0), 1), 30).craft.z).toBeGreaterThan(START_Z);
    expect(run(hold(at(0), -1), 30).craft.z).toBeLessThan(START_Z);
  });
  it('angle stops at exactly +/-15 degrees and settles to exactly 0', () => {
    let s = run(hold(at(0), 1), 120);
    expect(s.craft.pathAngle).toBe(15 * DEG);
    s = run(hold(s, 0), 120);
    expect(s.craft.pathAngle).toBe(0);
    s = run(hold(s, -1), 120);
    expect(s.craft.pathAngle).toBe(-15 * DEG);
  });
  it('takes 0.75 s to go from level to full climb', () => {
    expect(run(hold(at(0), 1), 44).craft.pathAngle).toBeLessThan(15 * DEG);
    expect(run(hold(at(0), 1), 45).craft.pathAngle).toBeCloseTo(15 * DEG, 12);
  });
  it('60 steps at full climb rise 60 x sin 15 and advance 60 x cos 15', () => {
    const settled = run(hold(at(0), 1), 60);
    expect(settled.craft.pathAngle).toBe(15 * DEG);
    const s = run(settled, 60);
    expect(s.craft.z - settled.craft.z).toBeCloseTo(60 * Math.sin(15 * DEG), 9);
    expect(s.craft.y - settled.craft.y).toBeCloseTo(60 * Math.cos(15 * DEG), 9);
  });
  it('level flight keeps z exactly', () => {
    expect(run(at(0.3), 1000).craft.z).toBe(START_Z);
  });
  it('climbing does not change speed, and speed 0 does not climb', () => {
    expect(run(hold(at(0), 1), 300).craft.speed).toBe(60);
    expect(run(hold(at(0, 0), 1), 300).craft.z).toBe(START_Z);
  });
  it('stops at the ceiling with the angle at 0, and can descend from it', () => {
    let s = run(hold(at(0, 150), 1), 2000);
    expect(s.craft.z).toBe(CEILING_Z);
    expect(s.craft.pathAngle).toBe(0);
    for (let i = 0; i < 2000; i++) {
      s = advance(s, B);
      expect(s.craft.z).toBeLessThanOrEqual(CEILING_Z);
    }
    s = run(hold(s, -1), 60);
    expect(s.craft.z).toBeLessThan(CEILING_Z);
  });
  it('rejects bad pitch values', () => {
    const s = at(0);
    expect(applyCommands(s, [{ kind: 'pitch', value: 2 as never }], B)).toEqual(s);
  });
});

describe('crash on invented ground', () => {
  const ground = (f: (x: number, y: number) => number): SimWorld => ({ ...B, heightAt: f });
  const flyNorth = (w: SimWorld, from: { y: number; z: number }, speed: number, pitch: -1 | 0 | 1, n: number): SimState => {
    let s: SimState = at(0, speed, 2560, from.y);
    s = { ...s, craft: { ...s.craft, z: from.z } };
    s = applyCommands(s, [{ kind: 'pitch', value: pitch }], w);
    for (let i = 0; i < n; i++) s = advance(s, w);
    return s;
  };
  it('hits flat ground, a slope, a cliff and a 1 m wall at 150 m/s', () => {
    expect(flyNorth(ground(() => 50), { y: 1000, z: 60 }, 60, -1, 600).crash).not.toBeNull();
    expect(flyNorth(ground((_x, y) => Math.max(0, (y - 1500) * 0.2)), { y: 1000, z: 100 }, 100, 0, 600).crash).not.toBeNull();
    expect(flyNorth(ground((_x, y) => (y > 1500 ? 80 : 0)), { y: 1000, z: 40 }, 100, 0, 600).crash).not.toBeNull();
    const wall = flyNorth(ground((_x, y) => (y > 1500.3 && y < 1501.3 ? 90 : 0)), { y: 1000, z: 40 }, 150, 0, 600);
    expect(wall.crash).not.toBeNull();
    expect(wall.craft.y).toBeGreaterThan(1500);
    expect(wall.craft.y).toBeLessThan(1501.4);
  });
  it('contact is within 0.01 m of the analytic point on a slope and on flat ground', () => {
    // Level at z 60 into a rise of 0.2 per m starting at y = 1500: the ground reaches 60 at y = 1800.
    const slope = flyNorth(ground((_x, y) => Math.max(0, (y - 1500) * 0.2)), { y: 1000, z: 60 }, 100, 0, 900);
    expect(Math.abs(slope.craft.y - 1800)).toBeLessThan(0.01);
    expect(Math.abs(slope.craft.z - 60)).toBeLessThan(0.01);
    // Full dive onto flat ground at 0: the contact lies on the last step's segment, z = 0.
    const w = ground(() => 0);
    let s: SimState = applyCommands(at(0, 150, 2560, 1000), [{ kind: 'pitch', value: -1 }], w);
    let before = s;
    while (!s.crash) {
      before = s;
      s = advance(s, w);
    }
    expect(s.craft.z).toBe(0);
    const t = (s.craft.y - before.craft.y) / (advance(before, { ...w, heightAt: () => -1e9 }).craft.y - before.craft.y);
    expect(Math.abs(before.craft.z + t * (advance(before, { ...w, heightAt: () => -1e9 }).craft.z - before.craft.z))).toBeLessThan(0.01);
  });
  it('a path 0.1 m above flat ground is clear', () => {
    expect(flyNorth(ground(() => 50), { y: 1000, z: 50.1 }, 150, 0, 300).crash).toBeNull();
  });
  it('a steep dive at speed is caught', () => {
    const s = flyNorth(ground((_x, y) => (y > 1200 && y < 1300 ? 40 : 0)), { y: 1000, z: 200 }, 150, -1, 600);
    expect(s.crash).not.toBeNull();
    expect(s.craft.z).toBeGreaterThanOrEqual(0);
  });
  it('starting below ground crashes at once', () => {
    const s = flyNorth(ground(() => 500), { y: 1000, z: 100 }, 60, 0, 1);
    expect(s.crash).not.toBeNull();
    expect(s.craft.z).toBe(500);
    expect(s.craft.y).toBeCloseTo(1000, 6);
  });
  it('the craft stays put after a crash and ticks continue; place and rotate are ignored', () => {
    const w = ground(() => 50);
    const crashed = flyNorth(w, { y: 1000, z: 60 }, 60, -1, 600);
    expect(crashed.crash).not.toBeNull();
    expect(crashed.craft.speed).toBe(0);
    const later = advance(advance(crashed, w), w);
    expect(later.craft).toEqual(crashed.craft);
    expect(later.tick).toBe(crashed.tick + 2);
    const ignored = applyCommands(
      crashed,
      [{ kind: 'place', x: 10, y: 10 }, { kind: 'rotate', by: 1 }, { kind: 'turn', value: 1 }],
      w,
    );
    expect(ignored.craft).toEqual(crashed.craft);
    expect(ignored.controls.turn).toBe(1);
  });
  it('interpolation never draws past the contact point', () => {
    const w = ground(() => 50);
    let s: SimState = flyNorth(w, { y: 1000, z: 60 }, 150, -1, 0);
    let prev = s;
    while (!s.crash) {
      prev = s;
      s = advance(s, w);
    }
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      const c = interpolate(prev.craft, s.craft, a);
      expect(c.y).toBeLessThanOrEqual(s.craft.y + 1e-9);
      expect(c.z).toBeGreaterThanOrEqual(s.craft.z - 1e-9);
    }
  });
});

describe('restart', () => {
  const w: SimWorld = { ...B, heightAt: () => 50 };
  const crashedState = (): SimState => {
    let s = applyCommands(initialState(), [{ kind: 'pitch', value: -1 }, { kind: 'turn', value: 1 }], w);
    s = { ...s, craft: { ...s.craft, z: 52 } };
    while (!s.crash) s = advance(s, w);
    return s;
  };
  it('is ignored unless crashed', () => {
    const s = run(initialState(), 5);
    expect(applyCommands(s, [{ kind: 'restart' }], w)).toBe(s);
  });
  it('restores the start but keeps tick and controls', () => {
    const c = crashedState();
    const r = applyCommands(c, [{ kind: 'restart' }], w);
    expect(r.crash).toBeNull();
    expect(r.craft).toEqual(initialState().craft);
    expect(r.tick).toBe(c.tick);
    expect(r.controls).toEqual(c.controls);
  });
  it('a held key still works afterwards', () => {
    const r = applyCommands(crashedState(), [{ kind: 'restart' }], w);
    expect(r.controls.turn).toBe(1);
    expect(advance(r, B).craft.heading).toBeGreaterThan(r.craft.heading);
  });
});

describe('place', () => {
  const peakWorld: SimWorld = { ...B, heightAt: (x, y) => (Math.hypot(x - 1000, y - 1000) < 50 ? 180 : 0) };
  it('lifts the craft to clearance above high ground', () => {
    const r = applyCommands(initialState(), [{ kind: 'place', x: 1000, y: 1000 }], peakWorld);
    expect(r.craft.z).toBe(180 + PLACE_CLEARANCE);
  });
  it('leaves z alone over low ground, and rotate leaves it alone', () => {
    const r = applyCommands(initialState(), [{ kind: 'place', x: 3000, y: 3000 }, { kind: 'rotate', by: 1 }], peakWorld);
    expect(r.craft.z).toBe(START_Z);
  });
});

describe('real map', () => {
  const grid = realGrid();
  const world: SimWorld = {
    width: worldWidth(grid),
    height: worldHeight(grid),
    heightAt: (x, y) => heightAt(grid, SCALES, x, y),
  };
  const fly = (s: SimState, n: number): SimState => {
    for (let i = 0; i < n; i++) s = advance(s, world);
    return s;
  };
  it('START_Z is above the start ground and below the peak and ceiling', () => {
    let top = 0;
    for (let y = 0; y < grid.rows; y++)
      for (let x = 0; x < grid.cols; x++)
        top = Math.max(top, heightAt(grid, SCALES, (x + 0.5) * grid.cellSize, (y + 0.5) * grid.cellSize));
    expect(START_Z).toBeGreaterThan(world.heightAt(2560, 2560));
    expect(START_Z).toBeLessThan(top);
    expect(CEILING_Z).toBeGreaterThan(top);
  });
  it('doing nothing from the start crashes on the mountain', () => {
    const s = fly(initialState(), 60 * 40);
    expect(s.crash).not.toBeNull();
    expect(s.crash!.tick).toBeGreaterThan(60 * 10);
    expect(s.crash!.tick).toBeLessThan(60 * 30);
    expect(world.heightAt(s.craft.x, s.craft.y)).toBeGreaterThan(50);
  });
  it('a scripted climb passes the peak without crashing', () => {
    let s = applyCommands(initialState(), [{ kind: 'pitch', value: 1 }], world);
    s = fly(s, 60 * 6);
    s = applyCommands(s, [{ kind: 'pitch', value: 0 }], world);
    s = fly(s, 60 * 40);
    expect(s.crash).toBeNull();
    expect(s.craft.x).toBeGreaterThan(3900);
  });
  const dive = (x: number, y: number, heading: number): SimState => {
    let s = initialState();
    s = applyCommands(
      s,
      [{ kind: 'place', x, y }, { kind: 'rotate', by: heading - s.craft.heading }, { kind: 'pitch', value: -1 }],
      world,
    );
    s = { ...s, craft: { ...s.craft, z: world.heightAt(x, y) + 80 } };
    return fly(s, 60 * 60);
  };
  it('descending onto the runway, lake and sea crashes at each', () => {
    const rw = grid.airports[0]!.runways[0]!;
    const hx = Math.sin(rw.heading);
    const hy = Math.cos(rw.heading);
    const mid = { x: (rw.a.x + rw.b.x) / 2, y: (rw.a.y + rw.b.y) / 2 };
    const onRunway = dive(mid.x - hx * 700, mid.y - hy * 700, rw.heading);
    expect(onRunway.crash).not.toBeNull();
    expect(surfaceAt(grid, onRunway.craft.x, onRunway.craft.y)).toBe(Terrain.runway);
    const lc = TEST_MAP_LANDMARKS.lakeCenter;
    const lake = dive((lc.col + 0.5) * grid.cellSize - 150, (lc.row + 0.5) * grid.cellSize, Math.PI / 2);
    expect(lake.crash).not.toBeNull();
    expect(waterLevelAt(grid, SCALES, lake.craft.x, lake.craft.y)).toBeGreaterThan(groundAt(grid, SCALES, lake.craft.x, lake.craft.y));
    const sea = dive(100, 100, Math.PI);
    expect(sea.crash).not.toBeNull();
    expect(sea.craft.z).toBeCloseTo(world.heightAt(sea.craft.x, sea.craft.y), 9);
  });
  it('10,000 steps of scripted inputs with restarts: no NaN and z >= heightAt always', () => {
    let s = initialState();
    let crashes = 0;
    for (let i = 0; i < 10000; i++) {
      const cmds: Command[] = [];
      if (i % 37 === 0) cmds.push({ kind: 'turn', value: ([-1, 0, 1] as const)[Math.floor(i / 37) % 3]! });
      if (i % 53 === 0) cmds.push({ kind: 'pitch', value: ([-1, -1, 0, 1, -1] as const)[Math.floor(i / 53) % 5]! });
      if (i % 211 === 0) cmds.push({ kind: 'throttle', value: ([1, 0, -1] as const)[Math.floor(i / 211) % 3]! });
      if (s.crash) {
        crashes++;
        if (i % 7 === 0) cmds.push({ kind: 'restart' });
      }
      s = advance(applyCommands(s, cmds, world), world);
      for (const v of Object.values(s.craft)) expect(Number.isFinite(v)).toBe(true);
      expect(s.craft.z).toBeGreaterThanOrEqual(world.heightAt(s.craft.x, s.craft.y) - 1e-9);
    }
    expect(crashes).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  // Commands belong to the tick at which they are applied, before it advances.
  const baseScript: [number, Command][] = [
    [10, { kind: 'turn', value: 1 }],
    [100, { kind: 'throttle', value: 1 }],
    [200, { kind: 'turn', value: -1 }],
    [250, { kind: 'place', x: 1000, y: 1000 }],
    [300, { kind: 'turn', value: 0 }],
  ];
  const final = (frameTimes: number[], script = baseScript, w: SimWorld = B): string => {
    const stepper = createStepper();
    let s = initialState();
    let i = 0;
    for (const dt of frameTimes) {
      const { steps } = stepper.advance(dt);
      for (let n = 0; n < steps && s.tick < 400; n++) {
        const cmds: Command[] = [];
        while (i < script.length && script[i]![0] <= s.tick) cmds.push(script[i++]![1]);
        s = advance(applyCommands(s, cmds, w), w);
      }
      if (s.tick >= 400) break;
    }
    // Run to exactly 400 ticks regardless of how the frames fell.
    while (s.tick < 400) {
      const cmds: Command[] = [];
      while (i < script.length && script[i]![0] <= s.tick) cmds.push(script[i++]![1]);
      s = advance(applyCommands(s, cmds, w), w);
    }
    return JSON.stringify(s);
  };
  const even = (hz: number): number[] => Array.from({ length: Math.ceil(hz * 8) }, () => 1 / hz);
  it('same commands give the same state at 30, 60, 144 Hz and irregular frames', () => {
    const irregular = Array.from({ length: 400 }, (_, k) => 0.005 + ((k * 7919) % 40) / 1000);
    const ref = final(even(60));
    expect(final(even(30))).toBe(ref);
    expect(final(even(144))).toBe(ref);
    expect(final(irregular)).toBe(ref);
  });
  it('is frame-rate independent with pitch, a crash and a restart', () => {
    const w: SimWorld = { ...B, heightAt: () => 60 };
    const script: [number, Command][] = [
      [10, { kind: 'turn', value: 1 }],
      [100, { kind: 'pitch', value: -1 }],
      [300, { kind: 'restart' }],
      [320, { kind: 'pitch', value: 1 }],
      [340, { kind: 'pitch', value: 0 }],
    ];
    const irregular = Array.from({ length: 400 }, (_, k) => 0.005 + ((k * 7919) % 40) / 1000);
    const ref = final(even(60), script, w);
    expect(JSON.parse(ref).crash).toBeNull(); // restarted by tick 400
    expect(final(even(30), script, w)).toBe(ref);
    expect(final(even(144), script, w)).toBe(ref);
    expect(final(irregular, script, w)).toBe(ref);
  });
});
