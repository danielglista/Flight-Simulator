import { ROUTE_MIN_SPEED, ROUTE_NEAR_M } from '../config/map';
import type { Airport } from '../sim/world/airport';
import type { Craft } from '../sim/state';
import { magneticDeg } from './magnetic';

/** The leg being flown, world meters. */
export interface Route {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly toIdent: string;
}

const middle = (a: Airport): { x: number; y: number } => {
  const rw = a.runways[0];
  return rw ? { x: (rw.a.x + rw.b.x) / 2, y: (rw.a.y + rw.b.y) / 2 } : { x: (a.minX + a.maxX) / 2, y: (a.minY + a.maxY) / 2 };
};

/**
 * First airport to the second, or back again when the flight started on the second one's ground. Null with fewer than
 * two airports.
 */
export function routeFor(airports: readonly Airport[], start: { readonly x: number; readonly y: number; readonly onGround: boolean }): Route | null {
  const [first, second] = airports;
  if (!first || !second) return null;
  const m1 = middle(first);
  const m2 = middle(second);
  const back = start.onGround && Math.hypot(start.x - m2.x, start.y - m2.y) < Math.hypot(start.x - m1.x, start.y - m1.y);
  return back ? { from: m2, to: m1, toIdent: first.ident } : { from: m1, to: m2, toIdent: second.ident };
}

export interface RouteInfo {
  /** Degrees clockwise from magnetic north, 0..359. */
  readonly bearingDeg: number;
  /** Nautical miles between places (world distance x geoDistance), or null close in, where that would mislead. */
  readonly nm: number | null;
  /** Seconds at the present ground speed, or null when too slow to say. */
  readonly seconds: number | null;
}

export function routeInfo(craft: Pick<Craft, 'x' | 'y' | 'speed' | 'pathAngle'>, route: Route, geoDistance: number, variationDeg = 0): RouteInfo {
  const dx = route.to.x - craft.x;
  const dy = route.to.y - craft.y;
  const d = Math.hypot(dx, dy);
  const over = craft.speed * Math.cos(craft.pathAngle);
  return {
    bearingDeg: Math.round(magneticDeg((Math.atan2(dx, dy) * 180) / Math.PI, variationDeg)) % 360,
    nm: d < ROUTE_NEAR_M ? null : (d * geoDistance) / 1852,
    seconds: over < ROUTE_MIN_SPEED ? null : d / over,
  };
}

/** `PHL 054  106 NM  1:01` */
export function routeText(ident: string, info: RouteInfo): string {
  const parts = [`${ident} ${String(info.bearingDeg).padStart(3, '0')}`];
  if (info.nm !== null) parts.push(`${Math.round(info.nm)} NM`);
  if (info.seconds !== null) {
    const s = Math.round(info.seconds);
    parts.push(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }
  return parts.join('  ');
}
