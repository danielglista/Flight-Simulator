import type { Tuning } from '../../config/motion';
import { AIR_START, type StartSpec } from '../state';
import type { Airport } from './airport';
import { finalStart, runwayStart } from './starts';

export interface NamedStart {
  /** Button text: `DCA runway`, `PHL final`, `Air`. */
  readonly label: string;
  /** What the page address selects with `?start=` and `?airport=`. */
  readonly kind: 'runway' | 'final' | 'air';
  readonly airport: string | null;
  readonly spec: StartSpec;
}

/** Level flight halfway from the first airport to the second, heading for it; otherwise the test map's air start. */
export function airStartFor(airports: readonly Airport[]): StartSpec {
  const a = airports[0]?.runways[0];
  const b = airports[1]?.runways[0];
  if (!a || !b) return AIR_START;
  const x = (a.a.x + b.a.x) / 2;
  const y = (a.a.y + b.a.y) / 2;
  const h = Math.atan2(b.a.x - a.a.x, b.a.y - a.a.y);
  return { ...AIR_START, x, y, heading: h < 0 ? h + 2 * Math.PI : h };
}

/** A runway and a final start on every airport's first runway (its first name), then the air start. */
export function startList(
  airports: readonly Airport[],
  heightAt: (x: number, y: number) => number,
  altitudeScale: number,
  tuning: Tuning,
): NamedStart[] {
  const out: NamedStart[] = [];
  for (const a of airports) {
    const rw = a.runways[0];
    if (!rw) continue;
    out.push({ label: `${a.ident} runway`, kind: 'runway', airport: a.ident, spec: runwayStart(rw, heightAt) });
    out.push({ label: `${a.ident} final`, kind: 'final', airport: a.ident, spec: finalStart(rw, heightAt, altitudeScale, tuning) });
  }
  out.push({ label: 'Air', kind: 'air', airport: null, spec: airports.length > 1 ? airStartFor(airports) : AIR_START });
  return out;
}

/** The start the page address asks for; anything unknown means the first airport's runway. */
export function pickStart(starts: readonly NamedStart[], kind: string | null, airport: string | null): NamedStart | undefined {
  const k = kind === 'final' || kind === 'air' ? kind : 'runway';
  const matches = starts.filter((s) => s.kind === k);
  return matches.find((s) => s.airport !== null && s.airport === airport?.toUpperCase()) ?? matches[0];
}
