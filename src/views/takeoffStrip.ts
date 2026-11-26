import { CALLOUT_HOLD_S, GEAR_UP_AT, POSITIVE_RATE_AGL_M, TAKEOFF_HUD_AGL_M, VSPEED_FREEZE_MS } from '../config/display';
import type { Tuning } from '../config/motion';
import { STEP_HZ } from '../config/motion';
import { SPOOL_STABLE } from '../config/flight';
import { vSpeeds, type VSpeeds } from '../sim/flight/vspeeds';
import type { Craft } from '../sim/state';
import { runwayFrame, type Runway } from '../sim/world/airport';
import { v1Merged, type SpeedMark } from './gauges/airspeed';
import { drawText } from './overlay';

/**
 * Takeoff HUD mode, from the sim state alone (no stored phase): on the ground, or airborne under TAKEOFF_HUD_AGL_M
 * with the gear not up. The gear is the signal, so raising it (or climbing past the limit) ends the mode, and a gear
 * lowered in cruise never starts it. `aglM` is world m above the ground.
 */
export function takeoffMode(craft: Pick<Craft, 'onGround' | 'gear'>, aglM: number, crashed: boolean): boolean {
  if (crashed) return false;
  if (craft.onGround) return true;
  return aglM < TAKEOFF_HUD_AGL_M && craft.gear > GEAR_UP_AT;
}

/**
 * The speeds shown: live while at rest on the ground (so the mass slider or a restart updates them), frozen once the
 * roll starts, and cleared when takeoff mode ends. Entering the mode in the air computes them once.
 */
export function stepSpeeds(prev: VSpeeds | null, craft: Pick<Craft, 'onGround' | 'speed'> & { readonly flaps?: number }, mode: boolean, tuning: Tuning, runwayM: number | null = null): VSpeeds | null {
  if (!mode) return null;
  if (craft.onGround && craft.speed < VSPEED_FREEZE_MS) return vSpeeds(tuning, runwayM, craft.flaps ?? 0);
  return prev ?? vSpeeds(tuning, runwayM, craft.flaps ?? 0);
}

type CalloutStep = 'V1' | 'ROTATE' | 'POSITIVE RATE' | 'V2';
/** What is called out: a step of the takeoff, or V1 and ROTATE as one when the speeds are close. */
export type Callout = CalloutStep | 'V1 ROTATE' | 'STABLE';
const SEQUENCE: readonly CalloutStep[] = ['V1', 'ROTATE', 'POSITIVE RATE', 'V2'];

/** How far through the call-outs a takeoff is, and what is on screen. View state; the sim emits nothing. */
export interface CalloutState {
  /** Index into the sequence of the next call-out to fire. */
  readonly next: number;
  readonly shown: Callout | null;
  /** Tick it was shown at. */
  readonly shownTick: number;
  /** STABLE has been called. */
  readonly stable: boolean;
}

export const NO_CALLOUTS: CalloutState = { next: 0, shown: null, shownTick: 0, stable: false };

export interface CalloutInput {
  readonly tick: number;
  readonly mode: boolean;
  readonly craft: Pick<Craft, 'onGround' | 'speed' | 'pathAngle'> & { readonly spool?: number };
  /** Indicated airspeed, m/s. */
  readonly ias: number;
  readonly speeds: VSpeeds | null;
  /** Height above ground, world m. */
  readonly aglM: number;
}

const reached = (c: CalloutStep, i: CalloutInput, s: VSpeeds): boolean => {
  switch (c) {
    case 'V1':
      return s.v1 !== null && i.ias >= s.v1;
    case 'ROTATE':
      return i.ias >= s.vr;
    case 'POSITIVE RATE':
      return !i.craft.onGround && i.aglM >= POSITIVE_RATE_AGL_M && i.craft.pathAngle > 0;
    case 'V2':
      return !i.craft.onGround && i.ias >= s.v2;
  }
};

/**
 * One tick of the call-outs. Each fires once per takeoff, in order, and only after its condition holds. V1 is skipped
 * while there is no V1, and joins ROTATE when the two are close. Nothing cuts POSITIVE RATE short, since it carries the
 * gear prompt: V2 waits for it to end. STABLE comes before them, when the engine passes SPOOL_STABLE on the ground,
 * moving or not. A restart (at rest on the ground, engine below that) or the end of takeoff mode starts them over.
 */
export function stepCallouts(prev: CalloutState, i: CalloutInput): CalloutState {
  const atRest = i.craft.onGround && i.craft.speed < VSPEED_FREEZE_MS;
  const spooled = (i.craft.spool ?? 0) >= SPOOL_STABLE;
  if (!i.mode || !i.speeds || (atRest && !spooled)) return NO_CALLOUTS;
  let { next, shown, shownTick, stable } = prev;
  if (shown && i.tick - shownTick > CALLOUT_HOLD_S * STEP_HZ) shown = null;
  if (!stable && next === 0 && i.craft.onGround && spooled) return { next, shown: 'STABLE', shownTick: i.tick, stable: true };
  const merged = v1Merged(i.speeds);
  while (next < SEQUENCE.length && SEQUENCE[next] === 'V1' && (i.speeds.v1 === null || merged)) next++;
  const c = SEQUENCE[next];
  if (!atRest && c && shown !== 'POSITIVE RATE' && reached(c, i, i.speeds)) {
    shown = c === 'ROTATE' && merged ? 'V1 ROTATE' : c;
    shownTick = i.tick;
    next++;
  }
  return next === prev.next && shown === prev.shown && shownTick === prev.shownTick ? prev : { next, shown, shownTick, stable };
}

/** Meters of runway ahead of the plane along its heading, or null when it is not over the runway. */
export function runwayRemaining(rw: Runway, craft: Pick<Craft, 'x' | 'y' | 'heading'>): number | null {
  const { along, across } = runwayFrame(rw, craft.x, craft.y);
  if (Math.abs(across) > rw.width || along < -rw.width || along > rw.length + rw.width) return null;
  const ux = (rw.b.x - rw.a.x) / rw.length;
  const uy = (rw.b.y - rw.a.y) / rw.length;
  const forward = Math.sin(craft.heading) * ux + Math.cos(craft.heading) * uy >= 0;
  return Math.max(0, Math.round(forward ? rw.length - along : along));
}

/** `runwayRemaining` on whichever runway the plane is over, or null off all of them. */
export function remainingOnAny(runways: readonly Runway[], craft: Pick<Craft, 'x' | 'y' | 'heading'>): number | null {
  for (const rw of runways) {
    const m = runwayRemaining(rw, craft);
    if (m !== null) return m;
  }
  return null;
}

/** The takeoff cues while takeoff mode is on: marks and call-outs go to the instruments panel, runway left to the side view. */
export interface TakeoffHud {
  readonly marks: readonly SpeedMark[];
  /** Meters of runway left, or null off the runway. */
  readonly remaining: number | null;
  readonly callout: Callout | null;
}

/** Runway left, top center of the side view. */
export function drawRunwayRemaining(ctx: CanvasRenderingContext2D, viewWidth: number, hud: TakeoffHud): void {
  if (hud.remaining !== null) drawText(ctx, `RWY ${hud.remaining.toLocaleString('en-US')} m`, Math.round(viewWidth / 2), 16, 'center');
}

/** The gear prompt that goes with POSITIVE RATE, while the lever is still down. */
export const gearPrompt = (callout: Callout | null, gearLeverDown: boolean): boolean => callout === 'POSITIVE RATE' && gearLeverDown;

/** The call-out as the screen reader says it; empty with none. */
export const calloutSentence = (callout: Callout | null, gearLeverDown: boolean): string => (callout === null ? '' : gearPrompt(callout, gearLeverDown) ? `${callout}, gear up` : callout);
