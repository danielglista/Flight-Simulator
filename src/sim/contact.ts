import { SWEEP_M } from '../config/motion';

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Top surface (water or ground) in world m. */
export type HeightFn = (x: number, y: number) => number;

const BISECTIONS = 8;

/**
 * Where the straight path from `from` to `to` first reaches the ground, or null.
 * The path is checked in pieces of at most SWEEP_M, so thin ridges and walls are
 * not stepped over; the first piece that touches is bisected for the contact
 * point. The returned point lies on the ground exactly (z = heightAt).
 */
export function sweepContact(heightAt: HeightFn, from: Point3, to: Point3): Point3 | null {
  const touches = (p: Point3): boolean => p.z <= heightAt(p.x, p.y);
  const at = (t: number): Point3 => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  });
  const onGround = (p: Point3): Point3 => ({ x: p.x, y: p.y, z: heightAt(p.x, p.y) });

  if (touches(from)) return onGround(from);
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const pieces = Math.max(1, Math.ceil(len / SWEEP_M));
  let lo = 0;
  for (let i = 1; i <= pieces; i++) {
    const hi = i / pieces;
    if (touches(at(hi))) {
      let a = lo;
      let b = hi;
      for (let k = 0; k < BISECTIONS; k++) {
        const m = (a + b) / 2;
        if (touches(at(m))) b = m;
        else a = m;
      }
      return onGround(at(b));
    }
    lo = hi;
  }
  return null;
}
