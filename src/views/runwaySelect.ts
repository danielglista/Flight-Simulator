import { AIRPORT_PAGE_SIZE, ORDER_BEHIND_WEIGHT } from '../config/display';
import type { Craft } from '../sim/state';
import type { Airport, Vec2 } from '../sim/world/airport';

/** The runway end picked to land on. View state, like the bugs. */
export interface RunwaySelection {
  readonly ident: string;
  /** Index into the airport's runways. */
  readonly runway: number;
  /** 0 lands from threshold `a` (the first name), 1 from `b`. */
  readonly end: 0 | 1;
}

export const sameSelection = (a: RunwaySelection | null, b: RunwaySelection | null): boolean =>
  a === b || (a !== null && b !== null && a.ident === b.ident && a.runway === b.runway && a.end === b.end);

/** A picked runway end in world terms. */
export interface RunwayEnd {
  readonly ident: string;
  /** `09R` */
  readonly name: string;
  readonly threshold: Vec2;
  /** Unit vector down the runway from the threshold. */
  readonly dir: Vec2;
  readonly length: number;
}

export function runwayEnd(airports: readonly Airport[], sel: RunwaySelection | null): RunwayEnd | null {
  if (!sel) return null;
  const rw = airports.find((a) => a.ident === sel.ident)?.runways[sel.runway];
  if (!rw) return null;
  const sign = sel.end === 0 ? 1 : -1;
  return {
    ident: sel.ident,
    name: rw.names[sel.end],
    threshold: sel.end === 0 ? rw.a : rw.b,
    dir: { x: (sign * (rw.b.x - rw.a.x)) / rw.length, y: (sign * (rw.b.y - rw.a.y)) / rw.length },
    length: rw.length,
  };
}

/** Every runway end of an airport, in the order the menu shows them. */
export function runwayChoices(airport: Airport): readonly { readonly selection: RunwaySelection; readonly name: string }[] {
  return airport.runways.flatMap((rw, runway) => ([0, 1] as const).map((end) => ({ selection: { ident: airport.ident, runway, end }, name: rw.names[end] })));
}

const middle = (a: Airport): Vec2 => ({ x: (a.minX + a.maxX) / 2, y: (a.minY + a.maxY) / 2 });

/**
 * Airports as the menu lists them: the destination first, then nearest first, with those behind the plane counted as
 * ORDER_BEHIND_WEIGHT times as far. Worked out when the menu opens and kept while it is open, so buttons do not move.
 */
export function airportOrder(airports: readonly Airport[], craft: Pick<Craft, 'x' | 'y' | 'heading'>, destination: string | null): string[] {
  const score = (a: Airport): number => {
    const dx = middle(a).x - craft.x;
    const dy = middle(a).y - craft.y;
    const ahead = dx * Math.sin(craft.heading) + dy * Math.cos(craft.heading) >= 0;
    return Math.hypot(dx, dy) * (ahead ? 1 : ORDER_BEHIND_WEIGHT);
  };
  const rank = (a: Airport): number => (a.ident === destination ? -1 : score(a));
  return [...airports].sort((a, b) => rank(a) - rank(b)).map((a) => a.ident);
}

/** The AIRPORT_PAGE_SIZE entries shown from `start`, and whether the arrows lead anywhere. */
export function airportPage<T>(list: readonly T[], start: number): { readonly items: readonly T[]; readonly start: number; readonly back: boolean; readonly forward: boolean } {
  const last = Math.max(0, list.length - AIRPORT_PAGE_SIZE);
  const from = Math.min(last, Math.max(0, start));
  return { items: list.slice(from, from + AIRPORT_PAGE_SIZE), start: from, back: from > 0, forward: from < last };
}
