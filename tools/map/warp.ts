import type { PointKm } from './project';

/** Radii of the city warp, in real km from the city center (E_PLAN §4.3). */
export interface WarpShape {
  /** Core ends here; slope is 1/cityCore inside. */
  readonly coreKm: number;
  /** First ramp ends here; the plateau begins. */
  readonly rampKm: number;
  /** The plateau ends here; the second ramp begins. */
  readonly plateauEndKm: number;
  /** Beyond this the map is unwarped. */
  readonly ringKm: number;
}

export const DEFAULT_SHAPE: WarpShape = { coreKm: 4, rampKm: 8, plateauEndKm: 80, ringKm: 90 };

export class WarpError extends Error {}

/** Real distance from a city center to world distance, both in km. Slope is linear across each ramp. */
export interface CityProfile {
  /** World km per real km on the plateau. */
  readonly plateau: number;
  readonly shape: WarpShape;
  /** Real km to world km. */
  readonly f: (rKm: number) => number;
  /** World km to real km. */
  readonly inverse: (wKm: number) => number;
  /** d f / d r. */
  readonly slope: (rKm: number) => number;
}

export function makeProfile(geoDistance: number, cityCore: number, shape: WarpShape = DEFAULT_SHAPE): CityProfile {
  const { coreKm: a, rampKm: b, plateauEndKm: c, ringKm: R } = shape;
  if (!(0 < a && a < b && b < c && c < R)) {
    throw new WarpError(`warp radii must satisfy 0 < core < ramp < plateau end < ring, got ${a}, ${b}, ${c}, ${R}`);
  }
  if (!(geoDistance > 0) || !(cityCore > 0)) throw new WarpError('geoDistance and cityCore must be positive');
  const s0 = 1 / cityCore;
  const sg = 1 / geoDistance;
  // The ring must end exactly where unwarped space would put it: f(R) = R * sg. Solve for the plateau slope.
  const k = (b - a) / 2 + (c - b) + (R - c) / 2;
  const p = (R * sg - (a + (b - a) / 2) * s0 - ((R - c) / 2) * sg) / k;
  if (!(p > 0)) {
    throw new WarpError(
      `the ${R} km ring is too small for 1:${cityCore} cores at 1:${geoDistance}: plateau slope would be ${p.toFixed(4)}`,
    );
  }

  const radii = [0, a, b, c, R];
  const slopes = [s0, s0, p, p, sg];
  // f at each breakpoint
  const values = [0];
  for (let i = 1; i < radii.length; i++) {
    const len = (radii[i] as number) - (radii[i - 1] as number);
    values.push((values[i - 1] as number) + (len * ((slopes[i - 1] as number) + (slopes[i] as number))) / 2);
  }
  const ringWorld = values[4] as number;

  const f = (r: number): number => {
    if (r >= R) return ringWorld + (r - R) * sg;
    if (r <= 0) return r * s0;
    let i = 1;
    while (i < radii.length - 1 && r > (radii[i] as number)) i++;
    const r0 = radii[i - 1] as number;
    const len = (radii[i] as number) - r0;
    const s0i = slopes[i - 1] as number;
    const s1i = slopes[i] as number;
    const t = r - r0;
    return (values[i - 1] as number) + s0i * t + ((s1i - s0i) / (2 * len)) * t * t;
  };

  const slope = (r: number): number => {
    if (r >= R) return sg;
    if (r <= 0) return s0;
    let i = 1;
    while (i < radii.length - 1 && r > (radii[i] as number)) i++;
    const r0 = radii[i - 1] as number;
    const len = (radii[i] as number) - r0;
    const s0i = slopes[i - 1] as number;
    const s1i = slopes[i] as number;
    return s0i + ((s1i - s0i) * (r - r0)) / len;
  };

  const inverse = (w: number): number => {
    if (w <= 0) return w / s0;
    if (w >= ringWorld) return R + (w - ringWorld) / sg;
    let lo = 0;
    let hi = R;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < w) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  return { plateau: p, shape, f, inverse, slope };
}

export interface WarpCity {
  readonly id: string;
  /** Real km, projected: the warp's center, which need not be the city center. */
  readonly x: number;
  readonly y: number;
  /** This city's own radii; the default shape otherwise. */
  readonly shape?: WarpShape;
}

export interface Warp {
  readonly geoDistance: number;
  readonly profile: CityProfile;
  readonly cities: readonly WarpCity[];
  /** Real km (projected) to world km (same frame, not yet offset to the map corner). */
  readonly toWorld: (x: number, y: number) => PointKm;
  readonly toReal: (x: number, y: number) => PointKm;
}

/** Warp all cities at once. Fails if two rings overlap. */
export function makeWarp(
  geoDistance: number,
  cityCore: number,
  cities: readonly WarpCity[],
  shape: WarpShape = DEFAULT_SHAPE,
): Warp {
  const profile = makeProfile(geoDistance, cityCore, shape);
  const profiles = cities.map((c) => (c.shape ? makeProfile(geoDistance, cityCore, c.shape) : profile));
  const R = shape.ringKm;
  if (cities.some((c) => c.shape && c.shape.ringKm !== R)) throw new WarpError('every city must use the same ring radius');
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i] as WarpCity;
      const b = cities[j] as WarpCity;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 2 * R) {
        throw new WarpError(
          `rings of ${a.id} and ${b.id} overlap: ${d.toFixed(1)} km apart, need at least ${2 * R} km`,
        );
      }
    }
  }
  const sg = 1 / geoDistance;

  const toWorld = (x: number, y: number): PointKm => {
    for (let k = 0; k < cities.length; k++) {
      const c = cities[k] as WarpCity;
      const dx = x - c.x;
      const dy = y - c.y;
      const r = Math.hypot(dx, dy);
      if (r < R) {
        if (r === 0) return { x: c.x * sg, y: c.y * sg };
        const w = (profiles[k] as CityProfile).f(r);
        return { x: c.x * sg + (dx / r) * w, y: c.y * sg + (dy / r) * w };
      }
    }
    return { x: x * sg, y: y * sg };
  };

  const toReal = (x: number, y: number): PointKm => {
    for (let k = 0; k < cities.length; k++) {
      const c = cities[k] as WarpCity;
      const dx = x - c.x * sg;
      const dy = y - c.y * sg;
      const d = Math.hypot(dx, dy);
      if (d < R * sg) {
        if (d === 0) return { x: c.x, y: c.y };
        const r = (profiles[k] as CityProfile).inverse(d);
        return { x: c.x + (dx / d) * r, y: c.y + (dy / d) * r };
      }
    }
    return { x: x / sg, y: y / sg };
  };

  return { geoDistance, profile, cities, toWorld, toReal };
}
