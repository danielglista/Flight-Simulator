import { project, type PointKm } from './project';
import type { Airport, City, MapBox, MapScales, PlacesFile } from './types';
import { makeField, type MapField, type Stamp } from './stamp';
import { makeWarp, type Warp, type WarpShape } from './warp';

/** Clear space kept between an airport boundary and a city core box, world km. */
export const AIRPORT_GAP_KM = 0.1;
/** Approach corridor length each way from the airport center, and its full width, world km. */
export const CORRIDOR_LENGTH_KM = 4;
export const CORRIDOR_WIDTH_KM = 1;
/** Push step, world km. */
const PUSH_STEP_KM = 0.01;
const PUSH_LIMIT_KM = 50;

export class PlaceError extends Error {}

export interface BoxKm {
  readonly cx: number;
  readonly cy: number;
  /** Full width and height. */
  readonly w: number;
  readonly h: number;
}

export interface PlacedCity {
  readonly city: City;
  readonly real: PointKm;
  /** World km. */
  readonly world: PointKm;
  readonly core: BoxKm;
}

export interface PlacedAirport {
  readonly airport: Airport;
  readonly real: PointKm;
  /** Where plain warping puts it, world km. */
  readonly warped: PointKm;
  /** Final center, world km. */
  readonly world: PointKm;
  readonly boundary: BoxKm;
  /** World distance from the city center, before and after the push. */
  /** World km the stamp center moves so its anchor (not its center) stays put; zero without an anchor. */
  readonly anchorShiftKm: PointKm;
  readonly distanceBeforeKm: number;
  readonly distanceAfterKm: number;
  readonly pushedKm: number;
  /** Rotated approach corridor corners, world km. */
  readonly corridor: readonly PointKm[];
  readonly corridorInBox: boolean;
}

export interface Placement {
  readonly warp: Warp;
  /** The warp plus airport stamps that bend the land around them: use this for everything drawn on the map. */
  readonly field: MapField;
  /** World km. */
  readonly box: BoxKm;
  readonly cities: readonly PlacedCity[];
  readonly airports: readonly PlacedAirport[];
}

export function overlaps(a: BoxKm, b: BoxKm, gapKm = 0): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + gapKm && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + gapKm;
}

/** World-frame box for a lat/lon box, unwarped at its edge. */
export function worldBox(box: MapBox, geoDistance: number): BoxKm {
  const sw = project(box.south, box.west);
  const ne = project(box.north, box.east);
  const sg = 1 / geoDistance;
  return { cx: ((sw.x + ne.x) / 2) * sg, cy: ((sw.y + ne.y) / 2) * sg, w: (ne.x - sw.x) * sg, h: (ne.y - sw.y) * sg };
}

function inside(box: BoxKm, p: PointKm): boolean {
  return Math.abs(p.x - box.cx) <= box.w / 2 && Math.abs(p.y - box.cy) <= box.h / 2;
}

function corridorFor(center: PointKm, headingDeg: number): PointKm[] {
  const h = (headingDeg * Math.PI) / 180;
  const ux = Math.sin(h);
  const uy = Math.cos(h);
  const px = uy; // perpendicular, to the right
  const py = -ux;
  const L = CORRIDOR_LENGTH_KM;
  const W = CORRIDOR_WIDTH_KM / 2;
  return [
    { x: center.x - ux * L - px * W, y: center.y - uy * L - py * W },
    { x: center.x + ux * L - px * W, y: center.y + uy * L - py * W },
    { x: center.x + ux * L + px * W, y: center.y + uy * L + py * W },
    { x: center.x - ux * L + px * W, y: center.y - uy * L + py * W },
  ];
}

export function placeAll(
  scales: MapScales,
  box: MapBox,
  warpShape: WarpShape,
  places: PlacesFile,
): Placement {
  const realCities = places.cities.map((c) => ({ c, real: project(c.lat, c.lon) }));
  const warp = makeWarp(
    scales.geoDistance,
    scales.cityCore,
    realCities.map(({ c, real }) => {
      if (!c.warp) return { id: c.id, x: real.x, y: real.y };
      const center = project(c.warp.lat, c.warp.lon);
      return { id: c.id, x: center.x, y: center.y, shape: { ...warpShape, coreKm: c.warp.coreKm, rampKm: c.warp.rampKm } };
    }),
    warpShape,
  );
  const wbox = worldBox(box, scales.geoDistance);

  const cities: PlacedCity[] = realCities.map(({ c, real }) => {
    const world = warp.toWorld(real.x, real.y);
    return {
      city: c,
      real,
      world,
      core: { cx: world.x, cy: world.y, w: c.coreKm.w / scales.cityCore, h: c.coreKm.h / scales.cityCore },
    };
  });

  const placed: PlacedAirport[] = [];
  for (const a of places.airports) {
    const city = cities.find((c) => c.city.id === a.cityId);
    if (!city) throw new PlaceError(`airport ${a.id}: unknown city "${a.cityId}"`);
    const scale = a.size === 'major' ? scales.airportMajor : scales.airportSmall;
    const real = project(a.lat, a.lon);
    const warped = warp.toWorld(real.x, real.y);
    const boundaryW = a.boundaryKm.w / scale;
    const boundaryH = a.boundaryKm.h / scale;

    // Real bearing from the city center; warping is radial so the world bearing is the same.
    const dx = real.x - city.real.x;
    const dy = real.y - city.real.y;
    const rReal = Math.hypot(dx, dy);
    if (rReal === 0) throw new PlaceError(`airport ${a.id} sits exactly on the center of ${city.city.name}`);
    const ux = dx / rReal;
    const uy = dy / rReal;

    const distanceBefore = Math.hypot(warped.x - city.world.x, warped.y - city.world.y);
    // With an anchor, the stamp center sits so the anchor lands where the warp would put it.
    const an = a.stampAnchorKm ?? { x: 0, y: 0 };
    const wa = warp.toWorld(real.x + an.x, real.y + an.y);
    const shift = { x: wa.x - warped.x - an.x / scale, y: wa.y - warped.y - an.y / scale };
    const boxAt = (d: number): BoxKm => ({ cx: city.world.x + ux * d + shift.x, cy: city.world.y + uy * d + shift.y, w: boundaryW, h: boundaryH });

    let d = a.pushOverrideKm ?? distanceBefore;
    if (a.pushOverrideKm === undefined) {
      while (overlaps(boxAt(d), city.core, AIRPORT_GAP_KM)) {
        d += PUSH_STEP_KM;
        if (d > PUSH_LIMIT_KM) throw new PlaceError(`airport ${a.id} could not be pushed clear of ${city.city.name}`);
      }
    }
    const b = boxAt(d);
    const world = { x: b.cx, y: b.cy };
    const corridor = corridorFor(world, a.runwayHeadingDeg);
    placed.push({
      airport: a,
      real,
      warped,
      world,
      boundary: b,
      anchorShiftKm: shift,
      distanceBeforeKm: distanceBefore,
      distanceAfterKm: d,
      pushedKm: d - distanceBefore,
      corridor,
      corridorInBox: corridor.every((p) => inside(wbox, p)),
    });
  }

  // Nothing may overlap: each airport against every core and every other airport.
  for (const p of placed) {
    for (const c of cities) {
      if (overlaps(p.boundary, c.core)) throw new PlaceError(`airport ${p.airport.id} overlaps the core of ${c.city.name}`);
    }
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i] as PlacedAirport;
      const b = placed[j] as PlacedAirport;
      if (overlaps(a.boundary, b.boundary)) throw new PlaceError(`airports ${a.airport.id} and ${b.airport.id} overlap`);
    }
  }

  const stamps: Stamp[] = placed.flatMap((p) => {
    const fade = p.airport.stampFadeKm;
    if (fade === undefined) return [];
    const scale = p.airport.boundaryKm.w / p.boundary.w;
    return [{ id: p.airport.id, real: p.real, halfW: p.airport.boundaryKm.w / 2, halfH: p.airport.boundaryKm.h / 2, world: p.world, scale, fadeKm: fade }];
  });
  return { warp, field: makeField(warp, stamps), box: wbox, cities, airports: placed };
}

/** Straight-line distance in world km between two placed points. */
export function distanceKm(a: PointKm, b: PointKm): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
