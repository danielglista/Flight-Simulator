import { describe, expect, it } from 'vitest';
import { stallState } from '../src/sim/flight/aero';
import { landed } from '../src/sim/flight/ground';
import { trimAt } from '../src/sim/flight/trim';
import { vSpeeds } from '../src/sim/flight/vspeeds';
import type { Command } from '../src/sim/commands';
import type { SimState } from '../src/sim/state';
import { advance, applyCommands } from '../src/sim/step';
import { SCALES } from '../src/config/scales';
import { realWorld, runwayState } from './helpers';

const DEG = Math.PI / 180;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Phase = 'roll' | 'climb' | 'circuit' | 'final' | 'rollout';

/** A scripted pilot: keys only, as a person would use them. Runway-frame waypoints (s along, c to the left). */
function createPilot() {
  const { world, runway } = realWorld();
  const ux = (runway.b.x - runway.a.x) / runway.length;
  const uy = (runway.b.y - runway.a.y) / runway.length;
  const frame = (x: number, y: number) => ({ s: (x - runway.a.x) * ux + (y - runway.a.y) * uy, c: -(x - runway.a.x) * uy + (y - runway.a.y) * ux });
  const at = (s: number, c: number) => ({ x: runway.a.x + ux * s - uy * c, y: runway.a.y + uy * s + ux * c });
  const z0 = world.heightAt(runway.a.x, runway.a.y);
  const CRUISE_AGL = 100;
  const legs = [at(1500, 0), at(1500, 1500), at(-1300, 1500), at(-1300, 0)];
  const SWITCH_M = 500;
  const BANK_LIMIT = 35 * DEG;
  let phase: Phase = 'roll';
  let leg = 0;
  let gearRaised = false;
  const log: Phase[] = [];

  const bearing = (s: SimState, p: { x: number; y: number }): number => wrap(Math.atan2(p.x - s.craft.x, p.y - s.craft.y) - s.craft.heading);

  function step(s: SimState): Command[] {
    const cr = s.craft;
    // A banked wing carries 1/cos(bank) of the weight: trim as if the plane were that much heavier.
    const loaded = { ...s.tuning, massT: s.tuning.massT / Math.cos(cr.bank) };
    const agl = cr.z - world.heightAt(cr.x, cr.y);
    const f = frame(cr.x, cr.y);
    const out: Command[] = [];
    let throttleTo = 0.5;
    let pathTarget = 0;
    let turnErr = 0;
    let pitchKey: -1 | 0 | 1 | null = null;
    let brake = false;
    let speedT = 80;
    let gearCounts = 0;

    if (phase === 'roll') {
      throttleTo = 1;
      turnErr = bearing(s, at(f.s + 250, 0));
      pitchKey = cr.speed >= vSpeeds(s.tuning).vr && cr.pitch < 9 * DEG ? 1 : 0;
      if (!cr.onGround) phase = 'climb';
    } else if (phase === 'climb') {
      throttleTo = 0.9;
      pathTarget = 6 * DEG;
      gearCounts = s.tuning.gearDragCounts * cr.gear;
      turnErr = bearing(s, at(f.s + 300, 0));
      if (!gearRaised && agl > 8 && cr.pathAngle > 0) {
        out.push({ kind: 'gear' });
        gearRaised = true;
      }
      if (cr.z - z0 >= CRUISE_AGL * 0.85) phase = 'circuit';
    }
    // Gear down on the base leg.
    if (phase === 'circuit' && leg >= 2 && !cr.gearDown) out.push({ kind: 'gear' });
    if (phase === 'circuit') {
      const w = legs[leg]!;
      if (Math.hypot(w.x - cr.x, w.y - cr.y) < SWITCH_M) leg++;
      if (leg >= legs.length) {
        phase = 'final';
        leg = 0;
      } else {
        turnErr = bearing(s, legs[leg]!);
        const want = z0 + (leg === 3 ? 75 : CRUISE_AGL);
        pathTarget = clamp((want - cr.z) * 0.01, -2.5 * DEG, 4 * DEG);
        throttleTo = clamp(trimAt(speedT, pathTarget, cr.z, SCALES.altitude, loaded).lever + 0.04 * (speedT - cr.speed), 0.05, 1);
      }
    }
    if (phase === 'final') {
      speedT = 72;
      gearCounts = s.tuning.gearDragCounts;
      const lateral = clamp(f.c, -400, 400);
      turnErr = bearing(s, at(f.s + 150 + Math.abs(lateral) * 0.5, 0));
      const want = z0 + Math.max(0, (150 - f.s) * Math.tan(3 * DEG));
      pathTarget = clamp(-3 * DEG + (want - cr.z) * 0.003, -4.5 * DEG, -1.5 * DEG);
      throttleTo = clamp(trimAt(speedT, pathTarget, cr.z, SCALES.altitude, loaded, gearCounts).lever + 0.05 * (speedT - cr.speed), 0, 1);
      if (agl < 14) {
        pathTarget = -(0.3 + (clamp(agl, 0, 14) / 14) * 2.2) * DEG;
        if (agl < 10) throttleTo = 0;
      }
      if (cr.onGround) phase = 'rollout';
    }
    if (phase === 'rollout') {
      throttleTo = 0;
      brake = true;
      turnErr = bearing(s, at(f.s + 150, 0));
      pitchKey = cr.pitch > 1 * DEG ? -1 : 0;
    }

    // Keys from the targets.
    const desiredBank = clamp(turnErr * 1.5, -BANK_LIMIT, BANK_LIMIT);
    let turn: -1 | 0 | 1 = 0;
    if (cr.onGround) turn = turnErr > 0.7 * DEG ? 1 : turnErr < -0.7 * DEG ? -1 : 0;
    else turn = cr.bank < desiredBank - 2 * DEG ? 1 : cr.bank > desiredBank + 2 * DEG ? -1 : 0;
    let pitch: -1 | 0 | 1 = 0;
    if (pitchKey !== null) pitch = pitchKey;
    else {
      const target = trimAt(Math.max(cr.speed, 40), pathTarget, cr.z, SCALES.altitude, loaded, gearCounts).pitch;
      const predicted = cr.pitch + cr.pitchRate * 0.4;
      pitch = predicted < target - 0.3 * DEG ? 1 : predicted > target + 0.3 * DEG ? -1 : 0;
    }
    const throttle: -1 | 0 | 1 = cr.lever < throttleTo - 0.02 ? 1 : cr.lever > throttleTo + 0.02 ? -1 : 0;
    out.push({ kind: 'turn', value: turn }, { kind: 'pitch', value: pitch }, { kind: 'throttle', value: throttle }, { kind: 'brake', value: brake });
    log.push(phase);
    return out;
  }
  return { step, world, runway, z0, get phase() { return phase; }, frame };
}

describe('the circuit', () => {
  it('takeoff 07, a left circuit, landing and a stop on the runway', () => {
    const pilot = createPilot();
    let { state: s } = runwayState();
    let tooLow = Infinity;
    let stalledSeen = false;
    let touchdownAt: { s: number; sink: number } | null = null;
    let steps = 0;
    for (; steps < 60 * 360 && !s.crash && !landed(s); steps++) {
      s = applyCommands(s, pilot.step(s), pilot.world);
      s = advance(s, pilot.world);
      if (!s.craft.onGround) tooLow = Math.min(tooLow, s.craft.z - pilot.world.heightAt(s.craft.x, s.craft.y));
      if (stallState(s.craft, s.tuning) === 'stalled') stalledSeen = true;
      if (s.touchdown && !touchdownAt) touchdownAt = { s: pilot.frame(s.touchdown.x, s.touchdown.y).s, sink: s.touchdown.sink };
    }
    expect(s.crash, `crash ${JSON.stringify(s.crash)} phase ${pilot.phase} at ${steps / 60}s`).toBeNull();
    expect(stalledSeen).toBe(false);
    expect(landed(s), `phase ${pilot.phase} at ${steps / 60}s speed ${s.craft.speed}`).toBe(true);
    expect(steps / 60).toBeLessThan(360);
    const end = pilot.frame(s.craft.x, s.craft.y);
    expect(end.s).toBeGreaterThan(0);
    expect(end.s).toBeLessThan(pilot.runway.length);
    expect(Math.abs(end.c)).toBeLessThan(pilot.runway.width / 2);
    expect(touchdownAt?.sink ?? 99).toBeLessThan(5);
    expect(tooLow).toBeGreaterThan(0);
  }, 60000);
});
