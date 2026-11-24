import { describe, expect, it } from 'vitest';
import { createLoop } from '../src/app/loop';
import { createStepper } from '../src/app/stepper';
import { CEILING_Z, DEFAULT_TUNING, TUNING_RANGES, type Tuning } from '../src/config/motion';
import type { Command } from '../src/sim/commands';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';

const DEG = Math.PI / 180;
const W: SimWorld = { width: 5120, height: 5120, heightAt: () => 0, altitudeScale: 10 };
const KEYS = Object.keys(TUNING_RANGES) as (keyof Tuning)[];
const tune = (key: keyof Tuning, value: number): Command => ({ kind: 'tune', key, value });
const run = (s: SimState, n: number, w = W): SimState => {
  for (let i = 0; i < n; i++) s = advance(s, w);
  return s;
};

describe('tune command', () => {
  it('sets a value inside the range', () => {
    expect(applyCommands(initialState(), [tune('turnRateDegS', 60)], W).tuning.turnRateDegS).toBe(60);
  });
  it('ignores unknown keys and non-finite values, and returns the same state', () => {
    const s = initialState();
    expect(applyCommands(s, [{ kind: 'tune', key: 'bogus' as keyof Tuning, value: 5 }], W)).toBe(s);
    expect(applyCommands(s, [{ kind: 'tune', key: 'toString' as keyof Tuning, value: 5 }], W)).toBe(s);
    for (const v of [NaN, Infinity, -Infinity]) expect(applyCommands(s, [tune('massT', v)], W)).toBe(s);
  });
  it('clamps at both ends', () => {
    for (const k of KEYS) {
      const r = TUNING_RANGES[k];
      expect(applyCommands(initialState(), [tune(k, -1e9)], W).tuning[k]).toBe(r.min);
      expect(applyCommands(initialState(), [tune(k, 1e9)], W).tuning[k]).toBe(r.max);
    }
  });
  it('same state object when the value is unchanged', () => {
    const s = initialState();
    expect(applyCommands(s, [tune('massT', DEFAULT_TUNING.massT)], W)).toBe(s);
  });
  it('works while crashed and survives restart, place and rotate', () => {
    let s: SimState = { ...initialState(), crash: { tick: 1, speed: 1, pathAngle: 0 } };
    s = applyCommands(s, [tune('pathMaxDeg', 25)], W);
    expect(s.tuning.pathMaxDeg).toBe(25);
    s = applyCommands(s, [{ kind: 'restart' }], W);
    expect(s.crash).toBeNull();
    expect(s.tuning.pathMaxDeg).toBe(25);
    s = applyCommands(s, [{ kind: 'place', x: 5, y: 5 }, { kind: 'rotate', by: 1 }], W);
    expect(s.tuning.pathMaxDeg).toBe(25);
  });
  it('defaults are in range and on a step', () => {
    for (const k of KEYS) {
      const r = TUNING_RANGES[k];
      const v = DEFAULT_TUNING[k];
      expect(v).toBeGreaterThanOrEqual(r.min);
      expect(v).toBeLessThanOrEqual(r.max);
      const n = (v - r.min) / r.step;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
    }
    expect(initialState().tuning).toEqual(DEFAULT_TUNING);
  });
});

describe('tuning in motion', () => {
  it('turn rate', () => {
    let s = applyCommands(initialState(), [tune('turnRateDegS', 60), { kind: 'turn', value: 1 }], W);
    const h = s.craft.heading;
    s = run(s, 60);
    expect((s.craft.heading - h) / DEG).toBeCloseTo(60, 6);
  });
  it('lever rate', () => {
    let s = applyCommands(initialState(), [tune('leverRatePctS', 10), { kind: 'throttle', value: 1 }], W);
    s = run(s, 60);
    expect(s.craft.lever).toBeCloseTo(0.321 + 0.1, 9);
  });
  it('spool time constant: 63% of the way after one tau', () => {
    let s = applyCommands(initialState(), [tune('spoolTauS', 1), { kind: 'throttle', value: 1 }], W);
    s = { ...s, craft: { ...s.craft, lever: 1, spool: 0 }, controls: { ...s.controls, throttle: 0 } };
    s = run(s, 60);
    expect(s.craft.spool).toBeCloseTo(1 - Math.exp(-1), 9);
  });
  it('raising mass slows a climb', () => {
    const climb = (m: number): number => {
      let s = applyCommands(initialState(), [tune('massT', m), { kind: 'pitch', value: 1 }], W);
      s = run(s, 240);
      return s.craft.speed;
    };
    expect(climb(40)).toBeLessThan(climb(12) + 1e-9);
  });
  it('path limit is reached exactly, and lowering it settles without overshoot', () => {
    const fast = initialState();
    let s = applyCommands({ ...fast, craft: { ...fast.craft, speed: 150 } }, [tune('pathMaxDeg', 30), { kind: 'pitch', value: 1 }], W);
    s = run(s, 120);
    expect(s.craft.pathAngle).toBe(30 * DEG);
    s = applyCommands(s, [tune('pathMaxDeg', 10)], W);
    let prev = s.craft.pathAngle;
    for (let i = 0; i < 100; i++) {
      s = run(s, 1);
      expect(s.craft.pathAngle).toBeLessThanOrEqual(prev);
      expect(s.craft.pathAngle).toBeGreaterThanOrEqual(10 * DEG);
      prev = s.craft.pathAngle;
    }
    expect(s.craft.pathAngle).toBe(10 * DEG);
  });
  it('path rate', () => {
    let s = applyCommands(initialState(), [tune('pathRateDegS', 60), { kind: 'pitch', value: 1 }], W);
    s = run(s, 15);
    expect(s.craft.pathAngle).toBeCloseTo(15 * DEG, 12);
  });
  it('10,000 steps at every maximum and with mid-run changes: finite, above ground, under the ceiling', () => {
    const hills: SimWorld = { ...W, heightAt: (x, y) => 40 + 30 * Math.sin(x / 300) * Math.cos(y / 300) };
    for (const [mode, mid] of [['max', false], ['min', false], ['mid', true]] as const) {
      let s = initialState();
      if (!mid) for (const k of KEYS) s = applyCommands(s, [tune(k, mode === 'max' ? TUNING_RANGES[k].max : TUNING_RANGES[k].min)], hills);
      for (let i = 0; i < 10000; i++) {
        const cmds: Command[] = [];
        if (i % 37 === 0) cmds.push({ kind: 'turn', value: ([-1, 0, 1] as const)[Math.floor(i / 37) % 3]! });
        if (i % 53 === 0) cmds.push({ kind: 'pitch', value: ([1, 1, 0, -1, 1] as const)[Math.floor(i / 53) % 5]! });
        if (i % 211 === 0) cmds.push({ kind: 'throttle', value: ([1, 0, -1] as const)[Math.floor(i / 211) % 3]! });
        if (mid && i % 97 === 0) {
          const k = KEYS[Math.floor(i / 97) % KEYS.length]!;
          const r = TUNING_RANGES[k];
          cmds.push(tune(k, i % 2 ? r.min : r.max));
        }
        if (s.crash && i % 7 === 0) cmds.push({ kind: 'restart' });
        s = advance(applyCommands(s, cmds, hills), hills);
        for (const v of Object.values(s.craft)) expect(Number.isFinite(v)).toBe(true);
        expect(s.craft.z).toBeGreaterThanOrEqual(hills.heightAt(s.craft.x, s.craft.y) - 1e-9);
        expect(s.craft.z).toBeLessThanOrEqual(CEILING_Z);
        expect(s.craft.speed === 0 || (s.craft.speed >= 20 && s.craft.speed <= 300)).toBe(true);
      }
    }
  }, 30000);
  it('is frame-rate independent with tune commands at fixed ticks', () => {
    const script: [number, Command][] = [
      [10, { kind: 'turn', value: 1 }],
      [50, tune('turnRateDegS', 90)],
      [100, tune('thrustMaxKn', 60)],
      [150, { kind: 'throttle', value: 1 }],
      [200, tune('pathMaxDeg', 30)],
      [220, { kind: 'pitch', value: 1 }],
    ];
    const final = (times: number[]): string => {
      const stepper = createStepper();
      let s = initialState();
      let i = 0;
      const step = (): void => {
        const cmds: Command[] = [];
        while (i < script.length && script[i]![0] <= s.tick) cmds.push(script[i++]![1]);
        s = advance(applyCommands(s, cmds, W), W);
      };
      for (const dt of times) {
        const { steps } = stepper.advance(dt);
        for (let n = 0; n < steps && s.tick < 400; n++) step();
      }
      while (s.tick < 400) step();
      return JSON.stringify(s);
    };
    const even = (hz: number): number[] => Array.from({ length: hz * 8 }, () => 1 / hz);
    const irregular = Array.from({ length: 400 }, (_, k) => 0.005 + ((k * 7919) % 40) / 1000);
    const ref = final(even(60));
    expect(final(even(30))).toBe(ref);
    expect(final(even(144))).toBe(ref);
    expect(final(irregular)).toBe(ref);
  });
});

describe('tune through the loop', () => {
  const DT = 1000 / 60;
  const make = (startPaused = false) => {
    const frames: number[] = [];
    const loop = createLoop({
      world: W,
      draw: () => {},
      requestDraw: () => {},
      sampleKeys: () => [],
      clearKeys: () => {},
      startPaused,
      onFrame: (s) => frames.push(s),
    });
    return { loop, frames };
  };
  it('applies at once while running, and survives an immediate pause', () => {
    const { loop } = make();
    loop.frame(0);
    loop.frame(DT);
    const tick = loop.state.tick;
    const craft = loop.state.craft;
    loop.send(tune('massT', 30));
    expect(loop.state.tuning.massT).toBe(30);
    expect(loop.state.tick).toBe(tick);
    expect(loop.state.craft).toBe(craft);
    loop.pause();
    expect(loop.state.tuning.massT).toBe(30);
  });
  it('applies while paused', () => {
    const { loop } = make(true);
    loop.send(tune('turnRateDegS', 90));
    expect(loop.state.tuning.turnRateDegS).toBe(90);
    expect(loop.state.tick).toBe(0);
  });
  it('onFrame skips the first frame and the first after a resume', () => {
    const { loop, frames } = make();
    loop.frame(0);
    expect(frames).toHaveLength(0);
    loop.frame(DT);
    loop.frame(2 * DT);
    expect(frames).toHaveLength(2);
    loop.pause();
    loop.frame(5000);
    expect(frames).toHaveLength(2);
    loop.resume();
    loop.frame(10000);
    expect(frames).toHaveLength(2);
    loop.frame(10000 + DT);
    expect(frames).toHaveLength(3);
    expect(frames[2]).toBeCloseTo(DT / 1000, 9);
  });
});
