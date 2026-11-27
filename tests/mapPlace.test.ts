import { describe, expect, it } from 'vitest';
import placesJson from '../data/map/places.json';
import scalesJson from '../data/map/scales.json';
import { distanceKm, groundLocalKm, overlaps, placeAll, PlaceError } from '../tools/map/place';
import { MapDataError, validatePlaces, validateScales } from '../tools/map/validate';

const sf = validateScales(scalesJson);
const places = validatePlaces(placesJson);
const dca = places.airports[0]!;

function at(geo: number) {
  return placeAll({ ...sf.scales, geoDistance: geo }, sf.box, sf.warp, places);
}

describe('data files', () => {
  it('validate', () => {
    expect(sf.scales.geoDistance).toBe(25);
    expect(places.cities).toHaveLength(2);
    expect(places.airports.map((a) => a.id)).toEqual(['DCA', 'PHL']);
  });
  it('give named errors for bad data', () => {
    expect(() => validateScales({})).toThrow(MapDataError);
    expect(() => validateScales({ ...scalesJson, box: { ...scalesJson.box, south: 50 } })).toThrow(/south/);
    expect(() => validatePlaces(null)).toThrow(/places/);
    expect(() => validatePlaces({ cities: [], airports: [] })).toThrow(/cities/);
    const bad = { cities: placesJson.cities, airports: [{ ...placesJson.airports[0], cityId: 'nowhere' }] };
    expect(() => validatePlaces(bad)).toThrow(/DCA/);
    const noLat = { cities: [{ ...placesJson.cities[0], lat: 'x' }], airports: [] };
    expect(() => validatePlaces(noLat)).toThrow(/cities\[0\]\.lat/);
  });
  it('rejects bad airport ground, naming the airport (E7.2)', () => {
    const [dca] = placesJson.airports;
    const of = (ground: unknown) => () => validatePlaces({ cities: placesJson.cities, airports: [{ ...dca, ground }] });
    const [a, b, c, d] = dca!.ground[0]!;
    expect(of(undefined)).toThrow(/ground.*DCA/);
    expect(of([])).toThrow(/non-empty.*DCA/);
    expect(of([[a, b]])).toThrow(/at least 3 points.*DCA/);
    expect(of([[a, c, b, d]])).toThrow(/cross.*DCA/);
    expect(of([[a, b, c, a]])).toThrow(/repeat.*DCA/);
    expect(of([[a, b, [200, 0]]])).toThrow(/out of range/);
    // Either winding, and a thin strip, are fine.
    expect(of([[d, c, b, a]])).not.toThrow();
  });
});

describe('airport ground (E7.2)', () => {
  it('is placed about the airport center at its own scale', () => {
    const pl = placeAll(sf.scales, sf.box, sf.warp, places);
    for (const a of pl.airports) {
      const scale = sf.scales.airportMajor;
      groundLocalKm(a.airport).forEach((ring, k) => {
        ring.forEach((q, i) => {
          expect(a.ground[k]![i]!.x).toBeCloseTo(a.boundary.cx + q.x / scale, 9);
          expect(a.ground[k]![i]!.y).toBeCloseTo(a.boundary.cy + q.y / scale, 9);
        });
      });
    }
  });
  it('converts DCA\'s runway strip to a 2.4 km by 100 m outline', () => {
    const [strip] = groundLocalKm(places.airports[0]!);
    const side = (i: number) => Math.hypot(strip![(i + 1) % 4]!.x - strip![i]!.x, strip![(i + 1) % 4]!.y - strip![i]!.y);
    expect(side(0)).toBeCloseTo(0.1, 3);
    expect(side(1)).toBeCloseTo(2.4, 3);
  });
});

describe('placement', () => {
  for (const geo of [20, 25, 30]) {
    it(`keeps airports clear of cores and each other at 1:${geo}`, () => {
      const pl = at(geo);
      for (const a of pl.airports) for (const c of pl.cities) expect(overlaps(a.boundary, c.core)).toBe(false);
      expect(overlaps(pl.airports[0]!.boundary, pl.airports[1]!.boundary)).toBe(false);
    });
  }
  it('pushes along the real bearing from the city', () => {
    const pl = at(25);
    for (const a of pl.airports) {
      const city = pl.cities.find((c) => c.city.id === a.airport.cityId)!;
      const rx = a.real.x - city.real.x;
      const ry = a.real.y - city.real.y;
      const wx = a.world.x - a.anchorShiftKm.x - city.world.x;
      const wy = a.world.y - a.anchorShiftKm.y - city.world.y;
      expect(wx / Math.hypot(wx, wy)).toBeCloseTo(rx / Math.hypot(rx, ry), 9);
      expect(wy / Math.hypot(wx, wy)).toBeCloseTo(ry / Math.hypot(rx, ry), 9);
      expect(a.pushedKm).toBeGreaterThanOrEqual(0);
    }
  });
  it('gives the planned trip length at 1:25', () => {
    const pl = at(25);
    const cityToCity = distanceKm(pl.cities[0]!.world, pl.cities[1]!.world);
    expect(cityToCity).toBeGreaterThan(7.9);
    expect(cityToCity).toBeLessThan(8.1);
    const trip = distanceKm(pl.airports[0]!.world, pl.airports[1]!.world);
    expect(trip).toBeGreaterThan(7.7);
    expect(trip).toBeLessThan(8.1);
  });
  it('sizes the boundary by the airport scale', () => {
    const pl = at(25);
    expect(pl.airports[0]!.boundary.w).toBeCloseTo(1.2 / 2, 9);
    expect(pl.airports[1]!.boundary.w).toBeCloseTo(3.4 / 2, 9);
  });
  it('honors a hand override', () => {
    const custom = { ...places, airports: [{ ...dca, pushOverrideKm: 3 }] };
    const pl = placeAll(sf.scales, sf.box, sf.warp, custom);
    expect(pl.airports[0]!.distanceAfterKm).toBe(3);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(at(25))).toBe(JSON.stringify(at(25)));
  });
  it('fails by name when airports overlap or a city is unknown', () => {
    const twin = { ...places, airports: [dca, { ...dca, id: 'TWIN' }] };
    expect(() => placeAll(sf.scales, sf.box, sf.warp, twin)).toThrow(PlaceError);
    const lost = { ...places, airports: [{ ...dca, cityId: 'zzz' }] };
    expect(() => placeAll(sf.scales, sf.box, sf.warp, lost)).toThrow(/zzz/);
  });
  it('reports the PHL corridor inside the box', () => {
    expect(at(25).airports[1]!.corridorInBox).toBe(true);
  });
});
