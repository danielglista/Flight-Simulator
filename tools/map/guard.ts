import { cellAt, type Skeleton } from './skeleton';
import { project } from './project';
import type { Placement } from './place';

export type GuardLevel = 'ok' | 'warn' | 'fail';

export interface GuardResult {
  readonly name: string;
  readonly level: GuardLevel;
  readonly message: string;
}

/** A hand-written expectation about the real world, in lat/lon (data/map/checks.json). */
export interface MapCheck {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly expect: 'land' | 'water';
  /** For land: real elevation at least this high, m. */
  readonly minElevationM?: number;
  /** For land: real elevation at most this high, m. */
  readonly maxElevationM?: number;
}

export interface GuardLimits {
  /** Peaks stay below this, world m (the plane's ceiling is 1,200). */
  readonly peakWorldM: number;
  /** Warn when this share of land cells is steeper than the angle (world degrees). */
  readonly slopeWarnDeg: number;
  readonly slopeWarnShare: number;
  /** Approach corridors stay under the airport height plus this, world m. */
  readonly corridorClearWorldM: number;
  /** Airport ground varies by at most this, real m. */
  readonly flatToleranceM: number;
}

export const DEFAULT_LIMITS: GuardLimits = {
  peakWorldM: 900,
  slopeWarnDeg: 30,
  slopeWarnShare: 0.001,
  corridorClearWorldM: 100,
  flatToleranceM: 1,
};

function res(name: string, level: GuardLevel, message: string): GuardResult {
  return { name, level, message };
}

/** World slope in degrees between two neighboring cells, given the altitude scale. */
export function slopeDeg(dRealM: number, altitudeScale: number, cellM: number): number {
  return (Math.atan2(Math.abs(dRealM) / altitudeScale, cellM) * 180) / Math.PI;
}

export function runGuardrails(
  sk: Skeleton,
  placement: Placement,
  altitudeScale: number,
  checks: readonly MapCheck[],
  limits: GuardLimits = DEFAULT_LIMITS,
): GuardResult[] {
  const out: GuardResult[] = [];
  const { grid } = sk;
  const { cols, rows, elevation, water } = grid;

  // Airports: dry, flat, on land.
  for (const f of sk.flattened) {
    let wet = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of f.cells) {
      if (!sk.land[i] || (water[i] as number) > 0 || (elevation[i] as number) < 0) wet++;
      lo = Math.min(lo, elevation[i] as number);
      hi = Math.max(hi, elevation[i] as number);
    }
    out.push(wet === 0 ? res(`${f.id} dry`, 'ok', 'no water under the runways and apron') : res(`${f.id} dry`, 'fail', `${wet} wet cells under the runways and apron`));
    out.push(
      hi - lo <= limits.flatToleranceM
        ? res(`${f.id} flat`, 'ok', `ground at ${f.elevationM} m real`)
        : res(`${f.id} flat`, 'fail', `ground varies ${lo} to ${hi} m under the runways and apron`),
    );
  }

  // Approach corridors clear of terrain.
  for (const a of placement.airports) {
    const base = sk.flattened.find((f) => f.id === a.airport.id);
    const h0 = (base?.elevationM ?? 0) / altitudeScale;
    let worst = -Infinity;
    const [p0, p1, p2, p3] = a.corridor;
    if (p0 && p1 && p2 && p3) {
      const steps = 80;
      for (let s = 0; s <= steps; s++) {
        for (let k = 0; k <= 4; k++) {
          // across the corridor by k/4, along it by s/steps; p0-p1 is the long edge
          const ax = p0.x + (p1.x - p0.x) * (s / steps);
          const ay = p0.y + (p1.y - p0.y) * (s / steps);
          const bx = p3.x + (p2.x - p3.x) * (s / steps);
          const by = p3.y + (p2.y - p3.y) * (s / steps);
          const i = cellAt(sk, ax + (bx - ax) * (k / 4), ay + (by - ay) * (k / 4));
          if (i >= 0) worst = Math.max(worst, (elevation[i] as number) / altitudeScale);
        }
      }
    }
    const rise = worst - h0;
    out.push(
      rise <= limits.corridorClearWorldM
        ? res(`${a.airport.id} approach`, 'ok', `terrain rises at most ${Math.max(0, Math.round(rise))} m world`)
        : res(`${a.airport.id} approach`, 'fail', `terrain rises ${Math.round(rise)} m world in the approach corridor`),
    );
  }

  // Peak and slopes.
  let peak = -Infinity;
  let steep = 0;
  let landCells = 0;
  let maxSlope = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      if (!sk.land[i]) continue;
      landCells++;
      const e = elevation[i] as number;
      peak = Math.max(peak, e / altitudeScale);
      const s = Math.max(slopeDeg(e - (elevation[i + 1] as number), altitudeScale, grid.cellSize), slopeDeg(e - (elevation[i + cols] as number), altitudeScale, grid.cellSize));
      maxSlope = Math.max(maxSlope, s);
      if (s > limits.slopeWarnDeg) steep++;
    }
  }
  out.push(
    peak <= limits.peakWorldM
      ? res('peak', 'ok', `highest ground ${Math.round(peak)} m world (${Math.round(peak * altitudeScale)} m real)`)
      : res('peak', 'fail', `highest ground ${Math.round(peak)} m world exceeds ${limits.peakWorldM}`),
  );
  const share = landCells > 0 ? steep / landCells : 0;
  out.push(
    share <= limits.slopeWarnShare
      ? res('slope', 'ok', `steepest ${maxSlope.toFixed(1)} deg; ${(share * 100).toFixed(3)}% of land over ${limits.slopeWarnDeg} deg`)
      : res('slope', 'warn', `${(share * 100).toFixed(2)}% of land is over ${limits.slopeWarnDeg} deg (steepest ${maxSlope.toFixed(1)})`),
  );

  // Named places.
  for (const c of placement.cities) {
    const i = cellAt(sk, c.world.x, c.world.y);
    out.push(i >= 0 && sk.land[i] && !water[i] ? res(`${c.city.name} on land`, 'ok', 'center is dry land') : res(`${c.city.name} on land`, 'fail', 'center is not dry land'));
  }
  for (const ch of checks) {
    const p = project(ch.lat, ch.lon);
    const w = placement.field.toWorld(p.x, p.y);
    const i = cellAt(sk, w.x, w.y);
    const name = `check ${ch.id}`;
    if (i < 0) {
      out.push(res(name, 'fail', 'outside the map'));
      continue;
    }
    const e = elevation[i] as number;
    const wet = !sk.land[i] || (water[i] as number) > 0;
    if (ch.expect === 'water') {
      out.push(wet ? res(name, 'ok', 'water') : res(name, 'fail', `expected water, found land at ${e} m`));
    } else if (wet) {
      out.push(res(name, 'fail', 'expected land, found water'));
    } else if (ch.minElevationM !== undefined && e < ch.minElevationM) {
      out.push(res(name, 'fail', `elevation ${e} m is below the expected ${ch.minElevationM} m`));
    } else if (ch.maxElevationM !== undefined && e > ch.maxElevationM) {
      out.push(res(name, 'fail', `elevation ${e} m is above the expected ${ch.maxElevationM} m`));
    } else {
      out.push(res(name, 'ok', `land at ${e} m`));
    }
  }
  return out;
}
