import { describe, expect, it } from 'vitest';
import { SCALES } from '../src/config/scales';
import { GRASS_MU, ROLL_MU, STEER_MAX_DEG, STEER_RADIUS, TAIL_LIMIT_DEG } from '../src/config/flight';
import { DEFAULT_TUNING, STEP_S } from '../src/config/motion';
import { densityRatio } from '../src/sim/flight/forces';
import { groundAuthority, stepGroundNose, steerRate } from '../src/sim/flight/ground';
import { AIR_START, initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands } from '../src/sim/step';
import { runwayFrame } from '../src/sim/world/airport';
import { fly, realWorld, runwayState } from './helpers';

const DEG = Math.PI / 180;
/** Full power, and the nose up once fast enough. */
const takeoff = (rotateAt: number) => (s: SimState) => ({ throttle: 1 as const, pitch: s.craft.speed >= rotateAt ? (1 as const) : (0 as const) });
const { runway } = realWorld();
const along = (s: SimState): number => runwayFrame(runway, s.craft.x, s.craft.y).along;

/** Runs until the wheels leave the ground (or crash or `max` steps). */
function toLiftoff(pilot: (s: SimState) => { throttle?: -1 | 0 | 1; pitch?: -1 | 0 | 1 }, max = 3600) {
  const { state, world } = runwayState();
  let s = state;
  for (let i = 0; i < max && s.craft.onGround && !s.crash; i++) s = fly(s, world, 1, pilot);
  return { s, world, start: state };
}

describe('standing on the runway', () => {
  it('is on the ground, on the runway, facing down it, at rest', () => {
    const { state, world } = runwayState();
    expect(state.craft.onGround).toBe(true);
    expect(world.groundKind(state.craft.x, state.craft.y)).toBe('paved');
    expect(runwayFrame(runway, state.craft.x, state.craft.y).along).toBeCloseTo(40, 6);
    expect(runwayFrame(runway, state.craft.x, state.craft.y).across).toBeCloseTo(0, 6);
    expect(state.craft.heading).toBeCloseTo(runway.heading, 9);
    expect(state.craft.z).toBe(world.heightAt(state.craft.x, state.craft.y));
  });
  it('does not move in 60 s at idle, and z stays exactly on the ground', () => {
    const { state, world } = runwayState();
    const s = fly(state, world, 3600);
    expect(s.craft.x).toBe(state.craft.x);
    expect(s.craft.y).toBe(state.craft.y);
    expect(s.craft.z).toBe(state.craft.z);
    expect(s.craft.speed).toBe(0);
    expect(s.craft.onGround).toBe(true);
    expect(s.crash).toBeNull();
  });
  it('ignores steering and the nose key at rest', () => {
    const { state, world } = runwayState();
    const s = fly(state, world, 300, () => ({ turn: 1, pitch: 1 }));
    expect(s.craft.heading).toBe(state.craft.heading);
    expect(s.craft.pitch).toBe(0);
    expect(s.craft.x).toBe(state.craft.x);
  });
});

describe('the roll', () => {
  it('one step of acceleration is ground-multiplied thrust over mass, minus friction', () => {
    const { state, world } = runwayState();
    const full = { ...state, craft: { ...state.craft, lever: 1, spool: 1 } };
    const s = fly(full, world, 1);
    const m = DEFAULT_TUNING.massT * 1000;
    const thrust = DEFAULT_TUNING.thrustMaxKn * 1000 * Math.pow(densityRatio(full.craft.z, SCALES.altitude), 0.7);
    // Friction is mu times the weight on the wheels; lift is nil at rest.
    const expected = ((DEFAULT_TUNING.groundMult * thrust) / m - ROLL_MU * 9.81) * STEP_S;
    expect(s.craft.speed).toBeCloseTo(expected, 5);
  });
  it('groundMult scales thrust only', () => {
    const { state, world } = runwayState();
    const run = (mult: number) => fly({ ...state, tuning: { ...state.tuning, groundMult: mult }, craft: { ...state.craft, lever: 1, spool: 1 } }, world, 60).craft.speed;
    expect(run(3)).toBeGreaterThan(run(1.5));
    const idle = (mult: number) => fly({ ...state, tuning: { ...state.tuning, groundMult: mult } }, world, 60).craft.speed;
    expect(idle(3)).toBe(idle(1));
  });
  it('friction never reverses motion, and a stopped plane stays stopped', () => {
    const { state, world } = runwayState();
    let s: SimState = { ...state, craft: { ...state.craft, speed: 5 } };
    for (let i = 0; i < 3000; i++) {
      s = advance(s, world);
      expect(s.craft.speed).toBeGreaterThanOrEqual(0);
    }
    expect(s.craft.speed).toBe(0);
  });
  it('grass slows more than paving', () => {
    const { state, world } = runwayState();
    // Beside the runway, inside the flat airport, on grass.
    const ux = (runway.b.x - runway.a.x) / runway.length;
    const uy = (runway.b.y - runway.a.y) / runway.length;
    const onGrass = { ...state, craft: { ...state.craft, x: runway.a.x + ux * 300 + uy * 40, y: runway.a.y + uy * 300 - ux * 40, speed: 40 } };
    expect(world.groundKind(onGrass.craft.x, onGrass.craft.y)).toBe('grass');
    const paved = fly({ ...state, craft: { ...state.craft, speed: 40 } }, world, 60);
    const grass = fly(onGrass, world, 60);
    expect(grass.craft.speed).toBeLessThan(paved.craft.speed);
    expect(GRASS_MU).toBeGreaterThan(ROLL_MU);
  });
});

describe('steering', () => {
  it('is zero at rest, and mirrored left and right', () => {
    expect(steerRate(0, 1)).toBe(0);
    expect(steerRate(20, 0)).toBe(0);
    expect(steerRate(20, -1)).toBe(-steerRate(20, 1));
    const { state, world } = runwayState();
    const rolling = { ...state, craft: { ...state.craft, speed: 10 } };
    const right = fly(rolling, world, 60, () => ({ turn: 1 }));
    const left = fly(rolling, world, 60, () => ({ turn: -1 }));
    expect(right.craft.heading - rolling.craft.heading).toBeGreaterThan(0);
    expect(rolling.craft.heading - left.craft.heading).toBeCloseTo(right.craft.heading - rolling.craft.heading, 9);
  });
  it('rate at 5, 7 and 60 m/s: radius 15 m when slow, at most 20 deg/s, 2.9 deg/s when fast', () => {
    expect(steerRate(5, 1)).toBeCloseTo(5 / STEER_RADIUS, 9);
    expect(5 / steerRate(5, 1)).toBeCloseTo(STEER_RADIUS, 9);
    expect(steerRate(7, 1)).toBeCloseTo(STEER_MAX_DEG * DEG, 9);
    expect(steerRate(20, 1)).toBeCloseTo(3 / 20, 9);
    expect(steerRate(60, 1)).toBeCloseTo(3 / 60, 9);
    for (let v = 0.5; v < 100; v += 0.5) expect(steerRate(v, 1)).toBeLessThanOrEqual(STEER_MAX_DEG * DEG + 1e-12);
  });
});

describe('the nose', () => {
  const sigma = 1;
  it('does not rise below 35 m/s', () => {
    expect(groundAuthority(35, sigma)).toBe(0);
    expect(stepGroundNose(0, 0, 0, 1, 30, sigma, DEFAULT_TUNING, STEP_S).pitch).toBe(0);
  });
  it('holds where released at 70 m/s, falls when slow, never passes the tail limit', () => {
    expect(stepGroundNose(8 * DEG, 0, 0, 0, 70, sigma, DEFAULT_TUNING, STEP_S).pitch).toBe(8 * DEG);
    expect(stepGroundNose(8 * DEG, 0, 0, 0, 20, sigma, DEFAULT_TUNING, STEP_S).pitch).toBeLessThan(8 * DEG);
    let p = { pitch: 0, pitchRate: 0, hold: 0 };
    for (let i = 0; i < 600; i++) {
      p = stepGroundNose(p.pitch, p.pitchRate, p.hold, 1, 70, sigma, DEFAULT_TUNING, STEP_S);
      expect(p.pitch).toBeLessThanOrEqual(TAIL_LIMIT_DEG * DEG + 1e-12);
    }
    expect(p.pitch).toBeCloseTo(TAIL_LIMIT_DEG * DEG, 9);
  });
  it('eases down from above the limit, under 0.2 deg per step', () => {
    let p = { pitch: 14 * DEG, pitchRate: 0, hold: 0 };
    for (let i = 0; i < 30; i++) {
      const next = stepGroundNose(p.pitch, p.pitchRate, p.hold, 1, 70, sigma, DEFAULT_TUNING, STEP_S);
      expect(p.pitch - next.pitch).toBeLessThan(0.2 * DEG);
      expect(next.pitch).toBeLessThanOrEqual(p.pitch);
      p = next;
    }
    expect(p.pitch).toBeCloseTo(TAIL_LIMIT_DEG * DEG, 9);
  });
});

describe('takeoff', () => {
  it('rotating at 62 m/s lifts off 350 to 520 m down the runway at 62 to 75 m/s', () => {
    const { s, start } = toLiftoff(takeoff(62));
    expect(s.crash).toBeNull();
    expect(s.craft.onGround).toBe(false);
    expect(along(s) - along(start)).toBeGreaterThan(350);
    expect(along(s) - along(start)).toBeLessThan(520);
    expect(s.craft.speed).toBeGreaterThan(62);
    expect(s.craft.speed).toBeLessThan(75);
    expect(s.liftoffTick).toBe(s.tick);
  });
  it('then keeps climbing: more than 15 m up within 25 s of the start', () => {
    const { state, world } = runwayState();
    const s = fly(state, world, 25 * 60, takeoff(62));
    expect(s.crash).toBeNull();
    expect(s.craft.z - world.heightAt(s.craft.x, s.craft.y)).toBeGreaterThan(15);
  });
  it('without rotation never leaves the ground and runs off the end (a crash)', () => {
    const { state, world } = runwayState();
    let s = state;
    let top = 0;
    for (let i = 0; i < 3600 && !s.crash; i++) {
      s = fly(s, world, 1, () => ({ throttle: 1 }));
      top = Math.max(top, s.craft.speed);
      if (!s.crash) expect(s.craft.onGround).toBe(true);
    }
    expect(s.crash).not.toBeNull();
    expect(top).toBeLessThan(120);
    expect(along(s)).toBeGreaterThan(runway.length);
  });
  it('holding S from rest flies and is not stalled 10 s later', () => {
    const { s, world } = toLiftoff(() => ({ throttle: 1, pitch: 1 }));
    expect(s.craft.onGround).toBe(false);
    const later = fly(s, world, 600, () => ({ throttle: 1 }));
    expect(later.crash).toBeNull();
    expect(later.craft.pitch - later.craft.pathAngle).toBeLessThan(DEFAULT_TUNING.stallDeg * DEG);
  });
  it('a heavier plane lifts off later', () => {
    const light = toLiftoff(takeoff(62)).s.tick;
    const { state, world } = runwayState();
    let s = { ...state, tuning: { ...state.tuning, massT: 30 } };
    for (let i = 0; i < 3600 && s.craft.onGround && !s.crash; i++) s = fly(s, world, 1, takeoff(62));
    expect(s.tick).toBeGreaterThan(light);
  });
  it('rises without a jump at liftoff and changes onGround once', () => {
    const { state, world } = runwayState();
    let s = state;
    let changes = 0;
    let sinceLiftoff = -1;
    for (let i = 0; i < 1800; i++) {
      const prev = s;
      s = fly(s, world, 1, takeoff(62));
      if (s.craft.onGround !== prev.craft.onGround) {
        changes++;
        sinceLiftoff = 0;
      }
      if (sinceLiftoff >= 0 && sinceLiftoff < 10) expect(s.craft.z - prev.craft.z).toBeLessThan(0.1);
      if (sinceLiftoff >= 0) sinceLiftoff++;
    }
    expect(changes).toBe(1);
  });
});

describe('touching back down after liftoff', () => {
  /** Just after a liftoff, dropped to a hair above the paving and sinking at `path` radians. */
  function sinking(ticksAgo: number, path = -0.05) {
    const { s, world } = toLiftoff(takeoff(62));
    const ground = world.heightAt(s.craft.x, s.craft.y);
    return { world, s: { ...s, liftoffTick: s.tick - ticksAgo, craft: { ...s.craft, z: ground + 0.01, pathAngle: path } } };
  }
  it('a soft touch over paving puts the wheels back down and records the touchdown', () => {
    const { s, world } = sinking(10);
    const back = advance(s, world);
    expect(back.crash).toBeNull();
    expect(back.craft.onGround).toBe(true);
    expect(back.craft.z).toBe(world.heightAt(back.craft.x, back.craft.y));
    expect(back.craft.pathAngle).toBe(0);
    expect(back.touchdown?.kind).toBe('paved');
  });
  it('a hard touch is a crash, soon after liftoff or long after', () => {
    for (const ago of [10, 200]) {
      const { s, world } = sinking(ago, -0.15);
      expect(advance(s, world).crash?.cause).toBe('hard');
    }
  });
  it('a touch on rough ground is a crash whenever it happens', () => {
    const { s } = sinking(10);
    const { world } = realWorld();
    const rough = { ...world, groundKind: () => 'rough' as const };
    expect(advance(s, rough).crash?.cause).toBe('terrain');
  });
});

describe('commands on the ground', () => {
  it('place ends airborne with the air start trim, 20 m up', () => {
    const { state, world } = runwayState();
    const s = applyCommands(state, [{ kind: 'place', x: runway.a.x + 200, y: runway.a.y + 200 }], world);
    expect(s.craft.onGround).toBe(false);
    expect(s.craft.speed).toBe(AIR_START.speed);
    expect(s.craft.z).toBeGreaterThanOrEqual(world.heightAt(s.craft.x, s.craft.y) + 20);
    expect(fly(s, world, 600).crash).toBeNull();
  });
  it('level is ignored on the ground', () => {
    const { state, world } = runwayState();
    expect(applyCommands(state, [{ kind: 'level' }], world).controls.level).toBe(false);
  });
  it('start with a non-finite number is ignored; a good one restarts from it, and restart returns there', () => {
    const { state, world } = runwayState();
    expect(applyCommands(state, [{ kind: 'start', spec: { ...AIR_START, x: NaN } }], world)).toBe(state);
    const air = applyCommands(state, [{ kind: 'start', spec: AIR_START }], world);
    expect(air.craft.onGround).toBe(false);
    expect(air.start).toEqual(AIR_START);
    const crashed: SimState = { ...air, crash: { tick: 1, speed: 1, pathAngle: 0, cause: "terrain" as const, sink: 0 }, craft: { ...air.craft, x: 1, y: 1 } };
    const back = applyCommands(crashed, [{ kind: 'restart' }], world);
    expect(back.craft.x).toBe(AIR_START.x);
    expect(back.crash).toBeNull();
  });
  it('the air start still flies 60 s hands off', () => {
    const { world } = runwayState();
    const s = fly(initialState(), { ...world, heightAt: () => 0 }, 3600);
    expect(s.crash).toBeNull();
    expect(s.craft.onGround).toBe(false);
  });
});

describe('invariants on the ground', () => {
  it('10,000 steps of random inputs: finite, never below the ground, wheels only on the flat', () => {
    const { state, world } = runwayState();
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = () => (Math.floor(rnd() * 3) - 1) as -1 | 0 | 1;
    let s = state;
    for (let i = 0; i < 10000; i++) {
      if (s.crash) s = applyCommands(s, [{ kind: 'restart' }], world);
      if (i % 30 === 0) s = applyCommands(s, [{ kind: 'throttle', value: pick() }, { kind: 'pitch', value: pick() }, { kind: 'turn', value: pick() }], world);
      s = advance(s, world);
      for (const v of Object.values(s.craft)) expect(typeof v === 'boolean' || Number.isFinite(v)).toBe(true);
      if (s.craft.onGround && !s.crash) {
        expect(s.craft.z).toBe(world.heightAt(s.craft.x, s.craft.y));
        expect(world.groundKind(s.craft.x, s.craft.y)).not.toBe('rough');
        expect(s.craft.pitch).toBeGreaterThanOrEqual(0);
        expect(s.craft.pitch).toBeLessThanOrEqual(16 * DEG + 1e-9);
      }
      expect(s.craft.z).toBeGreaterThanOrEqual(world.heightAt(s.craft.x, s.craft.y) - 1e-9);
    }
  });
});
