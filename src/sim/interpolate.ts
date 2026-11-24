import type { Craft } from './state';

/** Blends two snapshots; heading takes the short way through north. */
export function interpolate(prev: Craft, next: Craft, alpha: number): Craft {
  const a = Math.min(1, Math.max(0, alpha));
  const TWO_PI = Math.PI * 2;
  let dh = (next.heading - prev.heading) % TWO_PI;
  if (dh > Math.PI) dh -= TWO_PI;
  else if (dh < -Math.PI) dh += TWO_PI;
  let heading = prev.heading + dh * a;
  heading = ((heading % TWO_PI) + TWO_PI) % TWO_PI;
  return {
    x: prev.x + (next.x - prev.x) * a,
    y: prev.y + (next.y - prev.y) * a,
    z: prev.z + (next.z - prev.z) * a,
    heading: a === 1 ? next.heading : a === 0 ? prev.heading : heading,
    speed: prev.speed + (next.speed - prev.speed) * a,
    pathAngle: prev.pathAngle + (next.pathAngle - prev.pathAngle) * a,
    lever: prev.lever + (next.lever - prev.lever) * a,
    spool: prev.spool + (next.spool - prev.spool) * a,
  };
}
