import { FINAL_AIM_M, FINAL_DIST_M, FINAL_PATH_DEG, FINAL_SPEED } from '../../config/motion';
import type { Tuning } from '../../config/motion';
import { gearDragCounts } from '../flight/gear';
import { trimAt } from '../flight/trim';
import { RUNWAY_START_M } from '../../config/motion';
import type { StartSpec } from '../state';
import type { Runway } from './airport';

/** At rest on the runway, `RUNWAY_START_M` past the first threshold, facing down it, engine idle. */
export function runwayStart(runway: Runway, heightAt: (x: number, y: number) => number): StartSpec {
  const ux = (runway.b.x - runway.a.x) / runway.length;
  const uy = (runway.b.y - runway.a.y) / runway.length;
  const x = runway.a.x + ux * RUNWAY_START_M;
  const y = runway.a.y + uy * RUNWAY_START_M;
  return { x, y, z: heightAt(x, y), heading: runway.heading, speed: 0, pathAngle: 0, pitch: 0, lever: 0, spool: 0, onGround: true, gearDown: true, flapLever: 0 };
}

/**
 * On final for the first threshold: FINAL_DIST_M before it on the center line, descending FINAL_PATH_DEG toward a point
 * its aim point past it (FINAL_AIM_M unless the runway states one), trimmed, gear down, full flaps, wings level. Trim comes from `trimAt`, not literals.
 */
export function finalStart(
  runway: Runway,
  heightAt: (x: number, y: number) => number,
  altitudeScale: number,
  tuning: Tuning,
): StartSpec {
  const ux = (runway.b.x - runway.a.x) / runway.length;
  const uy = (runway.b.y - runway.a.y) / runway.length;
  const x = runway.a.x - ux * FINAL_DIST_M;
  const y = runway.a.y - uy * FINAL_DIST_M;
  const path = -FINAL_PATH_DEG * (Math.PI / 180);
  const aim = runway.aimM ?? FINAL_AIM_M;
  const aimX = runway.a.x + ux * aim;
  const aimY = runway.a.y + uy * aim;
  const z = heightAt(aimX, aimY) + (FINAL_DIST_M + aim) * Math.tan(-path);
  const trim = trimAt(FINAL_SPEED, path, z, altitudeScale, tuning, gearDragCounts({ gear: 1 }, tuning), 1);
  return { x, y, z, heading: runway.heading, speed: FINAL_SPEED, pathAngle: path, pitch: trim.pitch, lever: trim.lever, spool: trim.lever, onGround: false, gearDown: true, flapLever: 2 };
}
