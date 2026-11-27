import { describe, expect, it } from 'vitest';
import { STABLE_TICKS } from '../src/config/flight';
import { CEILING_Z, DEFAULT_TUNING, type Tuning } from '../src/config/motion';
import { liftAngle, stallState } from '../src/sim/flight/aero';
import { densityRatio } from '../src/sim/flight/forces';
import { SCALES } from '../src/config/scales';
import { stepBank, stepPitch } from '../src/sim/flight/attitude';
import { autopilotOutput, headingError } from '../src/sim/flight/autopilot';
import { stepAir } from '../src/sim/flight/air';
import { levelStallSpeed } from '../src/sim/flight/vspeeds';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';
import { initialState, type SimState, type StartSpec } from '../src/sim/state';
import { DEG, altFt, engage, flat, ftToZ, ias, send, settled, steps } from './apHelpers';
import { craft } from './helpers';

const tune = (s: SimState, key: keyof Tuning, value: number): SimState => send(s, [{ kind: 'tune', key, value }]);
const headingErr = (s: SimState, target: number): number => Math.abs(((s.craft.heading / DEG - target + 540) % 360) - 180);

interface Result {
  readonly settle: number;
  readonly overshoot: number;
  readonly spdErr: number;
  readonly warned: boolean;
  readonly end: SimState;
}

/** Engages on the targets and flies `secs`; reports when altitude (10 ft) and heading (1 deg) were first both inside, and the overshoot past the altitude target. */
function fly(s0: SimState, hdg: number, ft: number, secs: number, world: SimWorld = flat): Result {
  const from = altFt(s0);
  let s = engage(s0, hdg, ft, world);
  expect(s.autopilot).toMatchObject({ hdg: true, alt: true });
  let settle = Infinity;
  let overshoot = 0;
  let spdErr = 0;
  let warned = false;
  s = steps(s, secs * 60, world, (st, i) => {
    const e = altFt(st) - ft;
    if (settle === Infinity && Math.abs(e) < 10 && headingErr(st, hdg) < 1) settle = i / 60;
    overshoot = Math.max(overshoot, ft > from ? e : -e);
    spdErr = Math.max(spdErr, Math.abs(ias(st) - st.autopilot.targetIas));
    if (stallState(st.craft, st.tuning) !== 'none') warned = true;
    if (!st.autopilot.alt) throw new Error(`dropped at ${i / 60} s: ${JSON.stringify(st.autopilot.notice)}`);
  });
  return { settle, overshoot, spdErr, warned, end: s };
}

describe('stepPitch and stepBank', () => {
  const input = { pitch: 0.05, pitchRate: 0.01, hold: 0.5, speed: 90, sigma: 0.9, alpha: 0.05, separation: 0, loadFactor: 1 };
  it('direct null gives exactly the key results', () => {
    for (const key of [-1, 0, 1] as const) {
      expect(stepPitch({ ...input, key, direct: null }, DEFAULT_TUNING, 1 / 60)).toEqual(stepPitch({ ...input, key }, DEFAULT_TUNING, 1 / 60));
    }
  });
  it('direct skips the key ramp and the hold', () => {
    const keyed = stepPitch({ ...input, key: 1, hold: 0 }, DEFAULT_TUNING, 1 / 60);
    const direct = stepPitch({ ...input, key: 0, direct: 1 }, DEFAULT_TUNING, 1 / 60);
    expect(direct.pitchRate).toBeGreaterThan(keyed.pitchRate);
    expect(direct.hold).toBe(0);
  });
  it('bank takes any share of the roll rate', () => {
    const b = { bank: 0, rollRate: 0, level: false, speed: 90, sigma: 0.9 };
    expect(stepBank({ ...b, key: 1 }, DEFAULT_TUNING, 1 / 60).rollRate).toBeGreaterThan(stepBank({ ...b, key: 0.5 }, DEFAULT_TUNING, 1 / 60).rollRate);
    expect(stepBank({ ...b, key: 0 }, DEFAULT_TUNING, 1 / 60)).toEqual({ bank: 0, rollRate: 0, level: false });
  });
});

describe('manual flight with the autopilot never on', () => {
  it('3,600 steps through advance equal the plain air step', () => {
    let a = initialState();
    let b = initialState();
    for (let i = 0; i < 3600; i++) {
      const keys = [
        { kind: 'turn', value: i % 400 < 100 ? 1 : i % 400 < 200 ? -1 : 0 },
        { kind: 'pitch', value: i % 300 < 60 ? 1 : 0 },
        { kind: 'throttle', value: 0 },
      ] as const;
      a = advance(applyCommands(a, keys, flat), flat);
      b = stepAir(applyCommands(b, keys, flat), flat);
    }
    expect(a.craft).toEqual(b.craft);
    expect(a.controls).toEqual(b.controls);
  });
});

describe('headingError', () => {
  it('is the short way, with 180 to the right', () => {
    expect(headingError(0, 0.5)).toBeCloseTo(0.5, 9);
    expect(headingError(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2, 9);
    expect(headingError(0, Math.PI)).toBeCloseTo(Math.PI, 9);
  });
});

describe('autopilotOutput', () => {
  it('is null for every axis that is off', () => {
    const c = craft({ z: 200, speed: 90, pitch: 0.09 });
    expect(autopilotOutput(c, { hdg: false, alt: false, spd: false, headingTarget: 0, targetZ: 0, targetIas: 0 }, DEFAULT_TUNING, 5)).toEqual({ pitch: null, roll: null, throttle: null });
    const spdOnly = autopilotOutput(c, { hdg: false, alt: false, spd: true, headingTarget: 0, targetZ: 0, targetIas: 100 }, DEFAULT_TUNING, 5);
    expect(spdOnly.pitch).toBeNull();
    expect(spdOnly.throttle).toBeGreaterThan(0);
  });
  it('every output stays in -1..1', () => {
    const c = craft({ z: 200, speed: 90, pitch: 0.09, bank: 1 });
    const o = autopilotOutput(c, { hdg: true, alt: true, spd: true, headingTarget: 3, targetZ: 0, targetIas: 150 }, DEFAULT_TUNING, 5);
    for (const v of [o.pitch, o.roll, o.throttle]) expect(Math.abs(v ?? 0)).toBeLessThanOrEqual(1);
  });
});

describe('closed loop (through the real advance)', () => {
  const base = settled();
  const a0 = altFt(base);
  // [name, start, heading target, altitude target (ft), seconds allowed to settle, overshoot allowed (ft)]
  const cases: readonly [string, SimState, number, number, number, number][] = [
    ['+300 ft', base, 45, a0 + 300, 15 * 1.25, 10],
    ['+1,000 ft', base, 45, a0 + 1000, 20 * 1.25, 10],
    ['+5,000 ft', base, 45, a0 + 5000, 49 * 1.25, 10],
    ['-500 ft', base, 45, a0 - 500, 17 * 1.25, 10],
    ['heading 90 deg', base, 135, a0, 26 * 1.25, 10],
    ['heading 170 deg', base, 215, a0, 45 * 1.25, 10],
    ['30 deg and 500 ft', base, 75, a0 + 500, 17 * 1.25, 10],
    ['12 t, +1,000 ft, 60 deg', tune(base, 'massT', 12), 105, a0 + 1000, 24 * 1.25, 10],
    ['40 t, +1,000 ft, 60 deg', tune(settled({ speed: 110 }), 'massT', 40), 105, a0 + 1000, 22 * 1.25 + 10, 25],
    ['full flaps at 69 m/s, -500 ft', settled({ speed: 69, flapLever: 2 }), 45, a0 - 500, 17 * 1.25, 12],
    ['40 kN thrust, +5,000 ft', tune(base, 'thrustMaxKn', 40), 45, a0 + 5000, 140 * 1.25, 12],
  ];
  for (const [name, start, hdg, ft, settleMax, overMax] of cases) {
    it(`${name}: settles, no overshoot, no stall warning`, () => {
      const r = fly(start, hdg, ft, Math.ceil(settleMax) + 5);
      expect(r.settle).toBeLessThanOrEqual(settleMax);
      expect(r.overshoot).toBeLessThanOrEqual(overMax);
      expect(r.warned).toBe(false);
    });
  }

  it('starting near the stall speed, it speeds up to the floor and never warns', () => {
    // Trimmed for level flight at 1.18 times the stall speed, the case the plan names.
    const vs0 = levelStallSpeed(DEFAULT_TUNING, 0, 0);
    const sigma = densityRatio(200, SCALES.altitude);
    const speed = (1.18 * vs0) / Math.sqrt(sigma);
    const slow = settled({ speed, pitch: liftAngle(1, speed, sigma, DEFAULT_TUNING, 0) });
    const vs = levelStallSpeed(slow.tuning, 0, 0);
    expect(ias(slow)).toBeLessThan(1.25 * vs);
    const r = fly(slow, 135, altFt(slow) + 1000, 90);
    expect(r.warned).toBe(false);
    expect(ias(r.end)).toBeGreaterThan(1.2 * vs);
  });

  it('afterwards it holds within 10 ft for 60 s, the lever sits still, and it never warns', () => {
    let s = fly(base, 45, a0 + 300, 40).end;
    const ft = a0 + 300;
    let worst = 0;
    const levers: number[] = [];
    s = steps(s, 60 * 60, flat, (st, i) => {
      worst = Math.max(worst, Math.abs(altFt(st) - ft));
      if (i >= 30 * 60) levers.push(st.craft.lever);
      if (stallState(st.craft, st.tuning) !== 'none') throw new Error('stall warning');
    });
    expect(worst).toBeLessThan(10);
    expect(Math.max(...levers) - Math.min(...levers)).toBeLessThan(0.01);
    expect(s.autopilot).toMatchObject({ hdg: true, alt: true });
  });

  it('is deterministic: the same commands twice give the same state', () => {
    const run = () => fly(base, 100, a0 + 400, 30).end;
    expect(run()).toEqual(run());
  });

  it('never drops itself: 10 simulated minutes of seeded bug moves', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let s = engage(base, 45, a0);
    for (let sec = 0; sec < 600; sec += 20) {
      s = send(s, [{ kind: 'apTarget', heading: rnd() * 2 * Math.PI, z: ftToZ(a0 - 1000 + rnd() * 3000) }]);
      s = steps(s, 20 * 60, flat, (st, i) => {
        if (st.autopilot.notice || !st.autopilot.alt) throw new Error(`dropped at ${sec + i / 60} s: ${JSON.stringify(st.autopilot.notice)}`);
      });
    }
  }, 60000);
});

describe('autopilot commands', () => {
  const base = settled();
  const eng = (s: SimState): SimState => engage(s, 45, 3281);

  it('engages: heading and altitude hold, speed hold on at the current speed', () => {
    const s = eng(base);
    expect(s.autopilot).toMatchObject({ hdg: true, alt: true, spd: true, notice: null });
    expect(s.autopilot.targetIas).toBeCloseTo(ias(base), 6);
    expect(s.autopilot.headingTarget).toBeCloseTo(45 * DEG, 9);
  });

  it('is accepted at 30 settled steps and refused UNSETTLED at 29', () => {
    const s0 = initialState();
    const at = (n: number) => steps(s0, n);
    expect(at(STABLE_TICKS).stableTicks).toBe(STABLE_TICKS);
    expect(eng(at(STABLE_TICKS)).autopilot.alt).toBe(true);
    const refused = eng(at(STABLE_TICKS - 1));
    expect(refused.autopilot).toMatchObject({ hdg: false, alt: false, notice: { kind: 'refused', reason: 'UNSETTLED' } });
  });

  it('is refused with the reason of each stability row', () => {
    const reasonOf = (s: SimState): string | undefined => eng({ ...s, stableTicks: 99 }).autopilot.notice?.reason;
    expect(reasonOf({ ...base, craft: { ...base.craft, bank: 40 * DEG } })).toBe('BANK');
    expect(reasonOf({ ...base, craft: { ...base.craft, z: 20 } })).toBe('LOW');
    expect(reasonOf({ ...base, craft: { ...base.craft, onGround: true } })).toBe('GROUND');
    expect(reasonOf({ ...base, craft: { ...base.craft, pitch: 0.3, pathAngle: 0.1 } })).toBe('PITCH');
  });

  it('is refused with a key held', () => {
    const held = send(base, [{ kind: 'pitch', value: 1 }]);
    expect(eng(held).autopilot).toMatchObject({ hdg: false, alt: false, notice: { reason: 'controls' } });
  });

  it('engaging holds the present heading, altitude and speed', () => {
    const s = send(base, [{ kind: 'autopilot', on: true }]);
    expect(s.autopilot.headingTarget).toBeCloseTo(base.craft.heading, 9);
    expect(s.autopilot.targetZ).toBeCloseTo(base.craft.z, 9);
    expect(s.autopilot.targetIas).toBeCloseTo(ias(base), 6);
  });

  it('a command that changes only the autopilot is not lost', () => {
    expect(eng(base)).not.toBe(base);
    expect(send(eng(base), [{ kind: 'autopilot', on: false }]).autopilot.alt).toBe(false);
  });

  it('overrides: each key drops only its own mode', () => {
    for (const cmd of [{ kind: 'turn', value: 1 }, { kind: 'turn', value: -1 }, { kind: 'level' }] as const) {
      expect(send(eng(base), [cmd]).autopilot, cmd.kind).toMatchObject({ hdg: false, alt: true, spd: true, notice: null });
    }
    for (const value of [1, -1] as const) {
      expect(send(eng(base), [{ kind: 'pitch', value }]).autopilot).toMatchObject({ hdg: true, alt: false, spd: true });
      expect(send(eng(base), [{ kind: 'throttle', value }]).autopilot).toMatchObject({ hdg: true, alt: true, spd: false });
    }
    expect(send(eng(base), [{ kind: 'turn', value: 0 }, { kind: 'pitch', value: 0 }, { kind: 'throttle', value: 0 }]).autopilot).toMatchObject({ hdg: true, alt: true, spd: true });
  });

  it('off turns everything off; speed hold works alone', () => {
    expect(send(eng(base), [{ kind: 'autopilot', on: false }]).autopilot).toMatchObject({ hdg: false, alt: false, spd: false });
    const s = send(base, [{ kind: 'apMode', mode: 'spd', on: true }]);
    expect(s.autopilot).toMatchObject({ hdg: false, alt: false, spd: true });
    expect(s.autopilot.targetIas).toBeCloseTo(ias(base), 6);
    expect(send(s, [{ kind: 'apMode', mode: 'spd', on: false }]).autopilot.spd).toBe(false);
    expect(send({ ...base, craft: { ...base.craft, onGround: true } }, [{ kind: 'apMode', mode: 'spd', on: true }]).autopilot.spd).toBe(false);
  });

  it('altitude hold alone keeps the present altitude through a hand-flown turn', () => {
    let s = send(base, [{ kind: 'apMode', mode: 'alt', on: true }]);
    expect(s.autopilot).toMatchObject({ hdg: false, alt: true, spd: false, notice: null });
    expect(s.autopilot.targetZ).toBeCloseTo(base.craft.z, 9);
    const heading = s.craft.heading;
    s = send(s, [{ kind: 'turn', value: 1 }]);
    s = steps(s, 90);
    s = send(s, [{ kind: 'turn', value: 0 }]);
    s = steps(s, 60 * 8);
    expect(s.autopilot.alt).toBe(true);
    expect(headingError(heading, s.craft.heading)).toBeGreaterThan(20 * DEG);
    expect(Math.abs(altFt(s) - altFt(base))).toBeLessThan(60);
  });

  it('heading hold alone leaves pitch and throttle to the keys', () => {
    const s = send(base, [{ kind: 'apMode', mode: 'hdg', on: true }]);
    expect(s.autopilot).toMatchObject({ hdg: true, alt: false, spd: false });
    expect(s.autopilot.headingTarget).toBeCloseTo(base.craft.heading, 9);
    expect(autopilotOutput(s.craft, s.autopilot, s.tuning, 5)).toMatchObject({ pitch: null, throttle: null });
  });

  it('a single mode is refused for its own held key only', () => {
    const pitching = send(base, [{ kind: 'pitch', value: 1 }]);
    expect(send(pitching, [{ kind: 'apMode', mode: 'alt', on: true }]).autopilot).toMatchObject({ alt: false, notice: { reason: 'controls' } });
    const turning = send(base, [{ kind: 'turn', value: 1 }]);
    expect(send(turning, [{ kind: 'apMode', mode: 'alt', on: true }]).autopilot.alt).toBe(true);
    expect(send(turning, [{ kind: 'apMode', mode: 'hdg', on: true }]).autopilot).toMatchObject({ hdg: false, notice: { reason: 'controls' } });
  });

  it('crash, restart, start, place and rotate clear everything', () => {
    for (const cmd of [{ kind: 'place', x: 1000, y: 1000 }, { kind: 'rotate', by: 0.1 }, { kind: 'start', spec: { ...(base.start as StartSpec) } }] as const) {
      const s = send(eng(base), [cmd]);
      expect(s.autopilot, cmd.kind).toMatchObject({ hdg: false, alt: false, spd: false });
      expect(s.stableTicks).toBe(0);
    }
    const crashed = steps(eng({ ...base, craft: { ...base.craft, z: 40, pathAngle: -0.5 } }), 600);
    expect(crashed.crash).not.toBeNull();
    expect(crashed.autopilot).toMatchObject({ hdg: false, alt: false, spd: false });
  });

  it('apTarget: wraps the heading, clamps z and speed, is ignored for a mode that is off', () => {
    const s = send(eng(base), [{ kind: 'apTarget', heading: -Math.PI / 2, z: 1e9, ias: 500 }]);
    expect(s.autopilot.headingTarget).toBeCloseTo(1.5 * Math.PI, 9);
    expect(s.autopilot.targetZ).toBe(CEILING_Z);
    expect(s.autopilot.targetIas).toBe(150);
    expect(send(eng(base), [{ kind: 'apTarget', z: -5, ias: 1 }]).autopilot).toMatchObject({ targetZ: 0, targetIas: 30 });
    expect(send(eng(base), [{ kind: 'apTarget', heading: NaN, z: Infinity }]).autopilot).toEqual(eng(base).autopilot);
    expect(send(base, [{ kind: 'apTarget', heading: 1, z: 100, ias: 90 }]).autopilot).toEqual(base.autopilot);
    const spdOff = send(eng(base), [{ kind: 'throttle', value: 1 }]);
    expect(send(spdOff, [{ kind: 'apTarget', ias: 100 }]).autopilot.targetIas).toBe(spdOff.autopilot.targetIas);
  });
});

describe('danger drops', () => {
  const base = settled();
  const a0 = altFt(base);

  it('terrain ahead lets go with a notice, and the plane flies on', () => {
    const cliff: SimWorld = { ...flat, heightAt: (x) => (x > 6000 ? 400 : 0) };
    let s = settled({ x: 4500, y: 0, heading: Math.PI / 2, z: 150 }, cliff);
    s = engage(s, 90, 1000, cliff);
    expect(s.autopilot).toMatchObject({ hdg: true, alt: true });
    let dropTick = -1;
    s = steps(s, 60 * 40, cliff, (st) => {
      if (dropTick < 0 && !st.autopilot.alt) dropTick = st.tick;
    });
    expect(dropTick).toBeGreaterThan(0);
    expect(s.autopilot.notice).toMatchObject({ kind: 'dropped', reason: 'TERRAIN' });
  });

  it('lowering the gear low down keeps it on; getting too low lets go (LOW)', () => {
    let s = engage(settled({ z: 100 }), 45, 3281 - 400);
    s = send(s, [{ kind: 'gear' }]);
    s = steps(s, 60 * 5);
    expect(s.autopilot).toMatchObject({ hdg: true, alt: true, notice: null });
    s = send(s, [{ kind: 'apTarget', z: 0 }]);
    s = steps(s, 60 * 60);
    expect(s.autopilot).toMatchObject({ hdg: false, alt: false, spd: false, notice: { kind: 'dropped', reason: 'LOW' } });
  });

  it('a tuning change that makes it slow lets go, and the player can fly on without input', () => {
    let s = engage(settled({ speed: 80 }), 45, a0);
    s = tune(s, 'massT', 40);
    s = steps(s, 60);
    expect(s.autopilot).toMatchObject({ hdg: false, alt: false, notice: { kind: 'dropped' } });
    expect(['SLOW', 'STALL']).toContain(s.autopilot.notice?.reason);
    s = steps(s, 60 * 5);
    expect(s.crash).toBeNull();
  });
});
