import { AP_IAS_MAX, AP_IAS_MIN, STABLE_TICKS } from '../config/flight';
import { CEILING_Z, PLACE_CLEARANCE, TUNING_RANGES } from '../config/motion';
import { wrapHeading } from './angles';
import type { Command } from './commands';
import { stepAir } from './flight/air';
import { autopilotOutput } from './flight/autopilot';
import { stability } from './flight/stability';
import { densityRatio } from './flight/forces';
import { landed, stepGround } from './flight/ground';
import { AIR_START, AUTOPILOT_OFF, apActive, craftAt, type Autopilot, type Axis, type Craft, type FlapLever, type SimState, type StartSpec } from './state';
import type { GroundKind } from './world/groundKind';
import { setHold, setTime } from './sun';
import { topOf, type ObstacleFn } from './world/obstacles';

/** The world as the simulation sees it: the map size and the top surface. */
export interface SimWorld {
  readonly width: number;
  readonly height: number;
  /** Top surface: water or ground, world m. */
  heightAt(x: number, y: number): number;
  /** Real meters of altitude per world meter; air density needs real height. */
  readonly altitudeScale: number;
  /** What the wheels would roll on at a point. `rough` is always a crash. */
  groundKind(x: number, y: number): GroundKind;
  /** Buildings to hit; absent in a world without any. */
  readonly obstacleAt?: ObstacleFn;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function toAxis(v: number): Axis | null {
  return v === -1 || v === 0 || v === 1 ? v : null;
}

/** A start with its position kept on the map, or null when any number is not finite. */
function cleanStart(s: StartSpec, world: SimWorld): StartSpec | null {
  const nums = [s.x, s.y, s.z, s.heading, s.speed, s.pathAngle, s.pitch, s.lever, s.spool];
  if (!nums.every(Number.isFinite) || typeof s.onGround !== 'boolean' || typeof s.gearDown !== 'boolean' || ![0, 1, 2].includes(s.flapLever)) return null;
  return {
    ...s,
    x: clamp(s.x, 0, world.width),
    y: clamp(s.y, 0, world.height),
    heading: wrapHeading(s.heading),
    speed: clamp(s.speed, 0, 300),
    lever: clamp(s.lever, 0, 1),
    spool: clamp(s.spool, 0, 1),
  };
}

type ApModes = Partial<Pick<Autopilot, 'hdg' | 'alt' | 'spd'>>;
/** The same autopilot when nothing changes. */
const withModes = (a: Autopilot, m: ApModes): Autopilot =>
  (m.hdg ?? a.hdg) === a.hdg && (m.alt ?? a.alt) === a.alt && (m.spd ?? a.spd) === a.spd ? a : { ...a, ...m };
const ALL_OFF: ApModes = { hdg: false, alt: false, spd: false };
const currentIas = (craft: Craft, world: SimWorld): number => clamp(craft.speed * Math.sqrt(densityRatio(craft.z, world.altitudeScale)), AP_IAS_MIN, AP_IAS_MAX);
/** Everything off, targets and the notice cleared; a crash, restart, start, place or pointer rotate does this. */
const autopilotCleared = (a: Autopilot): Autopilot => (a === AUTOPILOT_OFF || (!apActive(a) && a.notice === null) ? a : AUTOPILOT_OFF);

const startCraft = (s: StartSpec, world: SimWorld): Craft => craftAt(s, world.heightAt(s.x, s.y));

/** Applies commands at the current tick. Time and tick do not change. */
export function applyCommands(state: SimState, commands: readonly Command[], world: SimWorld): SimState {
  let { craft, controls, crash, tuning, start, liftoffTick, touchdown, autopilot, stableTicks, sunClock } = state;
  for (const c of commands) {
    switch (c.kind) {
      case 'turn':
      case 'throttle':
      case 'pitch': {
        const v = toAxis(c.value);
        if (v !== null) {
          controls = { ...controls, [c.kind]: v, ...(c.kind === 'turn' && v !== 0 ? { level: false } : {}) };
          // The player's hand overrides only its own mode: roll drops heading, pitch altitude, throttle speed.
          if (v !== 0) autopilot = withModes(autopilot, c.kind === 'turn' ? { hdg: false } : c.kind === 'pitch' ? { alt: false } : { spd: false });
        }
        break;
      }
      case 'level':
        // Ignored on the ground, where there is no bank to level.
        if (!controls.level && !craft.onGround) controls = { ...controls, level: true };
        autopilot = withModes(autopilot, { hdg: false });
        break;
      case 'autopilot': {
        if (!c.on) {
          autopilot = withModes(autopilot, ALL_OFF);
        } else {
          const s = stability({ craft, crash, tuning }, world);
          const keyHeld = controls.turn !== 0 || controls.pitch !== 0 || controls.throttle !== 0 || controls.level;
          const reason = s.reason ?? (keyHeld ? 'controls' : stableTicks < STABLE_TICKS ? 'UNSETTLED' : null);
          if (reason) autopilot = { ...autopilot, notice: { tick: state.tick, kind: 'refused', reason } };
          else {
            autopilot = {
              ...autopilot,
              hdg: true,
              alt: true,
              spd: true,
              headingTarget: wrapHeading(craft.heading),
              targetZ: clamp(craft.z, 0, CEILING_Z),
              targetIas: autopilot.spd ? autopilot.targetIas : currentIas(craft, world),
              notice: null,
            };
          }
        }
        break;
      }
      case 'apMode': {
        if (!c.on) {
          autopilot = withModes(autopilot, { [c.mode]: false });
        } else if (c.mode === 'spd') {
          if (!craft.onGround && !crash && !autopilot.spd) autopilot = { ...autopilot, spd: true, targetIas: currentIas(craft, world) };
        } else if (!autopilot[c.mode]) {
          const s = stability({ craft, crash, tuning }, world);
          const keyHeld = c.mode === 'hdg' ? controls.turn !== 0 || controls.level : controls.pitch !== 0;
          const reason = s.reason ?? (keyHeld ? 'controls' : stableTicks < STABLE_TICKS ? 'UNSETTLED' : null);
          if (reason) autopilot = { ...autopilot, notice: { tick: state.tick, kind: 'refused', reason } };
          else if (c.mode === 'alt') autopilot = { ...autopilot, alt: true, targetZ: clamp(craft.z, 0, CEILING_Z), notice: null };
          else autopilot = { ...autopilot, hdg: true, headingTarget: wrapHeading(craft.heading), notice: null };
        }
        break;
      }
      case 'apTarget': {
        let next = autopilot;
        if (next.hdg && c.heading !== undefined && Number.isFinite(c.heading)) next = { ...next, headingTarget: wrapHeading(c.heading) };
        if (next.alt && c.z !== undefined && Number.isFinite(c.z)) next = { ...next, targetZ: clamp(c.z, 0, CEILING_Z) };
        if (next.spd && c.ias !== undefined && Number.isFinite(c.ias)) next = { ...next, targetIas: clamp(c.ias, AP_IAS_MIN, AP_IAS_MAX) };
        autopilot = next;
        break;
      }
      case 'brake':
        if (typeof c.value === 'boolean' && controls.brake !== c.value) controls = { ...controls, brake: c.value };
        break;
      case 'gear':
        // The lever is refused on the ground and once crashed.
        if (!craft.onGround && !crash) craft = { ...craft, gearDown: !craft.gearDown };
        break;
      case 'flaps':
        if (!crash && (c.by === 1 || c.by === -1)) {
          const lever = Math.min(2, Math.max(0, craft.flapLever + c.by)) as FlapLever;
          if (lever !== craft.flapLever) craft = { ...craft, flapLever: lever };
        }
        break;
      case 'place':
        if (!crash && Number.isFinite(c.x) && Number.isFinite(c.y)) {
          const x = clamp(c.x, 0, world.width);
          const y = clamp(c.y, 0, world.height);
          const z = Math.max(craft.z, topOf(world.heightAt, world.obstacleAt, x, y) + PLACE_CLEARANCE);
          // From the ground the plane is also given the air start's speed and trim, or it would fall at walking speed.
          craft = craft.onGround
            ? {
                ...craft,
                x,
                y,
                z,
                onGround: false,
                speed: AIR_START.speed,
                pathAngle: 0,
                pitch: AIR_START.pitch,
                pitchRate: 0,
                pitchHold: 0,
                bank: 0,
                rollRate: 0,
                lever: AIR_START.lever,
                spool: AIR_START.spool,
                gearDown: AIR_START.gearDown,
                gear: AIR_START.gearDown ? 1 : 0,
                flapLever: AIR_START.flapLever,
                flaps: AIR_START.flapLever / 2,
              }
            : { ...craft, x, y, z };
          if (state.craft.onGround) liftoffTick = null;
          autopilot = autopilotCleared(autopilot);
          stableTicks = 0;
        }
        break;
      case 'rotate':
        if (!crash && Number.isFinite(c.by)) {
          craft = { ...craft, heading: wrapHeading(craft.heading + c.by) };
          autopilot = autopilotCleared(autopilot);
          stableTicks = 0;
        }
        break;
      case 'sunTime':
        if (Number.isFinite(c.value)) sunClock = setTime(sunClock, state.tick, Math.round(c.value));
        break;
      case 'sunHold':
        if (typeof c.value === 'boolean') sunClock = setHold(sunClock, state.tick, c.value);
        break;
      case 'tune': {
        const range = Object.hasOwn(TUNING_RANGES, c.key) ? TUNING_RANGES[c.key] : undefined;
        if (range && Number.isFinite(c.value)) {
          const value = clamp(c.value, range.min, range.max);
          if (tuning[c.key] !== value) tuning = { ...tuning, [c.key]: value };
        }
        break;
      }
      case 'restart':
        if (crash || landed({ touchdown, craft, crash })) {
          craft = startCraft(start, world);
          crash = null;
          liftoffTick = null;
          touchdown = null;
          autopilot = autopilotCleared(autopilot);
          stableTicks = 0;
          if (controls.level) controls = { ...controls, level: false };
        }
        break;
      case 'start': {
        const s = cleanStart(c.spec, world);
        if (s) {
          start = s;
          craft = startCraft(s, world);
          crash = null;
          liftoffTick = null;
          touchdown = null;
          autopilot = autopilotCleared(autopilot);
          stableTicks = 0;
          if (controls.level) controls = { ...controls, level: false };
        }
        break;
      }
    }
  }
  if (craft === state.craft && controls === state.controls && crash === state.crash && tuning === state.tuning && start === state.start && liftoffTick === state.liftoffTick && touchdown === state.touchdown && autopilot === state.autopilot && stableTicks === state.stableTicks && sunClock === state.sunClock) {
    return state;
  }
  return { ...state, craft, controls, crash, tuning, start, liftoffTick, touchdown, autopilot, stableTicks, sunClock };
}

/**
 * Exactly one 1/60 s step: the ground step on the wheels, the air step otherwise. Once crashed, only the tick moves.
 * Stability is judged once, before the flight step: it counts the settled steps, and past the danger limits the
 * autopilot lets go (with a notice). The control law then flies the axes that are on.
 */
export function advance(state: SimState, world: SimWorld): SimState {
  if (state.crash) return { ...state, tick: state.tick + 1 };
  const s = judge(state, world);
  const ap = s.autopilot;
  if (s.craft.onGround) return stepGround(s, world);
  const out = apActive(ap) ? autopilotOutput(s.craft, ap, s.tuning, world.altitudeScale) : null;
  const next = stepAir(s, world, out);
  // A crash or touchdown ends it, with no notice: the player knows.
  if ((next.crash || next.craft.onGround) && apActive(next.autopilot)) return { ...next, autopilot: AUTOPILOT_OFF, stableTicks: 0 };
  return next;
}

/** Counts the settled steps and lets go on danger. Returns the same state when nothing changed. */
function judge(state: SimState, world: SimWorld): SimState {
  const ap = state.autopilot;
  if (state.craft.onGround && !apActive(ap) && state.stableTicks === 0) return state;
  const st = stability(state, world);
  const stableTicks = st.stable ? state.stableTicks + 1 : 0;
  const dropped = st.danger && apActive(ap);
  if (!dropped && stableTicks === state.stableTicks) return state;
  const autopilot: Autopilot = dropped
    ? { ...ap, ...ALL_OFF, notice: { tick: state.tick, kind: 'dropped', reason: st.dangerReason ?? 'GROUND' } }
    : ap;
  return { ...state, autopilot, stableTicks };
}
