import { SWEEP_M } from '../config/motion';
import type { ObstacleFn } from './world/obstacles';

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Top surface (water or ground) in world m. */
export type HeightFn = (x: number, y: number) => number;

const BISECTIONS = 8;

export interface Contact extends Point3 {
  /** What was touched first was a building, not the ground or water. */
  readonly building: boolean;
}

/**
 * Where the straight path from `from` to `to` first reaches the ground or a building, or null.
 * The path is checked in pieces of at most SWEEP_M, so thin ridges and walls are
 * not stepped over; the first piece that touches is bisected for the contact
 * point. A ground contact is returned on the ground exactly (z = heightAt); a building contact stays at the height it
 * was hit, since that may be on a wall.
 */
export function sweepContact(heightAt: HeightFn, from: Point3, to: Point3, obstacleAt?: ObstacleFn): Contact | null {
  const inBuilding = (p: Point3): boolean => obstacleAt !== undefined && p.z <= obstacleAt(p.x, p.y, p.z); // false for NaN
  const touches = (p: Point3): boolean => p.z <= heightAt(p.x, p.y) || inBuilding(p);
  const at = (t: number): Point3 => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  });
  const contact = (p: Point3): Contact => {
    const ground = heightAt(p.x, p.y);
    const building = p.z > ground && inBuilding(p);
    return { x: p.x, y: p.y, z: building ? p.z : ground, building };
  };

  if (touches(from)) return contact(from);
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
      return contact(at(b));
    }
    lo = hi;
  }
  return null;
}
