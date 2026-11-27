import {
  APPROACH_ZOOM_ENTER_DEG,
  APPROACH_ZOOM_ENTER_OFFSET_M,
  APPROACH_ZOOM_LEAVE_BACK_M,
  APPROACH_ZOOM_LEAVE_DEG,
  APPROACH_ZOOM_LEAVE_OFFSET_M,
  APPROACH_ZOOM_MAX_AGL,
  CENTERLINE_M,
  GROUND_ZOOM_ENTER_AGL,
  GROUND_ZOOM_EXIT_AGL,
  SIDE_MID_ENTER_FT,
  SIDE_MID_EXIT_FT,
  SIDE_NEAR_ENTER_FT,
  SIDE_NEAR_EXIT_FT,
  ZOOM_EASE_S,
} from '../config/display';
import { CLOSE_SIDE_ZOOM, DEFAULT_SIDE_ZOOM } from './sideCamera';
import type { RunwayEnd } from './runwaySelect';
import type { Craft } from '../sim/state';

/** Which remembered zoom the top view shows: the close one near the ground, one for lining up, and the cruise one. */
export type ZoomPhase = 'ground' | 'approach' | 'air';

/**
 * Pure gate with hysteresis. On the ground, or under GROUND_ZOOM_ENTER_AGL: ground. Above GROUND_ZOOM_EXIT_AGL: air.
 * Between the two it keeps its last phase, so a noisy height near one value cannot flicker. `aglM` is world m.
 */
export function gatePhase(prev: ZoomPhase, onGround: boolean, aglM: number): ZoomPhase {
  if (onGround || aglM < GROUND_ZOOM_ENTER_AGL) return 'ground';
  if (aglM > GROUND_ZOOM_EXIT_AGL) return 'air';
  return prev;
}

/**
 * Whether the plane is lining up on the picked runway end, with hysteresis (`was` = last answer). Entering needs to be
 * before the threshold, so a takeoff from that runway never counts.
 */
export function liningUp(was: boolean, craft: Pick<Craft, 'x' | 'y' | 'heading' | 'onGround'>, aglM: number, end: RunwayEnd | null): boolean {
  if (!end || craft.onGround || aglM > APPROACH_ZOOM_MAX_AGL) return false;
  const dx = craft.x - end.threshold.x;
  const dy = craft.y - end.threshold.y;
  const along = dx * end.dir.x + dy * end.dir.y;
  const offset = Math.abs(dx * end.dir.y - dy * end.dir.x);
  const facing = Math.sin(craft.heading) * end.dir.x + Math.cos(craft.heading) * end.dir.y;
  const back = CENTERLINE_M + (was ? APPROACH_ZOOM_LEAVE_BACK_M : 0);
  return (
    along >= -back &&
    along <= (was ? end.length : 0) &&
    offset <= (was ? APPROACH_ZOOM_LEAVE_OFFSET_M : APPROACH_ZOOM_ENTER_OFFSET_M) &&
    facing >= Math.cos(((was ? APPROACH_ZOOM_LEAVE_DEG : APPROACH_ZOOM_ENTER_DEG) * Math.PI) / 180)
  );
}

/** The top view's phase: the ground gate first, then lining up or not. */
export function topPhase(prev: ZoomPhase, onGround: boolean, aglM: number, lined: boolean): ZoomPhase {
  if (gatePhase(prev === 'ground' ? 'ground' : 'air', onGround, aglM) === 'ground') return 'ground';
  return lined ? 'approach' : 'air';
}

/** The side view's own bands by height: near the ground, low, and high. */
export type SideBand = 'near' | 'mid' | 'high';

/** The side zoom each band starts with (an index into SIDE_ZOOM_LEVELS). The wheel changes the current band's only. */
export const SIDE_BAND_ZOOMS: Readonly<Record<SideBand, number>> = {
  near: CLOSE_SIDE_ZOOM,
  mid: CLOSE_SIDE_ZOOM - 1,
  high: DEFAULT_SIDE_ZOOM,
};

/** Pure gate with hysteresis. `aglFt` is height above ground in displayed feet. */
export function sideBand(prev: SideBand, onGround: boolean, aglFt: number): SideBand {
  if (onGround || aglFt < SIDE_NEAR_ENTER_FT) return 'near';
  if (prev === 'near' && aglFt <= SIDE_NEAR_EXIT_FT) return 'near';
  if (aglFt < SIDE_MID_ENTER_FT) return 'mid';
  if (aglFt > SIDE_MID_EXIT_FT) return 'high';
  return prev === 'high' ? 'high' : 'mid';
}

/**
 * On an approach the side view keeps the wide zoom until just above the ground, so the runway and glide path stay in
 * sight; `phase` is the ground / air gate's.
 */
export const approachBand = (phase: ZoomPhase): SideBand => (phase === 'ground' ? 'near' : 'high');

/** One remembered zoom level (an index into the view's levels) for each phase. */
export interface PhaseZoom {
  readonly ground: number;
  readonly approach: number;
  readonly air: number;
}

export const recall = (m: PhaseZoom, phase: ZoomPhase): number => m[phase];

/** Stores a zoom for one phase only; the other is untouched. */
export const remember = (m: PhaseZoom, phase: ZoomPhase, zoom: number): PhaseZoom => ({ ...m, [phase]: zoom });

/** The wheel: steps the zoom of the current phase, clamped by `clamp`. The other phase never changes. */
export function stepPhaseZoom(m: PhaseZoom, phase: ZoomPhase, steps: number, clamp: (z: number) => number): PhaseZoom {
  return remember(m, phase, clamp(recall(m, phase) + steps));
}

/**
 * Eases a meters-per-pixel value toward its target in log space (the same visual speed at every scale), with time
 * constant `tauS`. Never overshoots, and lands exactly on the target when it is within 0.2% so a zoom at rest is exact.
 */
export function easeMpp(shown: number, target: number, dtS: number, tauS = ZOOM_EASE_S): number {
  if (!(shown > 0) || !(target > 0)) return target;
  const gap = Math.log(target / shown);
  if (Math.abs(gap) < 0.002) return target;
  if (!(dtS > 0)) return shown;
  return shown * Math.exp(gap * (1 - Math.exp(-dtS / tauS)));
}
