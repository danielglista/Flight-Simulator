import { describe, expect, it } from 'vitest';
import { AIRPORT_PAGE_SIZE } from '../src/config/display';
import type { Airport, Runway } from '../src/sim/world/airport';
import { airportOrder, airportPage, runwayChoices, runwayEnd, sameSelection } from '../src/views/runwaySelect';

const runway: Runway = { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, width: 30, names: ['09', '27'], length: 1000, heading: Math.PI / 2 };
const airport = (ident: string, x: number, y: number): Airport => ({ ident, minX: x - 10, maxX: x + 10, minY: y - 10, maxY: y + 10, runways: [runway] }) as unknown as Airport;
const north = { x: 0, y: 0, heading: 0 };

describe('runway ends', () => {
  const airports = [airport('AAA', 0, 0)];

  it('lists both ends of every runway', () => {
    expect(runwayChoices(airports[0]!).map((c) => [c.name, c.selection.end])).toEqual([['09', 0], ['27', 1]]);
  });

  it('gives the threshold and direction of each end', () => {
    expect(runwayEnd(airports, { ident: 'AAA', runway: 0, end: 0 })).toMatchObject({ name: '09', threshold: { x: 0, y: 0 }, dir: { x: 1, y: 0 } });
    const back = runwayEnd(airports, { ident: 'AAA', runway: 0, end: 1 })!;
    expect(back).toMatchObject({ name: '27', threshold: { x: 1000, y: 0 }, length: 1000 });
    expect(back.dir.x).toBe(-1);
  });

  it('is null with nothing or something unknown picked', () => {
    expect(runwayEnd(airports, null)).toBeNull();
    expect(runwayEnd(airports, { ident: 'ZZZ', runway: 0, end: 0 })).toBeNull();
    expect(runwayEnd(airports, { ident: 'AAA', runway: 3, end: 0 })).toBeNull();
  });

  it('compares selections by value', () => {
    const a = { ident: 'AAA', runway: 0, end: 0 } as const;
    expect(sameSelection(a, { ...a })).toBe(true);
    expect(sameSelection(a, { ...a, end: 1 })).toBe(false);
    expect(sameSelection(a, null)).toBe(false);
    expect(sameSelection(null, null)).toBe(true);
  });
});

describe('airport order', () => {
  const list = [airport('FAR', 0, 9000), airport('BHD', 0, -2000), airport('AHD', 0, 3000)];

  it('puts the destination first, then nearest, favoring those ahead', () => {
    expect(airportOrder(list, north, null)).toEqual(['AHD', 'BHD', 'FAR']);
    expect(airportOrder(list, north, 'FAR')).toEqual(['FAR', 'AHD', 'BHD']);
    expect(airportOrder(list, { ...north, heading: Math.PI }, null)).toEqual(['BHD', 'AHD', 'FAR']);
  });

  it('shows a page at a time and stops at both ends', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(AIRPORT_PAGE_SIZE).toBe(3);
    expect(airportPage(five, 0)).toEqual({ items: ['a', 'b', 'c'], start: 0, back: false, forward: true });
    expect(airportPage(five, 9)).toEqual({ items: ['c', 'd', 'e'], start: 2, back: true, forward: false });
    expect(airportPage(['a', 'b'], 1)).toEqual({ items: ['a', 'b'], start: 0, back: false, forward: false });
  });
});
