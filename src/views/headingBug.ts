/** Heading bug arithmetic. Degrees clockwise from north; pure, so it can be tested. */

/** Moves the bug by `deltaDeg` and wraps it to [0, 360). */
export function stepBug(bug: number, deltaDeg: number): number {
  return (((bug + deltaDeg) % 360) + 360) % 360;
}

/** The top view's ring and bug: whenever airborne and following the plane, on approaches too. */
export function topBugShown(following: boolean, crashed: boolean, onGround: boolean): boolean {
  return following && !crashed && !onGround;
}

/** Shortest signed turn from `heading` to `bug`, degrees, positive = right. Exactly opposite counts as right (+180). */
export function turnNeeded(heading: number, bug: number): number {
  const d = (((bug - heading) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** Where a path of headings (radians, one per point) first passes through the bug. */
export interface BugCrossing {
  /** The path segment: between point `index` and `index + 1`. */
  readonly index: number;
  /** 0..1 along that segment. */
  readonly t: number;
}

/**
 * The first place the headings reach the bug, or null. A path that starts on the bug, or only turns away from it
 * or the long way round (more than 90 degrees to go), has no crossing.
 */
export function bugCrossing(headingsRad: readonly number[], bugDeg: number): BugCrossing | null {
  const need = headingsRad.map((h) => turnNeeded((h * 180) / Math.PI, bugDeg));
  for (let i = 0; i + 1 < need.length; i++) {
    const a = need[i] as number;
    const b = need[i + 1] as number;
    if (a === 0) return null;
    if (Math.abs(a) < 90 && Math.sign(a) !== Math.sign(b)) return { index: i, t: a / (a - b) };
  }
  return null;
}
