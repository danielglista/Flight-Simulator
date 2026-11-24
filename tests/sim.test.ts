import { describe, expect, it } from 'vitest';
import { createStepper } from '../src/app/stepper';
import { wrapHeading } from '../src/sim/angles';
import type { Command } from '../src/sim/commands';
import { interpolate } from '../src/sim/interpolate';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands } from '../src/sim/step';

const B = { width: 5120, height: 5120 };
const at = (heading: number, speed = 60, x = 2560, y = 2560): SimState => {
  const s = initialState();
  return { ...s, craft: { x, y, heading, speed } };
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
  const a = { x: 0, y: 0, heading: 1, speed: 0 };
  const b = { x: 10, y: 20, heading: 2, speed: 10 };
  it('ends are exact and midpoint blends', () => {
    expect(interpolate(a, b, 0)).toEqual(a);
    expect(interpolate(a, b, 1)).toEqual(b);
    expect(interpolate(a, b, 0.5)).toEqual({ x: 5, y: 10, heading: 1.5, speed: 5 });
  });
  it('passes through north, not the long way', () => {
    const d = Math.PI / 180;
    const h = interpolate({ ...a, heading: 359 * d }, { ...a, heading: 1 * d }, 0.5).heading;
    expect(Math.min(h, 2 * Math.PI - h)).toBeLessThan(1e-9);
  });
});

describe('determinism', () => {
  // Commands belong to the tick at which they are applied, before it advances.
  const script: [number, Command][] = [
    [10, { kind: 'turn', value: 1 }],
    [100, { kind: 'throttle', value: 1 }],
    [200, { kind: 'turn', value: -1 }],
    [250, { kind: 'place', x: 1000, y: 1000 }],
    [300, { kind: 'turn', value: 0 }],
  ];
  const final = (frameTimes: number[]): string => {
    const stepper = createStepper();
    let s = initialState();
    let i = 0;
    for (const dt of frameTimes) {
      const { steps } = stepper.advance(dt);
      for (let n = 0; n < steps && s.tick < 400; n++) {
        const cmds: Command[] = [];
        while (i < script.length && script[i]![0] <= s.tick) cmds.push(script[i++]![1]);
        s = advance(applyCommands(s, cmds, B), B);
      }
      if (s.tick >= 400) break;
    }
    // Run to exactly 400 ticks regardless of how the frames fell.
    while (s.tick < 400) {
      const cmds: Command[] = [];
      while (i < script.length && script[i]![0] <= s.tick) cmds.push(script[i++]![1]);
      s = advance(applyCommands(s, cmds, B), B);
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
});
