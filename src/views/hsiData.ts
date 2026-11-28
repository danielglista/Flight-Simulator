import { APPROACH_AIM_M, APPROACH_PATH_DEG, HSI_GS_CONE_DEG, HSI_GS_FULL_DEG, HSI_GS_RANGE_M, HSI_LOC_FULL_DEG } from '../config/display';
import type { Craft } from '../sim/state';
import type { RunwayEnd } from './runwaySelect';

const DEG = Math.PI / 180;
const clamp1 = (v: number): number => Math.min(1, Math.max(-1, v));
const compassDeg = (x: number, y: number): number => (Math.atan2(x, y) / DEG + 360) % 360;

/** What the HSI shows about the selected runway end (D5D). */
export interface HsiGuide {
  readonly ident: string;
  readonly name: string;
  /** The runway's geometry heading, degrees: where the course arrow points. */
  readonly courseDeg: number;
  /** Where the center line is, -1..1 of full scale: positive means the line is to the right. */
  readonly deviation: number;
  /** Direction from the plane to the threshold, degrees clockwise from north. */
  readonly bearingDeg: number;
  /** Where the glide path is, -1..1 of full scale: positive means above, so the plane is low. Null when not shown. */
  readonly glide: number | null;
  /** World meters to the threshold. */
  readonly distanceM: number;
}

/**
 * Both deviations are angles, as on an ILS: sideways as seen from the far end of the runway, vertically from the aim
 * point. The glide path shows only before the aim point, within HSI_GS_RANGE_M and HSI_GS_CONE_DEG of the center line.
 */
export function hsiGuide(craft: Pick<Craft, 'x' | 'y' | 'z'>, end: RunwayEnd, aimZFor: (x: number, y: number) => number): HsiGuide {
  const dx = craft.x - end.threshold.x;
  const dy = craft.y - end.threshold.y;
  const along = dx * end.dir.x + dy * end.dir.y;
  // Positive: the plane is right of the center line, looking the way it lands.
  const offset = dx * end.dir.y - dy * end.dir.x;
  const side = Math.atan2(offset, Math.max(1, Math.abs(end.length - along))) / DEG;
  const aimM = end.aimM ?? APPROACH_AIM_M;
  const toAim = aimM - along;
  const inCone = toAim > 0 && toAim <= HSI_GS_RANGE_M && Math.abs(Math.atan2(offset, toAim)) / DEG <= HSI_GS_CONE_DEG;
  let glide: number | null = null;
  if (inCone) {
    const aimZ = aimZFor(end.threshold.x + end.dir.x * aimM, end.threshold.y + end.dir.y * aimM);
    glide = clamp1((APPROACH_PATH_DEG - Math.atan2(craft.z - aimZ, toAim) / DEG) / HSI_GS_FULL_DEG);
  }
  return {
    ident: end.ident,
    name: end.name,
    courseDeg: compassDeg(end.dir.x, end.dir.y),
    deviation: clamp1(-side / HSI_LOC_FULL_DEG),
    bearingDeg: compassDeg(-dx, -dy),
    glide,
    distanceM: Math.hypot(dx, dy),
  };
}

/** `3.2`: world kilometers. Displayed NM would be world distance x geoDistance, which misleads near a runway. */
export const hsiDistance = (distanceM: number): string => (distanceM / 1000).toFixed(1);

/** The selected approach for the screen-reader line; empty with none. */
export function hsiSentence(g: HsiGuide | null): string {
  if (!g) return '';
  const line = Math.abs(g.deviation) < 0.1 ? 'on the center line' : `center line to the ${g.deviation > 0 ? 'right' : 'left'}`;
  const glide = g.glide === null ? '' : Math.abs(g.glide) < 0.2 ? ', on the glide path' : `, ${g.glide > 0 ? 'below' : 'above'} the glide path`;
  return `, approach ${g.ident} ${g.name}, ${hsiDistance(g.distanceM)} kilometers, ${line}${glide}`;
}
