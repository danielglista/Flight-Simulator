import { APPROACH_AGL_M, APPROACH_ALIGN_DEG, APPROACH_PATH_DEG, APPROACH_RANGE_M, APPROACH_AIM_M, APPROACH_WIDTH_M, CENTERLINE_M, CENTERLINE_TICK_M, GEAR_UP_AT } from '../config/display';
import type { Craft } from '../sim/state';
import type { Runway } from '../sim/world/airport';

const DEG = Math.PI / 180;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Where the plane stands against the approach to one runway end. World meters; everything is derived from sim state. */
export interface ApproachGuide {
  /** The threshold being approached, and the unit vector down the runway from it. */
  readonly threshold: { readonly x: number; readonly y: number };
  readonly dir: { readonly x: number; readonly y: number };
  readonly length: number;
  /** Heading of the runway in this direction, radians. */
  readonly runwayHeading: number;
  /** The aim point on the ground: APPROACH_AIM_M past the threshold. */
  readonly aim: { readonly x: number; readonly y: number };
  /** Meters past the threshold along the runway (negative before it). */
  readonly along: number;
  /** Meters right (positive) or left (negative) of the center line. */
  readonly offset: number;
  /** Plane heading minus runway heading, radians, wrapped; positive = pointing right of the runway. */
  readonly headingError: number;
  /** Meters above (positive) or below the glide path through the aim point. */
  readonly glideError: number;
  /** Meters from the plane to the aim point along its own heading (for the side view line). */
  readonly aimAhead: number;
}

/**
 * The approach guide, or null when not on an approach: airborne, gear down, under APPROACH_AGL_M above ground, within
 * APPROACH_RANGE_M before the threshold (or over the runway while not climbing), roughly facing down the runway and
 * within APPROACH_WIDTH_M of its line. Either runway end is used, the one the plane is facing. `aimZ` is the ground
 * height at the aim point for that end.
 */
export function approachGuide(
  craft: Pick<Craft, 'x' | 'y' | 'z' | 'heading' | 'onGround' | 'gear' | 'pathAngle'>,
  aglM: number,
  crashed: boolean,
  rw: Runway,
  aimZFor: (x: number, y: number) => number,
): ApproachGuide | null {
  if (crashed || craft.onGround || craft.gear <= GEAR_UP_AT || aglM >= APPROACH_AGL_M) return null;
  const ux = (rw.b.x - rw.a.x) / rw.length;
  const uy = (rw.b.y - rw.a.y) / rw.length;
  const hx = Math.sin(craft.heading);
  const hy = Math.cos(craft.heading);
  const forward = hx * ux + hy * uy >= 0;
  const dir = forward ? { x: ux, y: uy } : { x: -ux, y: -uy };
  if (hx * dir.x + hy * dir.y < Math.cos(APPROACH_ALIGN_DEG * DEG)) return null;
  const threshold = forward ? rw.a : rw.b;
  const dx = craft.x - threshold.x;
  const dy = craft.y - threshold.y;
  const along = dx * dir.x + dy * dir.y;
  const offset = dx * dir.y - dy * dir.x;
  if (along < -APPROACH_RANGE_M || along > rw.length || Math.abs(offset) > APPROACH_WIDTH_M) return null;
  // Past the threshold only a plane that is not climbing is still on the approach (a takeoff climb-out is not).
  if (along > 0 && craft.pathAngle > 0) return null;
  const aim = { x: threshold.x + dir.x * APPROACH_AIM_M, y: threshold.y + dir.y * APPROACH_AIM_M };
  const aimDist = APPROACH_AIM_M - along;
  const ideal = aimZFor(aim.x, aim.y) + Math.max(0, aimDist) * Math.tan(APPROACH_PATH_DEG * DEG);
  const runwayHeading = Math.atan2(dir.x, dir.y);
  return {
    threshold,
    dir,
    length: rw.length,
    runwayHeading: (runwayHeading + 2 * Math.PI) % (2 * Math.PI),
    aim,
    along,
    offset,
    headingError: wrap(craft.heading - runwayHeading),
    glideError: craft.z - ideal,
    aimAhead: (aim.x - craft.x) * hx + (aim.y - craft.y) * hy,
  };
}

/** The approach to whichever of these runways the plane is lined up with best (nearest its center line), or null. */
export function bestApproach(
  craft: Parameters<typeof approachGuide>[0],
  aglM: number,
  crashed: boolean,
  runways: readonly Runway[],
  aimZFor: (x: number, y: number) => number,
): ApproachGuide | null {
  let best: ApproachGuide | null = null;
  for (const rw of runways) {
    const g = approachGuide(craft, aglM, crashed, rw, aimZFor);
    if (g && (!best || Math.abs(g.offset) < Math.abs(best.offset))) best = g;
  }
  return best;
}

/** `LOC 40 m R   HDG +3   GS 8 m HIGH`: where to steer, which way to point and how far off the glide path. */
export function guideText(g: ApproachGuide): string {
  const loc = Math.abs(g.offset) < 1 ? 'LOC 0 m' : `LOC ${Math.round(Math.abs(g.offset))} m ${g.offset > 0 ? 'R' : 'L'}`;
  const h = Math.round(g.headingError / DEG);
  const hdg = `HDG ${h > 0 ? '+' : ''}${h}`;
  const gs = Math.abs(g.glideError) < 1 ? 'GS 0 m' : `GS ${Math.round(Math.abs(g.glideError))} m ${g.glideError > 0 ? 'HIGH' : 'LOW'}`;
  return `${loc}   ${hdg}   ${gs}`;
}

/** A runway end as the center line needs it: an approach guide or the runway picked on the HSI. */
export type CenterlineEnd = Pick<ApproachGuide, 'threshold' | 'dir' | 'length'>;

/** The two ends of the center line drawn in the top view: out to CENTERLINE_M before the threshold, and to the far end. */
export function centerlineEnds(g: CenterlineEnd): { from: { x: number; y: number }; to: { x: number; y: number } } {
  return {
    from: { x: g.threshold.x - g.dir.x * CENTERLINE_M, y: g.threshold.y - g.dir.y * CENTERLINE_M },
    to: { x: g.threshold.x + g.dir.x * g.length, y: g.threshold.y + g.dir.y * g.length },
  };
}

/** Distance marks on the line, every CENTERLINE_TICK_M before the threshold; `end` marks the outermost one. */
export function centerlineTicks(g: CenterlineEnd): readonly { x: number; y: number; end: boolean }[] {
  const count = Math.floor(CENTERLINE_M / CENTERLINE_TICK_M);
  return Array.from({ length: count }, (_, i) => {
    const back = (i + 1) * CENTERLINE_TICK_M;
    return { x: g.threshold.x - g.dir.x * back, y: g.threshold.y - g.dir.y * back, end: i === count - 1 };
  });
}
