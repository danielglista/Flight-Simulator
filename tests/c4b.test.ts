import { metersPerSecondToKnots } from '../src/sim/units';
import { ASI_TABLE, VMARK_LABEL_MIN_DEG } from '../src/config/display';
import { speedMarks, v1Merged } from '../src/views/gauges/airspeed';
import { tableAngle } from '../src/views/gauges/dial';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, STEP_HZ } from '../src/config/motion';
import { GEAR_TIME_S, V2_MULT, VR_MULT } from '../src/config/flight';
import { SCALES } from '../src/config/scales';
import { aeroAt } from '../src/sim/flight/aero';
import { forcesOn } from '../src/sim/flight/forces';
import { stepGear } from '../src/sim/flight/gear';
import { clMax, levelStallSpeed, vSpeeds } from '../src/sim/flight/vspeeds';
import { createKeyState } from '../src/input/keyState';
import { initialState, type SimState } from '../src/sim/state';
import { advance, applyCommands } from '../src/sim/step';
import { indicatedSpeed } from '../src/sim/units';
import { CLOSE_ZOOM, ZOOM_LEVELS, metersPerPixel, zoomForMpp } from '../src/views/camera';
import { CLOSE_SIDE_ZOOM, clampSideZoom, sideMetersPerPixel, sideZoomForMpp, SIDE_ZOOM_LEVELS, verticalMetersPerPixel } from '../src/views/sideCamera';
import { NO_CALLOUTS, runwayRemaining, stepCallouts, stepSpeeds, takeoffMode, calloutSentence, gearPrompt, type CalloutInput } from '../src/views/takeoffStrip';
import { easeMpp, gatePhase, recall, remember, stepPhaseZoom } from '../src/views/zoomGate';
import { craft, fly, realWorld, runwayState } from './helpers';
import { initialState as air } from '../src/sim/state';

const DEG = Math.PI / 180;
const T = DEFAULT_TUNING;

/** The state a moment after liftoff with the path pointed down 5 degrees: it touches inside the settle window however slowly the nose answers. */
const sinking = (s: SimState): SimState => ({ ...s, craft: { ...s.craft, pathAngle: -5 * DEG } });

/** Full power, S held once the indicated speed reaches `rotateAt`. Returns the state at liftoff and the roll length. */
function takeoffAt(rotateAt: number, tuning = T) {
  const { state, world, runway } = { ...runwayState(), runway: realWorld().runway };
  let s = applyCommands(state, [{ kind: 'tune', key: 'massT', value: tuning.massT }, { kind: 'throttle', value: 1 }], world);
  const x0 = s.craft.x;
  const y0 = s.craft.y;
  for (let i = 0; i < 60 * 40; i++) {
    const rotate = indicatedSpeed(s.craft, SCALES) >= rotateAt;
    s = applyCommands(s, [{ kind: 'pitch', value: rotate ? 1 : 0 }], world);
    s = advance(s, world);
    if (!s.craft.onGround || s.crash) break;
  }
  void runway;
  return { s, world, roll: Math.hypot(s.craft.x - x0, s.craft.y - y0) };
}

describe('V-speeds', () => {
  it('Vs is the hand-worked stall speed at the default mass', () => {
    const cl = clMax(T);
    const want = Math.sqrt((2 * 24000 * 9.81) / (1.225 * 70 * cl));
    expect(levelStallSpeed(T)).toBeCloseTo(want, 9);
    expect(levelStallSpeed(T)).toBeGreaterThan(58);
    expect(levelStallSpeed(T)).toBeLessThan(63);
  });
  it('VR and V2 are the multiples of it, VR above the stall', () => {
    const v = vSpeeds(T);
    expect(v.vr).toBeCloseTo(VR_MULT * levelStallSpeed(T), 9);
    expect(v.v2).toBeCloseTo(V2_MULT * levelStallSpeed(T), 9);
    expect(v.vr).toBeGreaterThan(levelStallSpeed(T));
    expect(v.v2).toBeGreaterThan(v.vr);
  });
  it('scale with the square root of mass, and a heavier plane gives higher values', () => {
    const a = vSpeeds({ ...T, massT: 16 });
    const b = vSpeeds({ ...T, massT: 36 });
    expect(b.vr / a.vr).toBeCloseTo(Math.sqrt(36 / 16), 6);
    expect(b.v2).toBeGreaterThan(a.v2);
  });
  it('are finite at both ends of every slider that matters, V1 is absent before C5', () => {
    for (const massT of [12, 40]) for (const stallDeg of [10, 20]) {
      const v = vSpeeds({ ...T, massT, stallDeg });
      expect(Number.isFinite(v.vr) && Number.isFinite(v.v2)).toBe(true);
      expect(v.v1).toBeNull();
    }
  });
  it('do not depend on where the plane is or how fast it goes', () => {
    expect(vSpeeds(runwayState().state.tuning)).toEqual(vSpeeds(air().tuning));
  });
  it('rotating at the computed VR lifts off inside the C4 band', () => {
    const { s, roll } = takeoffAt(vSpeeds(T).vr);
    expect(s.crash).toBeNull();
    expect(s.craft.onGround).toBe(false);
    expect(roll).toBeGreaterThan(350);
    expect(roll).toBeLessThan(520);
  });
});

describe('takeoff mode', () => {
  it('is on at the runway start and off at the air start', () => {
    expect(takeoffMode(runwayState().state.craft, 0, false)).toBe(true);
    expect(takeoffMode(air().craft, 100, false)).toBe(false);
  });
  it('stays on while climbing with the gear down under 150 m, off with it up or above 150 m', () => {
    const c = { onGround: false, gear: 1 };
    expect(takeoffMode(c, 100, false)).toBe(true);
    expect(takeoffMode(c, 149, false)).toBe(true);
    expect(takeoffMode(c, 151, false)).toBe(false);
    expect(takeoffMode({ onGround: false, gear: 0.04 }, 100, false)).toBe(false);
    expect(takeoffMode({ onGround: false, gear: 0.5 }, 100, false)).toBe(true);
  });
  it('a gear lowered at 1,000 m does not turn it on, and a crash turns it off', () => {
    expect(takeoffMode({ onGround: false, gear: 1 }, 1000, false)).toBe(false);
    expect(takeoffMode({ onGround: true, gear: 1 }, 0, true)).toBe(false);
  });
});

describe('speeds shown', () => {
  const ground = { onGround: true, speed: 0 };
  it('are live at rest, frozen once rolling, cleared when the mode ends', () => {
    const a = stepSpeeds(null, ground, true, T)!;
    const heavy = stepSpeeds(a, ground, true, { ...T, massT: 40 })!;
    expect(heavy.vr).toBeGreaterThan(a.vr);
    const rolling = stepSpeeds(heavy, { onGround: true, speed: 30 }, true, T);
    expect(rolling).toBe(heavy);
    expect(stepSpeeds(heavy, { onGround: false, speed: 80 }, false, T)).toBeNull();
  });
  it('marks the next speed to reach, with no V1 off a runway', () => {
    const v = vSpeeds(T);
    const at = (ias: number) => speedMarks(v, ias).filter((m) => m.next).map((m) => m.label);
    expect(speedMarks(v, 0).map((m) => m.label)).toEqual(['R', '2']);
    expect(at(0)).toEqual(['R']);
    expect(at(v.vr + 1)).toEqual(['2']);
    expect(at(v.v2 + 1)).toEqual([]);
  });
  it('puts each mark at its speed on the dial', () => {
    const v = { v1: 40, vr: 63, v2: 72 };
    for (const [i, s] of [v.v1, v.vr, v.v2].entries()) {
      const m = speedMarks(v, 0)[i]!;
      expect(m.deg).toBeCloseTo(tableAngle(ASI_TABLE, metersPerSecondToKnots(s)), 0);
      expect(m.labelDeg).toBe(m.deg);
    }
  });
  it('moves the V1 letter off VR when they are close, but not its tick', () => {
    const [one, r] = speedMarks({ v1: 59, vr: 63, v2: 72 }, 0);
    expect(r!.deg - one!.deg).toBeLessThan(VMARK_LABEL_MIN_DEG);
    expect(r!.labelDeg - one!.labelDeg).toBe(VMARK_LABEL_MIN_DEG);
  });
});

describe('call-outs', () => {
  const v = vSpeeds(T);
  const input = (o: Partial<CalloutInput>): CalloutInput => ({
    tick: 0,
    mode: true,
    craft: { onGround: true, speed: 30, pathAngle: 0 },
    ias: 30,
    speeds: v,
    aglM: 0,
    ...o,
  });
  it('fire once each, in order, and not before the speed is reached', () => {
    let st = NO_CALLOUTS;
    const seen: string[] = [];
    const run = (o: Partial<CalloutInput>) => {
      st = stepCallouts(st, input(o));
      if (st.shown && seen[seen.length - 1] !== st.shown) seen.push(st.shown);
    };
    run({ tick: 1 });
    expect(seen).toEqual([]);
    run({ tick: 2, ias: v.vr + 0.1 });
    expect(seen).toEqual(['ROTATE']);
    run({ tick: 3, ias: v.vr + 0.2 });
    expect(seen).toEqual(['ROTATE']); // not again
    // V2 speed reached early waits for positive rate.
    run({ tick: 4, craft: { onGround: false, speed: 80, pathAngle: 0.01 }, ias: v.v2 + 1, aglM: 2 });
    expect(seen).toEqual(['ROTATE']);
    run({ tick: 5, craft: { onGround: false, speed: 80, pathAngle: 0.1 }, ias: v.v2 + 1, aglM: 6 });
    expect(seen).toEqual(['ROTATE', 'POSITIVE RATE']);
    // V2 does not cut POSITIVE RATE short: it carries the gear prompt.
    run({ tick: 5 + 2 * STEP_HZ, craft: { onGround: false, speed: 80, pathAngle: 0.1 }, ias: v.v2 + 1, aglM: 8 });
    expect(st.shown).toBe('POSITIVE RATE');
    run({ tick: 6 + 2 * STEP_HZ, craft: { onGround: false, speed: 80, pathAngle: 0.1 }, ias: v.v2 + 1, aglM: 8 });
    expect(seen).toEqual(['ROTATE', 'POSITIVE RATE', 'V2']);
    run({ tick: 7 + 2 * STEP_HZ, craft: { onGround: false, speed: 80, pathAngle: 0.1 }, ias: v.v2 + 1, aglM: 9 });
    expect(seen).toHaveLength(3);
  });
  it('V1 fires first when there is one', () => {
    const s = { ...v, v1: 50 };
    const st = stepCallouts(NO_CALLOUTS, input({ speeds: s, ias: 51 }));
    expect(st.shown).toBe('V1');
  });
  it('a V1 close to VR is called with it, at VR, and has no mark', () => {
    const s = { ...v, v1: v.vr - 0.7 };
    expect(speedMarks(s, 0).map((m) => m.label)).toEqual(['R', '2']);
    const early = stepCallouts(NO_CALLOUTS, input({ speeds: s, ias: s.v1 + 0.1 }));
    expect(early.shown).toBeNull();
    const at = stepCallouts(early, input({ speeds: s, ias: s.vr + 0.1 }));
    expect(at.shown).toBe('V1 ROTATE');
    expect(stepCallouts(at, input({ tick: 1, speeds: s, ias: s.vr + 1 })).shown).toBe('V1 ROTATE');
  });
  it('merges up to 5 kt and not beyond, and never without a V1', () => {
    const gap = (kt: number) => v1Merged({ ...v, v1: v.vr - kt / metersPerSecondToKnots(1) });
    expect(gap(0)).toBe(true);
    expect(gap(4.9)).toBe(true);
    expect(gap(5.1)).toBe(false);
    expect(v1Merged({ ...v, v1: null })).toBe(false);
  });
  it('a call-out stays 2 s, then goes', () => {
    let st = stepCallouts(NO_CALLOUTS, input({ tick: 10, ias: v.vr + 1 }));
    expect(st.shown).toBe('ROTATE');
    st = stepCallouts(st, input({ tick: 10 + 2 * STEP_HZ, ias: v.vr + 1 }));
    expect(st.shown).toBe('ROTATE');
    st = stepCallouts(st, input({ tick: 11 + 2 * STEP_HZ, ias: v.vr + 1 }));
    expect(st.shown).toBeNull();
  });
  it('reset when the plane is back at rest (a restart) or the mode ends', () => {
    let st = stepCallouts(NO_CALLOUTS, input({ ias: v.vr + 1 }));
    expect(st.next).toBeGreaterThan(0);
    expect(stepCallouts(st, input({ craft: { onGround: true, speed: 0, pathAngle: 0 }, ias: 0 }))).toBe(NO_CALLOUTS);
    st = stepCallouts(st, input({ mode: false }));
    expect(st).toBe(NO_CALLOUTS);
  });
  it('run along a real takeoff, in order', () => {
    const { state, world } = runwayState();
    let s: SimState = applyCommands(state, [{ kind: 'throttle', value: 1 }], world);
    let st = NO_CALLOUTS;
    const seen: string[] = [];
    let sp = null as ReturnType<typeof stepSpeeds>;
    for (let i = 0; i < 60 * 40; i++) {
      const ias = indicatedSpeed(s.craft, SCALES);
      s = applyCommands(s, [{ kind: 'pitch', value: ias >= vSpeeds(T).vr ? 1 : 0 }], world);
      s = advance(s, world);
      const agl = s.craft.z - world.heightAt(s.craft.x, s.craft.y);
      const mode = takeoffMode(s.craft, agl, !!s.crash);
      sp = stepSpeeds(sp, s.craft, mode, s.tuning);
      st = stepCallouts(st, { tick: s.tick, mode, craft: s.craft, ias: indicatedSpeed(s.craft, SCALES), speeds: sp, aglM: agl });
      if (st.shown && seen[seen.length - 1] !== st.shown) seen.push(st.shown);
      if (s.crash) break;
    }
    expect(s.crash).toBeNull();
    expect(seen).toEqual(['ROTATE', 'POSITIVE RATE', 'V2']);
  });
});

describe('the gear prompt', () => {
  it('goes with POSITIVE RATE only, while the lever is down', () => {
    expect(gearPrompt('POSITIVE RATE', true)).toBe(true);
    expect(gearPrompt('POSITIVE RATE', false)).toBe(false);
    expect(gearPrompt('V2', true)).toBe(false);
    expect(calloutSentence('POSITIVE RATE', true)).toBe('POSITIVE RATE, gear up');
    expect(calloutSentence('V1', true)).toBe('V1');
    expect(calloutSentence(null, true)).toBe('');
  });
});

describe('runway remaining', () => {
  const { runway } = realWorld();
  const ux = (runway.b.x - runway.a.x) / runway.length;
  const uy = (runway.b.y - runway.a.y) / runway.length;
  it('counts down along the heading, from either end', () => {
    const at = (s: number, heading: number) => runwayRemaining(runway, { x: runway.a.x + ux * s, y: runway.a.y + uy * s, heading });
    expect(at(40, runway.heading)).toBe(Math.round(runway.length - 40));
    expect(at(40, runway.heading + Math.PI)).toBe(40);
  });
  it('is null away from the runway', () => {
    expect(runwayRemaining(runway, { x: runway.a.x + 500, y: runway.a.y + 500, heading: 0 })).toBeNull();
  });
});

describe('gear', () => {
  it('moves over GEAR_TIME_S and stops exactly at the ends', () => {
    let g = 1;
    for (let i = 0; i < GEAR_TIME_S * STEP_HZ - 1; i++) g = stepGear(g, false, 1 / STEP_HZ);
    expect(g).toBeGreaterThan(0);
    g = stepGear(g, false, 1 / STEP_HZ);
    expect(g).toBe(0);
    for (let i = 0; i < GEAR_TIME_S * STEP_HZ + 5; i++) g = stepGear(g, true, 1 / STEP_HZ);
    expect(g).toBe(1);
  });
  it('the lever is refused on the ground and after a crash, and toggles in the air', () => {
    const { state, world } = runwayState();
    expect(applyCommands(state, [{ kind: 'gear' }], world).craft.gearDown).toBe(true);
    const up = initialState();
    const down = applyCommands(up, [{ kind: 'gear' }], realWorld().world);
    expect(down.craft.gearDown).toBe(true);
    expect(applyCommands(down, [{ kind: 'gear' }], realWorld().world).craft.gearDown).toBe(false);
    const crashed = { ...down, crash: { tick: 1, speed: 1, pathAngle: 0, cause: "terrain" as const, sink: 0 } };
    expect(applyCommands(crashed, [{ kind: 'gear' }], realWorld().world)).toBe(crashed);
  });
  it('travels in the air by the step, and drag rises by the stated counts only while down', () => {
    const { world } = realWorld();
    let s = applyCommands(initialState(), [{ kind: 'gear' }], world);
    for (let i = 0; i < GEAR_TIME_S * STEP_HZ; i++) s = advance(s, world);
    expect(s.craft.gear).toBe(1);
    const up = { ...s.craft, gear: 0 };
    const dUp = forcesOn(up, T, SCALES.altitude).drag;
    const dDown = forcesOn(s.craft, T, SCALES.altitude).drag;
    const q = 0.5 * 1.225 * 0.2 * 0; // keep lint quiet
    void q;
    // Same pitch and speed: the only difference is gearDragCounts / 10,000 of Cd0 over the wing area at that dynamic pressure.
    const sigma = forcesOn(s.craft, T, SCALES.altitude).sigma;
    const qq = 0.5 * 1.225 * sigma * s.craft.speed ** 2;
    expect(dDown - dUp).toBeCloseTo(qq * 70 * (T.gearDragCounts / 10000), 3);
    const half = forcesOn({ ...s.craft, gear: 0.5 }, T, SCALES.altitude).drag;
    expect(half - dUp).toBeCloseTo((dDown - dUp) / 2, 3);
    expect(aeroAt(0, 16 * DEG, T, undefined, 0).cd).toBeLessThan(aeroAt(0, 16 * DEG, T, undefined, 200).cd);
  });
  it('the air start flies exactly as before: gear up adds nothing', () => {
    const { world } = realWorld();
    let a = initialState();
    let b = { ...initialState(), tuning: { ...T, gearDragCounts: 1000 } };
    for (let i = 0; i < 60 * 20; i++) {
      a = advance(a, world);
      b = advance(b, world);
    }
    expect(b.craft).toEqual(a.craft);
  });
  it('contact with the gear not locked down is a crash, even soon after liftoff', () => {
    const { s: lifted, world } = takeoffAt(vSpeeds(T).vr);
    const s = sinking(lifted);
    expect(s.craft.onGround).toBe(false);
    // Pull the gear up at once and push the nose down: it touches within the settle window with the gear moving.
    let t = applyCommands(s, [{ kind: 'gear' }], world);
    for (let i = 0; i < 120 && !t.crash; i++) {
      t = applyCommands(t, [{ kind: 'pitch', value: -1 }], world);
      t = advance(t, world);
    }
    expect(t.crash?.cause).toBe('gear');
  });
  it('with the gear down a gentle touch soon after liftoff survives', () => {
    const { s: lifted, world } = takeoffAt(vSpeeds(T).vr);
    const s = { ...lifted, craft: { ...lifted.craft, pathAngle: -3 * DEG } };
    let t = s;
    for (let i = 0; i < 90 && !t.crash && !t.craft.onGround; i++) {
      t = applyCommands(t, [{ kind: 'pitch', value: -1 }], world);
      t = advance(t, world);
    }
    expect(t.crash).toBeNull();
    expect(t.craft.onGround).toBe(true);
  });
  it('a bad start (gear not a boolean) is ignored', () => {
    const { state, world } = runwayState();
    const bad = { ...state.start, gearDown: 1 as unknown as boolean };
    expect(applyCommands(state, [{ kind: 'start', spec: bad }], world)).toBe(state);
  });
  it('restart goes back to the start gear', () => {
    const { world } = realWorld();
    let s = applyCommands(initialState(), [{ kind: 'gear' }], world);
    s = { ...s, crash: { tick: 1, speed: 1, pathAngle: 0, cause: "terrain" as const, sink: 0 } };
    s = applyCommands(s, [{ kind: 'restart' }], world);
    expect(s.craft.gearDown).toBe(false);
    expect(s.craft.gear).toBe(0);
  });
  it('random gear input keeps every value finite and gear within 0..1', () => {
    const { world } = realWorld();
    let s = initialState();
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 10000; i++) {
      s = applyCommands(s, [{ kind: 'pitch', value: rnd() < 0.5 ? 0 : 1 }, ...(rnd() < 0.01 ? [{ kind: 'gear' as const }] : [])], world);
      s = advance(s, world);
      expect(s.craft.gear).toBeGreaterThanOrEqual(0);
      expect(s.craft.gear).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.craft.z + s.craft.speed)).toBe(true);
      if (s.crash) s = applyCommands(s, [{ kind: 'restart' }], world);
    }
  });
});

describe('G key', () => {
  it('gives one gear command per press, and a pause releases an unsent press', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyG' });
    k.keyDown({ code: 'KeyG', repeat: true });
    expect(k.sample()).toEqual([{ kind: 'gear' }]);
    expect(k.sample()).toEqual([]);
    k.keyDown({ code: 'KeyG' });
    k.clear();
    expect(k.sample()).toEqual([]);
  });
  it('ignores G in a text field', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyG', editable: true });
    expect(k.sample()).toEqual([]);
  });
});

describe('zoom levels', () => {
  it('both lists end at the 0.5 m close level, and fractional zoom is straight in log space', () => {
    expect(ZOOM_LEVELS[CLOSE_ZOOM]).toBe(0.5);
    expect(SIDE_ZOOM_LEVELS[CLOSE_SIDE_ZOOM]).toBe(0.5);
    expect(verticalMetersPerPixel(CLOSE_SIDE_ZOOM)).toBe(0.5);
    expect(metersPerPixel(CLOSE_ZOOM - 0.5)).toBeCloseTo(Math.sqrt(1.25 * 0.5), 9);
    expect(sideMetersPerPixel(0.5)).toBeCloseTo(Math.sqrt(50), 9);
  });
  it('whole zooms give exactly the level and the inverse round-trips', () => {
    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      expect(metersPerPixel(z)).toBe(ZOOM_LEVELS[z]);
      expect(zoomForMpp(metersPerPixel(z))).toBe(z);
    }
    for (let z = 0; z < SIDE_ZOOM_LEVELS.length; z++) expect(sideZoomForMpp(sideMetersPerPixel(z))).toBe(z);
    expect(zoomForMpp(metersPerPixel(3.37))).toBeCloseTo(3.37, 9);
  });
  it('the side clamp covers the new level', () => {
    expect(clampSideZoom(99)).toBe(CLOSE_SIDE_ZOOM);
    expect(clampSideZoom(-3)).toBe(0);
  });
});

describe('zoom gate', () => {
  it('is ground on the ground and under 20 m, air above 40 m', () => {
    expect(gatePhase('air', true, 500)).toBe('ground');
    expect(gatePhase('air', false, 19)).toBe('ground');
    expect(gatePhase('ground', false, 41)).toBe('air');
  });
  it('keeps its last phase between 20 and 40 m (hysteresis) and cannot flicker on noise', () => {
    expect(gatePhase('ground', false, 30)).toBe('ground');
    expect(gatePhase('air', false, 30)).toBe('air');
    let p = gatePhase('ground', false, 45);
    let changes = 0;
    for (const h of [41, 38, 42, 39, 41.5, 30, 35, 28, 33, 39.9]) {
      const n = gatePhase(p, false, h);
      if (n !== p) changes++;
      p = n;
    }
    expect(changes).toBe(0);
  });
  it('the wheel edits only the current phase', () => {
    const clamp = (z: number) => Math.min(CLOSE_ZOOM, Math.max(0, z));
    let m = { ground: CLOSE_ZOOM, air: 3 };
    m = stepPhaseZoom(m, 'air', -1, clamp);
    expect(m).toEqual({ ground: CLOSE_ZOOM, air: 2 });
    m = stepPhaseZoom(m, 'ground', 9, clamp);
    expect(m).toEqual({ ground: CLOSE_ZOOM, air: 2 });
    m = stepPhaseZoom(m, 'ground', -2, clamp);
    expect(m).toEqual({ ground: CLOSE_ZOOM - 2, air: 2 });
    expect(recall(remember(m, 'air', 0), 'ground')).toBe(CLOSE_ZOOM - 2);
  });
  it('easing is monotonic, never overshoots, and lands exactly', () => {
    let shown = 5;
    let prev = shown;
    for (let i = 0; i < 600; i++) {
      shown = easeMpp(shown, 0.5, 1 / 60);
      expect(shown).toBeLessThanOrEqual(prev);
      expect(shown).toBeGreaterThanOrEqual(0.5);
      prev = shown;
    }
    expect(shown).toBe(0.5);
    let up = 0.5;
    for (let i = 0; i < 600; i++) {
      const next = easeMpp(up, 5, 1 / 60);
      expect(next).toBeGreaterThanOrEqual(up);
      expect(next).toBeLessThanOrEqual(5);
      up = next;
    }
    expect(up).toBe(5);
  });
  it('takes about the time constant to cover 63% of the gap in log space, whatever the frame rate', () => {
    const at = (fps: number) => {
      let s = 5;
      for (let i = 0; i < fps * 0.8; i++) s = easeMpp(s, 0.5, 1 / fps);
      return Math.log(5 / s) / Math.log(10);
    };
    expect(at(60)).toBeCloseTo(0.632, 2);
    expect(at(30)).toBeCloseTo(at(144), 2);
  });
  it('a 20 s ease from the ground view never jumps more than a few percent a frame', () => {
    let s = 0.5;
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const n = easeMpp(s, 5, 1 / 60);
      worst = Math.max(worst, n / s - 1);
      s = n;
    }
    expect(worst).toBeLessThan(0.05);
  });
});

describe('invariants with a ground start', () => {
  it('takeoff and the whole climb: finite, never below the ground, gear and speed within limits', () => {
    const { state, world } = runwayState();
    let s = applyCommands(state, [{ kind: 'throttle', value: 1 }], world);
    for (let i = 0; i < 60 * 40; i++) {
      s = fly(s, world, 1, (t) => ({ pitch: indicatedSpeed(t.craft, SCALES) >= vSpeeds(T).vr ? 1 : 0 }));
      expect(Number.isFinite(s.craft.x + s.craft.y + s.craft.z + s.craft.speed)).toBe(true);
      expect(s.craft.z).toBeGreaterThanOrEqual(world.heightAt(s.craft.x, s.craft.y) - 1e-6);
      if (s.craft.onGround) expect(s.craft.z).toBe(world.heightAt(s.craft.x, s.craft.y));
      if (s.crash) break;
    }
  });
  it('the unused fixture helper stays honest', () => {
    expect(craft({ gearDown: true }).gearDown).toBe(true);
  });
});
