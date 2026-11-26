import { CL0, FLAP_STALL_DEG, FLAP_TIME_S } from '../../config/flight';
import type { Tuning } from '../../config/motion';
import type { Craft } from '../state';

const DEG = Math.PI / 180;

/** The wing as the current flaps and gear shape it: what `aeroAt` takes. */
export interface Wing {
  /** Lift coefficient at zero angle of attack. */
  readonly cl0: number;
  /** Center of the positive stall, radians. */
  readonly stallRad: number;
  /** Extra zero-lift drag from flaps and gear, in 1/10,000. */
  readonly extraCd0Counts: number;
}

/** Wing parameters at flap position `flaps` (0..1) and gear position `gear` (0..1). Flaps 0, gear 0 is the clean wing exactly. */
export function wingAt(flaps: number, gear: number, tuning: Tuning): Wing {
  return {
    cl0: CL0 + flaps * (tuning.flapLiftPct / 100),
    stallRad: (tuning.stallDeg - flaps * FLAP_STALL_DEG) * DEG,
    extraCd0Counts: gear * tuning.gearDragCounts + flaps * tuning.flapDragCounts,
  };
}

export const wingOf = (craft: Pick<Craft, 'flaps' | 'gear'>, tuning: Tuning): Wing => wingAt(craft.flaps, craft.gear, tuning);

/** The flap position after one step of `dt` seconds toward the lever's position; snaps to the end. */
export function stepFlaps(flaps: number, lever: number, dt: number): number {
  const target = lever / 2;
  const d = dt / FLAP_TIME_S;
  const next = flaps < target ? Math.min(target, flaps + d) : Math.max(target, flaps - d);
  return Math.abs(target - next) < 1e-9 ? target : next;
}
