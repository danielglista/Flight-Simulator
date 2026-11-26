import { describe, expect, it } from 'vitest';
import { buildAirport, type Airport } from '../src/sim/world/airport';
import { airStartFor } from '../src/sim/world/startList';
import { TEST_AIRPORT_DEF } from '../src/sim/world/testAirport';
import { AIR_START } from '../src/sim/state';
import { bestApproach } from '../src/views/approach';
import { routeFor, routeInfo, routeText } from '../src/views/route';
import { remainingOnAny } from '../src/views/takeoffStrip';

const at = (ident: string, x: number, y: number): Airport => buildAirport({ ...TEST_AIRPORT_DEF, ident, anchor: { x, y } });
const a = at('AAA', 2000, 2000);
const b = at('BBB', 2000, 9000);
const mid = (p: Airport) => ({ x: (p.runways[0]!.a.x + p.runways[0]!.b.x) / 2, y: (p.runways[0]!.a.y + p.runways[0]!.b.y) / 2 });

describe('routeFor', () => {
  it('goes from the first airport to the second, and back after a ground start on the second', () => {
    expect(routeFor([a, b], { ...mid(a), onGround: true })?.toIdent).toBe('BBB');
    expect(routeFor([a, b], { ...mid(b), onGround: true })?.toIdent).toBe('AAA');
    expect(routeFor([a, b], { ...mid(b), onGround: false })?.toIdent).toBe('BBB');
    expect(routeFor([a], { ...mid(a), onGround: true })).toBeNull();
  });
});

describe('routeInfo and routeText', () => {
  const route = { from: { x: 0, y: 0 }, to: { x: 0, y: 7900 }, toIdent: 'PHL' };
  it('gives bearing, scaled nautical miles and time to go', () => {
    const info = routeInfo({ x: 0, y: 0, speed: 128.6, pathAngle: 0 }, route, 25);
    expect(info.bearingDeg).toBe(0);
    expect(info.nm).toBeCloseTo((7900 * 25) / 1852, 6);
    expect(info.seconds).toBeCloseTo(7900 / 128.6, 6);
    expect(routeText('PHL', info)).toBe('PHL 000  107 NM  1:01');
  });
  it('drops the miles close in and the time when too slow', () => {
    expect(routeText('PHL', routeInfo({ x: 0, y: 7000, speed: 70, pathAngle: 0 }, route, 25))).toBe('PHL 000  0:13');
    expect(routeText('PHL', routeInfo({ x: 100, y: 0, speed: 0, pathAngle: 0 }, route, 25))).toBe('PHL 359  107 NM');
  });
});

describe('with several runways', () => {
  const rw = a.runways[0]!;
  const ux = (rw.b.x - rw.a.x) / rw.length;
  const uy = (rw.b.y - rw.a.y) / rw.length;
  const runways = [a.runways[0]!, b.runways[0]!];
  it('guides to the runway the plane is lined up with', () => {
    const far = b.runways[0]!;
    const craft = { x: far.a.x - ux * 800, y: far.a.y - uy * 800, z: 40, heading: far.heading, onGround: false, gear: 1, pathAngle: -0.05 };
    expect(bestApproach(craft, 40, false, runways, () => 0)?.threshold).toEqual(far.a);
    expect(bestApproach({ ...craft, x: 50000, y: 0 }, 40, false, runways, () => 0)).toBeNull();
  });
  it('counts the runway left on whichever runway the plane is over', () => {
    const far = b.runways[0]!;
    expect(remainingOnAny(runways, { x: far.a.x, y: far.a.y, heading: far.heading })).toBe(Math.round(far.length));
    expect(remainingOnAny(runways, { x: 0, y: 0, heading: 0 })).toBeNull();
  });
});

describe('airStartFor', () => {
  it('is halfway between two airports, heading for the second', () => {
    const s = airStartFor([a, b]);
    expect(s.y).toBeCloseTo((a.runways[0]!.a.y + b.runways[0]!.a.y) / 2, 6);
    expect(s.heading).toBeCloseTo(0, 6);
    expect(airStartFor([a])).toBe(AIR_START);
  });
});
