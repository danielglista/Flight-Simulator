import { SCALES } from '../src/config/scales';
import { STABLE_TICKS } from '../src/config/flight';
import type { Command } from '../src/sim/commands';
import { indicatedSpeed } from '../src/sim/units';
import { advance, applyCommands, type SimWorld } from '../src/sim/step';
import { AIR_START, initialState, type SimState, type StartSpec } from '../src/sim/state';

export const flat: SimWorld = {
  width: 100000,
  height: 100000,
  heightAt: () => 0,
  altitudeScale: SCALES.altitude,
  groundKind: () => 'rough',
};

export const ftToZ = (ft: number): number => (ft * 0.3048) / SCALES.altitude;
export const zToFt = (z: number): number => (z * SCALES.altitude) / 0.3048;
export const DEG = Math.PI / 180;

export function steps(s: SimState, n: number, world: SimWorld = flat, each?: (s: SimState, i: number) => void): SimState {
  for (let i = 0; i < n; i++) {
    s = advance(s, world);
    each?.(s, i);
  }
  return s;
}

/** An air start at level trim, settled long enough to engage. */
export function settled(patch: Partial<StartSpec> = {}, world: SimWorld = flat): SimState {
  return steps(initialState({ ...AIR_START, ...patch }), STABLE_TICKS + 2, world);
}

export const send = (s: SimState, cmds: Command[], world: SimWorld = flat): SimState => applyCommands(s, cmds, world);

/** Engages, then dials in a heading (degrees) and displayed altitude (ft). */
export function engage(s: SimState, headingDeg: number, ft: number, world: SimWorld = flat): SimState {
  return send(s, [{ kind: 'autopilot', on: true }, { kind: 'apTarget', heading: headingDeg * DEG, z: ftToZ(ft) }], world);
}

export const ias = (s: SimState): number => indicatedSpeed(s.craft, SCALES);
export const altFt = (s: SimState): number => zToFt(s.craft.z);
