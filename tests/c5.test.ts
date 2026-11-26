import { describe, expect, it } from 'vitest';
import { crashMessage, landingMessage } from '../src/app/crashBanner';
import { SCALES } from '../src/config/scales';
import { DEFAULT_TUNING } from '../src/config/motion';
import { createKeyState } from '../src/input/keyState';
import { landed, spoilersOut, touchdownCheck, type Contact } from '../src/sim/flight/ground';
import { trimAt } from '../src/sim/flight/trim';
import { accelerateStopM, vSpeeds } from '../src/sim/flight/vspeeds';
import { initialState, type SimState, type Touchdown } from '../src/sim/state';
import { advance, applyCommands } from '../src/sim/step';
import { finalStart } from '../src/sim/world/starts';
import { formatAgl } from '../src/views/format';
import { approachGuide, guideText } from '../src/views/approach';
import { brakeText } from '../src/views/instruments';
import { speedMarks } from '../src/views/gauges/airspeed';
import { fly, realWorld, runwayState } from './helpers';

const DEG = Math.PI / 180;
const T = DEFAULT_TUNING;
const ok: Contact = { rough: false, gearLocked: true, sink: 2, bank: 0, pitch: 3 * DEG };
const TD: Touchdown = { tick: 1, x: 0, y: 0, heading: 0, sink: 1, speed: 60, bank: 0, pitch: 0, kind: 'paved' };

describe('touchdownCheck', () => {
  it('a normal arrival lands; each limit survives exactly and fails just past', () => {
    expect(touchdownCheck(ok, T)).toBeNull();
    expect(touchdownCheck({ ...ok, sink: 5 }, T)).toBeNull();
    expect(touchdownCheck({ ...ok, sink: 5.01 }, T)).toBe('hard');
    expect(touchdownCheck({ ...ok, bank: 14.9 * DEG }, T)).toBeNull();
    expect(touchdownCheck({ ...ok, bank: 15.1 * DEG }, T)).toBe('bank');
    expect(touchdownCheck({ ...ok, bank: -15.1 * DEG }, T)).toBe('bank');
    expect(touchdownCheck({ ...ok, pitch: -2.9 * DEG }, T)).toBeNull();
    expect(touchdownCheck({ ...ok, pitch: -3.1 * DEG }, T)).toBe('nose');
    expect(touchdownCheck({ ...ok, pitch: 15.9 * DEG }, T)).toBeNull();
    expect(touchdownCheck({ ...ok, pitch: 16.1 * DEG }, T)).toBe('tail');
  });
  it('checks in order: terrain, gear, hard, bank, nose, tail', () => {
    const bad: Contact = { rough: true, gearLocked: false, sink: 9, bank: 40 * DEG, pitch: -10 * DEG };
    expect(touchdownCheck(bad, T)).toBe('terrain');
    expect(touchdownCheck({ ...bad, rough: false }, T)).toBe('gear');
    expect(touchdownCheck({ ...bad, rough: false, gearLocked: true }, T)).toBe('hard');
    expect(touchdownCheck({ ...bad, rough: false, gearLocked: true, sink: 1 }, T)).toBe('bank');
    expect(touchdownCheck({ ...bad, rough: false, gearLocked: true, sink: 1, bank: 0 }, T)).toBe('nose');
  });
  it('the sink limit follows the slider', () => {
    expect(touchdownCheck({ ...ok, sink: 3 }, { touchdownSinkMs: 2 })).toBe('hard');
  });
});

/** Over the runway, a meter up, sinking at `path`, gear down unless patched. */
function arrival(path: number, patch: Partial<SimState['craft']> = {}, agl = 1) {
  const { world, runway } = realWorld();
  const ux = (runway.b.x - runway.a.x) / runway.length;
  const uy = (runway.b.y - runway.a.y) / runway.length;
  const x = runway.a.x + ux * 300;
  const y = runway.a.y + uy * 300;
  const base = initialState();
  const s: SimState = {
    ...base,
    craft: { ...base.craft, x, y, z: world.heightAt(x, y) + agl, heading: runway.heading, speed: 66, pathAngle: path, pitch: 4 * DEG, gearDown: true, gear: 1, ...patch },
  };
  return { s, world };
}

const toContact = (s: SimState, world: ReturnType<typeof realWorld>['world']): SimState => {
  let t = s;
  for (let i = 0; i < 240 && !t.craft.onGround && !t.crash; i++) t = advance(t, world);
  return t;
};

describe('landing', () => {
  it('a soft arrival puts the plane on its wheels and records the touchdown', () => {
    const { s, world } = arrival(-2 * DEG);
    const t = toContact(s, world);
    expect(t.crash).toBeNull();
    expect(t.craft.onGround).toBe(true);
    expect(t.craft.pathAngle).toBe(0);
    expect(t.craft.z).toBe(world.heightAt(t.craft.x, t.craft.y));
    expect(t.touchdown?.kind).toBe('paved');
    expect(t.touchdown?.sink).toBeGreaterThan(1);
    expect(t.touchdown?.sink).toBeLessThan(5);
    expect(t.craft.pitch).toBeCloseTo(4 * DEG, 5);
    expect(Number.isFinite(t.craft.speed)).toBe(true);
  });
  it('each cause crashes with its cause', { timeout: 30000 }, () => {
    const cases: [string, number, Partial<SimState['craft']>, number?][] = [
      ['hard', -6 * DEG, {}],
      ['bank', -2 * DEG, { bank: 20 * DEG }],
      ['nose', -2 * DEG, { pitch: -6 * DEG }],
      ['tail', -2 * DEG, { pitch: 17 * DEG }, 0.01],
      ['gear', -2 * DEG, { gearDown: false, gear: 0 }],
    ];
    for (const [cause, path, patch, agl] of cases) {
      const { s, world } = arrival(path, patch, agl);
      expect(toContact(s, world).crash?.cause, cause).toBe(cause);
    }
  });
  it('off the airfield it is terrain, whatever the attitude', () => {
    const { s, world } = arrival(-2 * DEG);
    const away = { ...s, craft: { ...s.craft, x: 100, y: 100, z: world.heightAt(100, 100) + 1 } };
    expect(toContact(away, world).crash?.cause).toBe('terrain');
  });
  it('a skip keeps the larger sink of the two touches', () => {
    const { s, world } = arrival(-2 * DEG);
    const prior = { ...s, tick: 100, liftoffTick: 90, touchdown: { ...TD, tick: 80, sink: 4.5 } };
    expect(toContact(prior, world).touchdown?.sink).toBeGreaterThanOrEqual(4.5);
  });
});

describe('brakes and spoilers', () => {
  const flat = () => ({ ...realWorld().world, width: 1e6, height: 1e6, heightAt: () => 0, groundKind: () => 'paved' as const });
  /** Rolls from 66 m/s on a long paved flat until stopped; returns the distance. */
  const stopDistance = (brake: boolean, lever = 0): number => {
    const world = flat();
    let s = applyCommands(initialState({ ...runwayState().state.start, x: 1000, y: 1000, z: 0 }), [{ kind: 'brake', value: brake }], world);
    s = { ...s, craft: { ...s.craft, speed: 66, lever, spool: lever } };
    let d = 0;
    for (let i = 0; i < 60 * 180 && s.craft.speed > 0.01; i++) {
      const x = s.craft.x;
      const y = s.craft.y;
      s = advance(s, world);
      d += Math.hypot(s.craft.x - x, s.craft.y - y);
    }
    return d;
  };
  it('braking from 66 m/s stops in 350 to 550 m; without brakes it rolls much farther', () => {
    const braked = stopDistance(true);
    expect(braked).toBeGreaterThan(350);
    expect(braked).toBeLessThan(550);
    expect(stopDistance(false)).toBeGreaterThan(1000);
  });
  it('braking with spoilers stowed (power on) takes longer', () => {
    expect(stopDistance(true, 0.2)).toBeGreaterThan(stopDistance(true));
  });
  it('a landed plane is landed once stopped, and not at the start', () => {
    const { state } = runwayState();
    expect(landed({ ...state, touchdown: TD })).toBe(true);
    expect(landed(state)).toBe(false);
    expect(landed({ ...state, touchdown: TD, craft: { ...state.craft, speed: 3 } })).toBe(false);
  });
  it('spoilers are out at or below 10% lever only', () => {
    expect(spoilersOut(0)).toBe(true);
    expect(spoilersOut(0.1)).toBe(true);
    expect(spoilersOut(0.11)).toBe(false);
  });
  it('brake command takes booleans only', () => {
    const { state, world } = runwayState();
    expect(applyCommands(state, [{ kind: 'brake', value: true }], world).controls.brake).toBe(true);
    expect(applyCommands(state, [{ kind: 'brake', value: 1 as unknown as boolean }], world)).toBe(state);
  });
  it('BRK cell shows on the ground only', () => {
    expect(brakeText({ onGround: true, lever: 0, speed: 30 }, true)).toBe('ON SPL');
    expect(brakeText({ onGround: true, lever: 0, speed: 0 }, false)).toBe('');
    expect(brakeText({ onGround: true, lever: 0.5, speed: 30 }, false)).toBe('');
    expect(brakeText({ onGround: false, lever: 0, speed: 60 }, true)).toBe('');
  });
});

describe('restart after landing', () => {
  it('works once landed and stopped; not at the start or in flight', () => {
    const { state, world } = runwayState();
    expect(applyCommands(state, [{ kind: 'restart' }], world)).toBe(state);
    const air = initialState();
    expect(applyCommands(air, [{ kind: 'restart' }], world)).toBe(air);
    const stopped = { ...state, craft: { ...state.craft, x: state.craft.x + 300 }, touchdown: TD };
    const back = applyCommands(stopped, [{ kind: 'restart' }], world);
    expect(back.craft.x).toBe(state.craft.x);
    expect(back.touchdown).toBeNull();
  });
});

describe('banner text', () => {
  const { grid, runway } = realWorld();
  const td = (along: number, across: number, heading: number, sink = 1.93): Touchdown => {
    const ux = (runway.b.x - runway.a.x) / runway.length;
    const uy = (runway.b.y - runway.a.y) / runway.length;
    return { ...TD, x: runway.a.x + ux * along + uy * across, y: runway.a.y + uy * along - ux * across, heading, sink };
  };
  it('names the runway end used, distance past the threshold and the side', () => {
    expect(landingMessage(grid, td(210, 3, runway.heading))).toBe(`LANDED: runway ${runway.names[0]} TST, 380 ft/min, 210 m past threshold, 3 m right - Enter to restart`);
    expect(landingMessage(grid, td(210, -3, runway.heading))).toContain('3 m left');
    const back = landingMessage(grid, td(210, 3, runway.heading + Math.PI));
    expect(back).toContain(`runway ${runway.names[1]}`);
    expect(back).toContain(`${Math.round(runway.length - 210)} m past threshold`);
    expect(back).toContain('3 m left');
    expect(landingMessage(grid, td(210, 0, runway.heading))).toContain('on the center line');
  });
  it('says off runway on grass', () => {
    const g: Touchdown = { ...td(210, 0, 0), x: runway.a.x - 5, y: runway.a.y + 60, kind: 'grass' };
    expect(landingMessage(grid, g)).toMatch(/^LANDED: grass, off runway, 380 ft\/min/);
  });
  it('crash text carries the cause; terrain stays as before', () => {
    const c = runwayState().state.craft;
    const crash = (cause: 'hard' | 'terrain' | 'bank' | 'nose' | 'tail' | 'overrun' | 'gear', sink = 0) => ({ tick: 1, speed: 1, pathAngle: 0, cause, sink });
    expect(crashMessage(grid, SCALES, c, crash('hard', 6.3))).toBe('CRASHED: runway 07/25 TST, hard landing 1,240 ft/min - Enter to restart');
    expect(crashMessage(grid, SCALES, c, crash('terrain', 6.3))).toContain(' ft - Enter');
    for (const cause of ['bank', 'nose', 'tail', 'overrun', 'gear'] as const) {
      expect(crashMessage(grid, SCALES, c, crash(cause))).not.toContain(' ft - ');
    }
  });
});

describe('trim and the Final start', () => {
  it('trimAt gives a flyable lever below full power', () => {
    const t = trimAt(78, -3 * DEG, 100, SCALES.altitude, T, T.gearDragCounts);
    expect(t.ok).toBe(true);
    expect(t.lever).toBeGreaterThan(0);
    expect(t.lever).toBeLessThan(1);
  });
  it('the Final start holds speed within 1 m/s and path within 0.3 deg for 10 s, gear down', () => {
    const { world, runway } = realWorld();
    const spec = finalStart(runway, world.heightAt, SCALES.altitude, T);
    expect(spec.gearDown).toBe(true);
    const s0 = applyCommands(initialState(), [{ kind: 'start', spec }], world);
    const s = fly(s0, world, 600);
    expect(s.crash).toBeNull();
    expect(Math.abs(s.craft.speed - spec.speed)).toBeLessThan(1);
    expect(Math.abs(s.craft.pathAngle - spec.pathAngle)).toBeLessThan(0.3 * DEG);
  });
});

describe('V1 and AGL', () => {
  it('V1 is null without a runway, rises with its length, and stays at or under VR', () => {
    expect(vSpeeds(T).v1).toBeNull();
    const short = vSpeeds(T, 600).v1 ?? -1;
    const long = vSpeeds(T, 5000).v1 ?? -1;
    expect(short).toBeLessThan(long);
    expect(long).toBeLessThanOrEqual(vSpeeds(T).vr);
  });
  it('accelerate-stop distance grows with speed', () => {
    expect(accelerateStopM(40, T)).toBeLessThan(accelerateStopM(60, T));
  });
  it('the speed dial marks V1 when there is one', () => {
    expect(speedMarks({ v1: 50, vr: 63, v2: 72 }, 10)[0]?.label).toBe('1');
  });
  it('AGL text is in displayed feet', () => {
    expect(formatAgl(1204)).toBe('AGL 1,200 ft');
    expect(formatAgl(-5)).toBe('AGL 0 ft');
  });
});

describe('Space', () => {
  it('gives level once and brake true then false; a pause releases the brake', () => {
    const k = createKeyState();
    k.keyDown({ code: 'Space' });
    expect(k.sample()).toEqual([{ kind: 'brake', value: true }, { kind: 'level' }]);
    expect(k.sample()).toEqual([]);
    k.keyUp({ code: 'Space' });
    expect(k.sample()).toEqual([{ kind: 'brake', value: false }]);
    k.keyDown({ code: 'Space' });
    k.sample();
    k.clear();
    expect(k.sample()).toEqual([{ kind: 'brake', value: false }]);
  });
});

describe('invariants with brakes', () => {
  it('10,000 steps of random keys, brake and gear from three starts: finite, on the ground only on the flat', () => {
    const { world, runway } = realWorld();
    const starts = [runwayState().state.start, finalStart(runway, world.heightAt, SCALES.altitude, T), initialState().start];
    for (const start of starts) {
      let seed = 777;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const pick = () => (Math.floor(rnd() * 3) - 1) as -1 | 0 | 1;
      let s = applyCommands(initialState(), [{ kind: 'start', spec: start }], world);
      for (let i = 0; i < 10000; i++) {
        if (i % 40 === 0) {
          s = applyCommands(s, [{ kind: 'turn', value: pick() }, { kind: 'pitch', value: pick() }, { kind: 'throttle', value: pick() }, { kind: 'brake', value: rnd() < 0.5 }], world);
          if (rnd() < 0.1) s = applyCommands(s, [{ kind: 'gear' }], world);
          if (rnd() < 0.05) s = applyCommands(s, [{ kind: 'restart' }], world);
        }
        s = advance(s, world);
        const c = s.craft;
        for (const v of [c.x, c.y, c.z, c.speed, c.pitch, c.heading]) expect(Number.isFinite(v)).toBe(true);
        expect(c.z).toBeGreaterThanOrEqual(world.heightAt(c.x, c.y) - 1e-9);
        if (c.onGround) {
          expect(c.z).toBe(world.heightAt(c.x, c.y));
          expect(world.groundKind(c.x, c.y)).not.toBe('rough');
        }
      }
    }
  });
});

describe('approach guide', () => {
  const { world, runway } = realWorld();
  const ux = (runway.b.x - runway.a.x) / runway.length;
  const uy = (runway.b.y - runway.a.y) / runway.length;
  const at = (s: number, c: number, patch = {}) => ({
    x: runway.a.x + ux * s - uy * c,
    y: runway.a.y + uy * s + ux * c,
    z: world.heightAt(runway.a.x, runway.a.y) + Math.max(0, 150 - s) * Math.tan(3 * DEG),
    heading: runway.heading,
    onGround: false,
    gear: 1,
    pathAngle: -3 * DEG,
    ...patch,
  });
  const guide = (c: ReturnType<typeof at>, agl = 50, crashed = false) => approachGuide(c, agl, crashed, runway, world.heightAt);
  it('is on only for a descending, gear-down, aligned plane close to the runway', () => {
    expect(guide(at(-1500, 0))).not.toBeNull();
    expect(guide(at(-1500, 0, { gear: 0 }))).toBeNull();
    expect(guide(at(-1500, 0, { onGround: true }))).toBeNull();
    expect(guide(at(-1500, 0), 200)).toBeNull();
    expect(guide(at(-1500, 0, { heading: runway.heading + 90 * DEG }))).toBeNull();
    expect(guide(at(-6000, 0))).toBeNull();
    expect(guide(at(-1500, 3000))).toBeNull();
    expect(guide(at(-1500, 0), 50, true)).toBeNull();
    expect(guide(at(400, 0, { pathAngle: 5 * DEG }))).toBeNull();
    expect(guide(at(400, 0))).not.toBeNull();
  });
  it('reads offset, heading error and glide error, and is zero on the line', () => {
    const on = guide(at(-1000, 0))!;
    expect(Math.abs(on.offset)).toBeLessThan(0.01);
    expect(Math.abs(on.glideError)).toBeLessThan(0.01);
    expect(guideText(on)).toBe('LOC 0 m   HDG 0   GS 0 m');
    expect(guide(at(-1000, 40))!.offset).toBeCloseTo(-40, 5);
    expect(guideText(guide(at(-1000, 40))!)).toContain('LOC 40 m L');
    expect(guideText(guide(at(-1000, -40))!)).toContain('LOC 40 m R');
    const high = guide({ ...at(-1000, 0), z: at(-1000, 0).z + 20 })!;
    expect(high.glideError).toBeCloseTo(20, 5);
    expect(guideText(high)).toContain('GS 20 m HIGH');
    expect(guideText(guide(at(-1000, 0, { heading: runway.heading + 3 * DEG }))!)).toContain('HDG +3');
  });
  it('uses the other runway end when the plane faces it', () => {
    const g = approachGuide({ ...at(0, 0), x: runway.b.x + ux * 1200, y: runway.b.y + uy * 1200, heading: runway.heading + Math.PI, z: 60 }, 50, false, runway, world.heightAt);
    expect(g).not.toBeNull();
    expect(g!.threshold).toEqual(runway.b);
    expect(g!.along).toBeCloseTo(-1200, 5);
  });
});
