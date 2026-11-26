import { describe, expect, it } from 'vitest';
import { WING_AREA } from '../src/config/flight';
import { flapStepOf } from '../src/config/planeShape';
import { DEFAULT_TUNING, STEP_S } from '../src/config/motion';
import { SCALES } from '../src/config/scales';
import { createKeyState } from '../src/input/keyState';
import { liftAngle, stallState } from '../src/sim/flight/aero';
import { densityRatio, forcesOn } from '../src/sim/flight/forces';
import { gearWarning } from '../src/sim/flight/gear';
import { trimAt } from '../src/sim/flight/trim';
import { levelStallSpeed } from '../src/sim/flight/vspeeds';
import { stepFlaps, wingAt } from '../src/sim/flight/wing';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands } from '../src/sim/step';
import { indicatedSpeed } from '../src/sim/units';
import { flapText, readoutText } from '../src/views/instruments';
import { craft, fly, realWorld, runwayState } from './helpers';

const DEG = Math.PI / 180;
const T = DEFAULT_TUNING;
type World = ReturnType<typeof realWorld>['world'];
const flap = (s: SimState, world: World, by: 1 | -1) => applyCommands(s, [{ kind: 'flaps', by }], world);

describe('wingAt', () => {
  it('flaps 0 and gear 0 is the clean wing exactly, whatever the flap sliders say', () => {
    const w = wingAt(0, 0, { ...T, flapLiftPct: 120, flapDragCounts: 1500 });
    expect(w).toEqual(wingAt(0, 0, T));
    expect(w.cl0).toBe(0.25);
    expect(w.stallRad).toBe(T.stallDeg * DEG);
    expect(w.extraCd0Counts).toBe(0);
  });
  it('a clean flight is bit for bit the same with any flap sliders', () => {
    const { world } = realWorld();
    const a = fly(initialState(), world, 3600);
    const b = fly({ ...initialState(), tuning: { ...T, flapLiftPct: 120, flapDragCounts: 1500 } }, world, 3600);
    expect(b.craft).toEqual(a.craft);
  });
  it('full flaps raise Cl0 and drag and lower the stall angle; gear drag adds', () => {
    const w = wingAt(1, 1, T);
    expect(w.cl0).toBeCloseTo(0.85, 12);
    expect(w.stallRad).toBeCloseTo((T.stallDeg - 1.5) * DEG, 12);
    expect(w.extraCd0Counts).toBe(T.flapDragCounts + T.gearDragCounts);
  });
});

describe('flap motion and command', () => {
  it('travels in 6 s and stops exactly', () => {
    let f = 0;
    for (let i = 0; i < 359; i++) f = stepFlaps(f, 2, STEP_S);
    expect(f).toBeLessThan(1);
    f = stepFlaps(f, 2, STEP_S);
    expect(f).toBe(1);
    expect(stepFlaps(1, 0, 6)).toBe(0);
  });
  it('the lever clamps at 0 and 2; bad values and a crash are ignored', () => {
    const { world } = realWorld();
    let s = initialState();
    s = flap(s, world, -1);
    expect(s.craft.flapLever).toBe(0);
    s = flap(flap(flap(s, world, 1), world, 1), world, 1);
    expect(s.craft.flapLever).toBe(2);
    expect(applyCommands(s, [{ kind: 'flaps', by: 2 as 1 }, { kind: 'flaps', by: NaN as 1 }], world)).toBe(s);
    const crashed = { ...s, crash: { tick: 0, speed: 0, pathAngle: 0, cause: 'terrain' as const, sink: 0 } };
    expect(applyCommands(crashed, [{ kind: 'flaps', by: -1 }], world).craft.flapLever).toBe(2);
  });
  it('flaps can be set and move on the ground, with no pitch change there', () => {
    const { state, world } = runwayState();
    let s = flap(flap(state, world, 1), world, 1);
    s = fly(s, world, 400);
    expect(s.craft.flaps).toBe(1);
    expect(s.craft.pitch).toBe(0);
    expect(s.craft.onGround).toBe(true);
  });
  it('restart goes back to the start flap setting; a bad start lever is ignored', () => {
    const { state, world } = runwayState();
    let s = fly(flap(state, world, 1), world, 100);
    s = { ...s, crash: { tick: 1, speed: 0, pathAngle: 0, cause: 'terrain', sink: 0 } };
    s = applyCommands(s, [{ kind: 'restart' }], world);
    expect(s.craft.flapLever).toBe(0);
    expect(s.craft.flaps).toBe(0);
    const withFlaps = applyCommands(s, [{ kind: 'start', spec: { ...s.start, flapLever: 2 } }], world);
    expect(withFlaps.craft.flaps).toBe(1);
    expect(applyCommands(withFlaps, [{ kind: 'start', spec: { ...s.start, flapLever: 3 as 2 } }], world)).toBe(withFlaps);
  });
});

describe('stall speed', () => {
  it('follows the flaps, with the warning before the stall at each step', () => {
    const want: [number, number, number][] = [[0, 60, 62], [0.5, 56, 58], [1, 52, 54]];
    for (const [f, lo, hi] of want) {
      const v = levelStallSpeed(T, 0, f);
      expect(v, `flaps ${f}`).toBeGreaterThan(lo);
      expect(v, `flaps ${f}`).toBeLessThan(hi);
      let sawWarning = false;
      for (let d = 0; d <= 20; d += 0.05) {
        const st = stallState({ pitch: d * DEG, pathAngle: 0, flaps: f }, T);
        if (st === 'warning') sawWarning = true;
        if (st === 'stalled') expect(sawWarning, `flaps ${f}`).toBe(true);
      }
    }
  });
  it('the lift angle cap moves with the flaps', () => {
    expect(liftAngle(1, 40, 1, T, 0)).toBeCloseTo((T.stallDeg - 2.5) * DEG, 12);
    expect(liftAngle(1, 40, 1, T, 1)).toBeCloseTo((T.stallDeg - 1.5 - 2.5) * DEG, 12);
  });
});

describe('drag', () => {
  it('flaps and gear add at least their counts at the same pitch and speed', () => {
    const base = craft({ z: 100, speed: 80, pitch: 0.05, gear: 0 });
    const q = 0.5 * 1.225 * densityRatio(100, SCALES.altitude) * 80 * 80;
    const clean = forcesOn(base, T, SCALES.altitude);
    const out = forcesOn({ ...base, flaps: 1, flapLever: 2 }, T, SCALES.altitude);
    // Induced drag also rises with the added lift, so the zero-lift part is a lower bound.
    expect(out.drag).toBeGreaterThan(clean.drag + q * WING_AREA * (T.flapDragCounts / 10000) * 0.99);
    const gearD = forcesOn({ ...base, gear: 1 }, T, SCALES.altitude).drag - clean.drag;
    expect(gearD).toBeCloseTo(q * WING_AREA * (T.gearDragCounts / 10000), 3);
  });
  it('a level lever needs more power with flaps out', () => {
    const lever = (f: number) => trimAt(75, 0, 100, SCALES.altitude, T, 0, f).lever;
    expect(lever(1)).toBeGreaterThan(lever(0));
  });
});

describe('nose compensation', () => {
  /** Trim at `speed` clean, then lower full flaps and hold the keys off for 12 s. */
  const extend = (speed: number) => {
    const { world } = realWorld();
    const z = 300;
    const trim = trimAt(speed, 0, z, SCALES.altitude, T);
    const base = initialState();
    let s: SimState = { ...base, craft: { ...base.craft, x: 4560, y: 4560, z, speed, pitch: trim.pitch, lever: trim.lever, spool: trim.lever } };
    s = flap(flap(s, world, 1), world, 1);
    let maxLoad = 0;
    for (let i = 0; i < 720; i++) {
      s = advance(s, world);
      maxLoad = Math.max(maxLoad, forcesOn(s.craft, s.tuning, world.altitudeScale).loadFactor);
    }
    return { s, z, maxLoad, world };
  };
  it('full flaps at 75 and 90 m/s change height under 10 m and load under 1.3 g in 12 s', () => {
    for (const v of [75, 90]) {
      const r = extend(v);
      expect(Math.abs(r.s.craft.z - r.z), `${v}`).toBeLessThan(10);
      expect(r.maxLoad, `${v}`).toBeLessThan(1.3);
      expect(r.s.craft.flaps).toBe(1);
    }
  });
  it('out and back in returns the flaps and leaves the plane flying', () => {
    const r = extend(80);
    let s = flap(flap(r.s, r.world, -1), r.world, -1);
    for (let i = 0; i < 720; i++) s = advance(s, r.world);
    expect(s.craft.flaps).toBe(0);
    expect(s.crash).toBeNull();
    expect(stallState(s.craft, s.tuning)).toBe('none');
  });
});

describe('takeoff and landing feel', () => {
  const takeoffTicks = (lever: 0 | 1 | 2, rotate: number): number => {
    const { state, world } = runwayState();
    let s = applyCommands(state, [{ kind: 'start', spec: { ...state.start, flapLever: lever } }], world);
    for (let i = 0; i < 60 * 60; i++) {
      const key = s.craft.speed >= rotate && s.craft.pitch < 10 * DEG ? 1 : 0;
      s = applyCommands(s, [{ kind: 'throttle', value: 1 }, { kind: 'pitch', value: key }], world);
      s = advance(s, world);
      if (s.crash) return Infinity;
      if (!s.craft.onGround && s.craft.z - world.heightAt(s.craft.x, s.craft.y) > 15) return i;
    }
    return Infinity;
  };
  it('15 m is reached sooner with flaps 1 than clean, and sooner with 2 than 1', { timeout: 30000 }, () => {
    const clean = takeoffTicks(0, 58);
    const one = takeoffTicks(1, 58);
    const two = takeoffTicks(2, 58);
    expect(Number.isFinite(clean)).toBe(true);
    expect(one).toBeLessThan(clean);
    expect(two).toBeLessThan(one);
  });
  it('braked stopping distance from 66 m/s is within 5% for any flap setting (spoilers)', () => {
    const world = { ...realWorld().world, width: 1e6, height: 1e6, heightAt: () => 0, groundKind: () => 'paved' as const };
    const stop = (lever: 0 | 1 | 2): number => {
      let s = applyCommands(initialState({ ...runwayState().state.start, x: 1000, y: 1000, z: 0, flapLever: lever }), [{ kind: 'brake', value: true }], world);
      s = { ...s, craft: { ...s.craft, speed: 66 } };
      let d = 0;
      for (let i = 0; i < 60 * 180 && s.craft.speed > 0.01; i++) {
        const x = s.craft.x;
        const y = s.craft.y;
        s = advance(s, world);
        d += Math.hypot(s.craft.x - x, s.craft.y - y);
      }
      return d;
    };
    const d0 = stop(0);
    for (const l of [1, 2] as const) expect(Math.abs(stop(l) - d0) / d0).toBeLessThan(0.05);
  });
});

describe('gear warning and readouts', () => {
  const low = { onGround: false, gear: 0, pathAngle: -0.03 };
  it('needs airborne, low, slow, gear not down and descending, each way', () => {
    expect(gearWarning(low, 30, 70)).toBe(true);
    expect(gearWarning({ ...low, gear: 0.5 }, 30, 70)).toBe(true);
    expect(gearWarning({ ...low, gear: 1 }, 30, 70)).toBe(false);
    expect(gearWarning({ ...low, onGround: true }, 30, 70)).toBe(false);
    expect(gearWarning(low, 61, 70)).toBe(false);
    expect(gearWarning(low, 30, 86)).toBe(false);
    expect(gearWarning({ ...low, pathAngle: 0.02 }, 30, 70)).toBe(false);
  });
  it('FLP shows the step and > while moving; a stall wins the warning cell', () => {
    expect(flapText({ flapLever: 0, flaps: 0 })).toBe('UP');
    expect(flapText({ flapLever: 1, flaps: 0.5 })).toBe('1');
    expect(flapText({ flapLever: 2, flaps: 0.5 })).toBe('>2');
    expect(flapText({ flapLever: 0, flaps: 0.2 })).toBe('>UP');
    const c = initialState().craft;
    expect(readoutText(c, SCALES, 'none', false, true).warn).toBe('GEAR');
    expect(readoutText(c, SCALES, 'warning', false, true).warn).toBe('STALL');
    expect(readoutText(c, SCALES).warn).toBe('');
    expect(indicatedSpeed(c, SCALES)).toBeGreaterThan(0);
  });
  it('the sprite flap step follows the position', () => {
    expect([0, 0.2, 0.5, 0.8, 1].map(flapStepOf)).toEqual([0, 0, 1, 2, 2]);
  });
});

describe('keys', () => {
  it('F steps out, R steps in, one command per press; a pause clears them', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyF' });
    k.keyUp({ code: 'KeyF' });
    k.keyDown({ code: 'KeyF' });
    k.keyDown({ code: 'KeyR' });
    expect(k.sample()).toEqual([{ kind: 'flaps', by: 1 }, { kind: 'flaps', by: 1 }, { kind: 'flaps', by: -1 }]);
    expect(k.sample()).toEqual([]);
    k.keyDown({ code: 'KeyF' });
    k.clear();
    expect(k.sample()).toEqual([]);
  });
});

describe('invariants with flaps', () => {
  it('random flap, gear, brake and key input from the runway and the air stays finite and above ground', { timeout: 60000 }, () => {
    const { world } = realWorld();
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const axis = () => [-1, 0, 1][Math.floor(rnd() * 3)] as -1 | 0 | 1;
    for (const start of [runwayState().state, initialState()]) {
      let s = start;
      for (let i = 0; i < 6000; i++) {
        const cmds: Parameters<typeof applyCommands>[1][number][] = [];
        if (rnd() < 0.01) cmds.push({ kind: 'flaps', by: rnd() < 0.5 ? 1 : -1 });
        if (rnd() < 0.005) cmds.push({ kind: 'gear' });
        if (rnd() < 0.02) cmds.push({ kind: 'brake', value: rnd() < 0.5 });
        if (rnd() < 0.02) cmds.push({ kind: 'throttle', value: axis() });
        if (rnd() < 0.02) cmds.push({ kind: 'pitch', value: axis() });
        s = advance(applyCommands(s, cmds, world), world);
        for (const v of [s.craft.x, s.craft.y, s.craft.z, s.craft.speed, s.craft.pitch, s.craft.flaps]) expect(Number.isFinite(v)).toBe(true);
        expect(s.craft.flaps).toBeGreaterThanOrEqual(0);
        expect(s.craft.flaps).toBeLessThanOrEqual(1);
        expect(s.craft.z).toBeGreaterThanOrEqual(world.heightAt(s.craft.x, s.craft.y) - 1e-6);
      }
    }
  });
});
