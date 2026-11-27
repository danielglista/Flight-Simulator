import { project, type PointKm } from './project';
import type { Airport, City, MapBox, MapScales, PlacesFile } from './types';
import { makeField, type MapField, type Stamp } from './stamp';
import { makeWarp, type Warp, type WarpShape } from './warp';
import { convexOverlap, type Polygon } from '../../src/sim/world/polygon';

/** Clear space kept between an airport outline and a city core box, world km. */
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
  /**
   * The convex shape, world km, counterclockwise, that bends the land and is kept clear: of city cores and other
   * airports, of districts and of highways.
   */
  readonly outline: Polygon;
  /** Real km per world km of this airport. */
  readonly scale: number;
  /** The ground polygons, world km. */
  readonly ground: readonly Polygon[];
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

/** An airport's ground polygons in real km from its center, x east, y north. */
export function groundLocalKm(a: Airport): Polygon[] {
  const c = project(a.lat, a.lon);
  return a.ground.map((ring) =>
    ring.map(([lon, lat]) => {
      const q = project(lat, lon);
      return { x: q.x - c.x, y: q.y - c.y };
    }),
  );
}

/** The outline in real km from the airport center, counterclockwise. For now the `boundaryKm` box. */
export function outlineLocalKm(a: Airport): Polygon {
  return boxPolygon({ cx: 0, cy: 0, w: a.boundaryKm.w, h: a.boundaryKm.h });
}

/** A box's corners, counterclockwise from the southwest. */
export function boxPolygon(b: BoxKm): Polygon {
  const x0 = b.cx - b.w / 2;
  const x1 = b.cx + b.w / 2;
  const y0 = b.cy - b.h / 2;
  const y1 = b.cy + b.h / 2;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** The upright box around a polygon. */
export function boundsOf(p: Polygon): BoxKm {
  const xs = p.map((v) => v.x);
  const ys = p.map((v) => v.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
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
    const local = outlineLocalKm(a);

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
    const centerAt = (d: number): PointKm => ({ x: city.world.x + ux * d + shift.x, y: city.world.y + uy * d + shift.y });
    const place = (ring: Polygon, c: PointKm): Polygon => ring.map((v) => ({ x: c.x + v.x / scale, y: c.y + v.y / scale }));

    let d = a.pushOverrideKm ?? distanceBefore;
    if (a.pushOverrideKm === undefined) {
      const core = boxPolygon(city.core);
      while (convexOverlap(place(local, centerAt(d)), core, AIRPORT_GAP_KM)) {
        d += PUSH_STEP_KM;
        if (d > PUSH_LIMIT_KM) throw new PlaceError(`airport ${a.id} could not be pushed clear of ${city.city.name}`);
      }
    }
    const world = centerAt(d);
    const corridor = corridorFor(world, a.runwayHeadingDeg);
    placed.push({
      airport: a,
      real,
      warped,
      world,
      outline: place(local, world),
      scale,
      ground: groundLocalKm(a).map((ring) => place(ring, world)),
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
      if (convexOverlap(p.outline, boxPolygon(c.core))) throw new PlaceError(`airport ${p.airport.id} overlaps the core of ${c.city.name}`);
    }
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i] as PlacedAirport;
      const b = placed[j] as PlacedAirport;
      if (convexOverlap(a.outline, b.outline)) throw new PlaceError(`airports ${a.airport.id} and ${b.airport.id} overlap`);
    }
  }

  const stamps: Stamp[] = placed.flatMap((p) => {
    const fade = p.airport.stampFadeKm;
    if (fade === undefined) return [];
    return [{ id: p.airport.id, real: p.real, outline: outlineLocalKm(p.airport), world: p.world, scale: p.scale, fadeKm: fade }];
  });
  return { warp, field: makeField(warp, stamps), box: wbox, cities, airports: placed };
}

/** Straight-line distance in world km between two placed points. */
export function distanceKm(a: PointKm, b: PointKm): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
