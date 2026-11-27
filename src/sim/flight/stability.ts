import { DANGER_AGL_M, DANGER_BANK_DEG, DANGER_PITCH_DEG, DANGER_SLOW_MULT, STABLE_AGL_M, STABLE_BANK_DEG, STABLE_PITCH_DEG, STABLE_SLOW_MULT } from '../../config/flight';
import { densityRatio } from './forces';
import { stallState } from './aero';
import { terrainAhead } from './terrain';
import { levelStallSpeed } from './vspeeds';
import type { ApReason, SimState } from '../state';
import type { SimWorld } from '../step';

export type StabilityReason = Exclude<ApReason, 'UNSETTLED' | 'controls'>;

export interface Stability {
  /** Inside the engage limits. */
  readonly stable: boolean;
  /** Past the let-go limits. Implies not stable. */
  readonly danger: boolean;
  /** The first row that is not stable, or null. */
  readonly reason: StabilityReason | null;
  /** The first row that is danger, or null. */
  readonly dangerReason: StabilityReason | null;
}

const DEG = Math.PI / 180;
const ORDER: readonly StabilityReason[] = ['GROUND', 'LOW', 'BANK', 'PITCH', 'STALL', 'SLOW', 'TERRAIN'];

/**
 * Whether the plane is settled enough for the autopilot. Pure. Two thresholds per row (engage limits inside the
 * let-go limits) keep it from flickering at an edge; the first matching row names the reason.
 */
export function stability(state: Pick<SimState, 'craft' | 'crash' | 'tuning'>, world: SimWorld): Stability {
  const { craft, tuning } = state;
  if (craft.onGround || state.crash) return { stable: false, danger: true, reason: 'GROUND', dangerReason: 'GROUND' };
  const agl = craft.z - world.heightAt(craft.x, craft.y);
  const ias = craft.speed * Math.sqrt(densityRatio(craft.z, world.altitudeScale));
  const vs = levelStallSpeed(tuning, craft.bank, craft.flaps);
  const bank = Math.abs(craft.bank) / DEG;
  const pitch = Math.abs(craft.pitch) / DEG;
  const stalled = stallState(craft, tuning) !== 'none';
  const terr = terrainAhead(craft, world.heightAt, false, world.obstacleAt);
  const rows: Readonly<Record<StabilityReason, readonly [boolean, boolean]>> = {
    GROUND: [false, false],
    LOW: [agl < STABLE_AGL_M, agl < DANGER_AGL_M],
    BANK: [bank > STABLE_BANK_DEG, bank > DANGER_BANK_DEG],
    PITCH: [pitch > STABLE_PITCH_DEG, pitch > DANGER_PITCH_DEG],
    STALL: [stalled, stalled],
    SLOW: [ias < STABLE_SLOW_MULT * vs, ias < DANGER_SLOW_MULT * vs],
    TERRAIN: [terr, terr],
  };
  const reason = ORDER.find((r) => rows[r][0]) ?? null;
  const dangerReason = ORDER.find((r) => rows[r][1]) ?? null;
  return { stable: reason === null, danger: dangerReason !== null, reason, dangerReason };
}
