import { DEFAULT_GRID, DENSITIES, DISTRICT_TYPES, type BuildingStyle, type Density, type District, type DistrictsFile, type DistrictType, type GridSettings, type HousingLevel, type RoadsFile } from './types';
import type { Airport, AuthoredRiver, City, LonLatPoint, MapBox, MapScales, PlacesFile, ScalesFile, WaterFile, WaterRegion } from './types';
import type { LandmarkDecorSpec, LandmarkSolidSpec, LandmarkSpec, LandmarksFile } from './types';
import { TOWN_SIZES, TOWN_TYPES, type KitFile, type KitPiece, type KitSpot, type Town, type TownSize, type TownType } from './types';
import type { WarpShape } from './warp';
import { contains, selfCrossing } from '../../src/sim/world/polygon';
import { outlineLocalKm } from './place';
import { project } from './project';

export class MapDataError extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MapDataError(`${path}: expected an object`);
  return v as Obj;
}

function num(o: Obj, key: string, path: string, opts: { min?: number; max?: number; positive?: boolean } = {}): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MapDataError(`${path}.${key}: expected a number`);
  if (opts.positive && !(v > 0)) throw new MapDataError(`${path}.${key}: must be positive, got ${v}`);
  if (opts.min !== undefined && v < opts.min) throw new MapDataError(`${path}.${key}: must be at least ${opts.min}, got ${v}`);
  if (opts.max !== undefined && v > opts.max) throw new MapDataError(`${path}.${key}: must be at most ${opts.max}, got ${v}`);
  return v;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new MapDataError(`${path}.${key}: expected a non-empty string`);
  return v;
}

function size(o: Obj, key: string, path: string): { w: number; h: number } {
  const s = obj(o[key], `${path}.${key}`);
  return { w: num(s, 'w', `${path}.${key}`, { positive: true }), h: num(s, 'h', `${path}.${key}`, { positive: true }) };
}

export function validateScales(data: unknown): ScalesFile {
  const root = obj(data, 'scales');
  const p = 'scales.scales';
  const s = obj(root['scales'], p);
  const scales: MapScales = {
    geoDistance: num(s, 'geoDistance', p, { positive: true }),
    airportMajor: num(s, 'airportMajor', p, { positive: true }),
    airportSmall: num(s, 'airportSmall', p, { positive: true }),
    cityCore: num(s, 'cityCore', p, { positive: true }),
    altitude: num(s, 'altitude', p, { positive: true }),
    buildingHeight: num(s, 'buildingHeight', p, { positive: true }),
  };
  const b = obj(root['box'], 'scales.box');
  const box: MapBox = {
    south: num(b, 'south', 'scales.box', { min: -90, max: 90 }),
    north: num(b, 'north', 'scales.box', { min: -90, max: 90 }),
    west: num(b, 'west', 'scales.box', { min: -180, max: 180 }),
    east: num(b, 'east', 'scales.box', { min: -180, max: 180 }),
  };
  if (box.south >= box.north) throw new MapDataError('scales.box: south must be below north');
  if (box.west >= box.east) throw new MapDataError('scales.box: west must be left of east');
  const w = obj(root['warp'], 'scales.warp');
  const warp: WarpShape = {
    coreKm: num(w, 'coreKm', 'scales.warp', { positive: true }),
    rampKm: num(w, 'rampKm', 'scales.warp', { positive: true }),
    plateauEndKm: num(w, 'plateauEndKm', 'scales.warp', { positive: true }),
    ringKm: num(w, 'ringKm', 'scales.warp', { positive: true }),
  };
  let grid: GridSettings = DEFAULT_GRID;
  if (root['grid'] !== undefined) {
    const g = obj(root['grid'], 'scales.grid');
    grid = {
      baseCellM: num(g, 'baseCellM', 'scales.grid', { positive: true }),
      patchCellM: num(g, 'patchCellM', 'scales.grid', { positive: true }),
      patchMarginKm: num(g, 'patchMarginKm', 'scales.grid', { min: 0 }),
    };
  }
  if (grid.patchCellM > grid.baseCellM) throw new MapDataError('scales.grid: patchCellM must not be larger than baseCellM');
  const ratio = grid.baseCellM / grid.patchCellM;
  if (Math.abs(ratio - Math.round(ratio)) > 1e-9) throw new MapDataError(`scales.grid: baseCellM (${grid.baseCellM}) must be a whole multiple of patchCellM (${grid.patchCellM})`);
  return { scales, grid, box, warp };
}

export function validatePlaces(data: unknown): PlacesFile {
  const root = obj(data, 'places');
  const rawCities = root['cities'];
  const rawAirports = root['airports'];
  if (!Array.isArray(rawCities) || rawCities.length === 0) throw new MapDataError('places.cities: expected a non-empty list');
  if (!Array.isArray(rawAirports)) throw new MapDataError('places.airports: expected a list');
  const cities: City[] = [];
  const ids = new Set<string>();
  rawCities.forEach((raw: unknown, i: number) => {
    const p = `places.cities[${i}]`;
    const o = obj(raw, p);
    const id = str(o, 'id', p);
    if (ids.has(id)) throw new MapDataError(`${p}.id: duplicate id "${id}"`);
    ids.add(id);
    const city: City = {
      id,
      name: str(o, 'name', p),
      lat: num(o, 'lat', p, { min: -90, max: 90 }),
      lon: num(o, 'lon', p, { min: -180, max: 180 }),
      coreKm: size(o, 'coreKm', p),
    };
    let full: City = city;
    if (o['hills'] !== undefined) {
      const h = obj(o['hills'], `${p}.hills`);
      full = { ...full, hills: { amplitudeM: num(h, 'amplitudeM', `${p}.hills`, { min: 0 }), featureKm: num(h, 'featureKm', `${p}.hills`, { positive: true }) } };
    }
    if (o['warp'] !== undefined) {
      const q = `${p}.warp`;
      const w = obj(o['warp'], q);
      full = {
        ...full,
        warp: { lat: num(w, 'lat', q, { min: -90, max: 90 }), lon: num(w, 'lon', q, { min: -180, max: 180 }), coreKm: num(w, 'coreKm', q, { positive: true }), rampKm: num(w, 'rampKm', q, { positive: true }) },
      };
    }
    cities.push(full);
  });
  const airports: Airport[] = [];
  const aids = new Set<string>();
  rawAirports.forEach((raw: unknown, i: number) => {
    const p = `places.airports[${i}]`;
    const o = obj(raw, p);
    const id = str(o, 'id', p);
    if (aids.has(id)) throw new MapDataError(`${p}.id: duplicate id "${id}"`);
    aids.add(id);
    const cityId = o['cityId'] === undefined ? undefined : str(o, 'cityId', p);
    if (cityId !== undefined && !ids.has(cityId)) throw new MapDataError(`${p}.cityId: unknown city "${cityId}" (airport ${id})`);
    if (cityId === undefined && o['pushOverrideKm'] !== undefined) throw new MapDataError(`${p}.pushOverrideKm: there is no city to push from (airport ${id})`);
    const sz = o['size'];
    if (sz !== 'major' && sz !== 'small') throw new MapDataError(`${p}.size: expected "major" or "small" (airport ${id})`);
    const base = {
      id,
      name: str(o, 'name', p),
      ...(cityId === undefined ? {} : { cityId }),
      lat: num(o, 'lat', p, { min: -90, max: 90 }),
      lon: num(o, 'lon', p, { min: -180, max: 180 }),
      size: sz,
      runwayHeadingDeg: num(o, 'runwayHeadingDeg', p, { min: 0, max: 360 }),
    } as const;
    let extra: { elevationM?: number; pushOverrideKm?: number; stampFadeKm?: number; stampAnchorKm?: { x: number; y: number } } = {};
    const ground = groundPolygons(o['ground'], `${p}.ground`, id);
    if (o['elevationM'] !== undefined) extra = { ...extra, elevationM: num(o, 'elevationM', p) };
    if (o['pushOverrideKm'] !== undefined) extra = { ...extra, pushOverrideKm: num(o, 'pushOverrideKm', p, { positive: true }) };
    if (o['stampFadeKm'] !== undefined) extra = { ...extra, stampFadeKm: num(o, 'stampFadeKm', p, { positive: true }) };
    if (o['stampAnchorKm'] !== undefined) {
      const q = `${p}.stampAnchorKm`;
      const an = obj(o['stampAnchorKm'], q);
      const anchor = { x: num(an, 'x', q), y: num(an, 'y', q) };
      if (!contains(outlineLocalKm({ lat: base.lat, lon: base.lon, ground }), anchor.x, anchor.y)) throw new MapDataError(`${q}: must lie inside the outline of the ground (airport ${id})`);
      extra = { ...extra, stampAnchorKm: anchor };
    }
    airports.push({ ...base, ground, ...extra });
  });
  return { cities, airports };
}

function groundPolygons(v: unknown, path: string, airport: string): LonLatPoint[][] {
  if (!Array.isArray(v) || v.length === 0) throw new MapDataError(`${path}: expected a non-empty list of polygons (airport ${airport})`);
  return v.map((ring: unknown, k: number) => {
    const q = `${path}[${k}]`;
    if (!Array.isArray(ring) || ring.length < 3) throw new MapDataError(`${q}: expected at least 3 points (airport ${airport})`);
    const points = ring.map((c: unknown, i: number) => lonLat(c, `${q}[${i}]`, 2) as unknown as LonLatPoint);
    // Checked in km: degrees are too small a unit for the geometry's tolerance.
    if (selfCrossing(points.map(([lon, lat]) => project(lat, lon)))) throw new MapDataError(`${q}: edges must not cross or touch, nor a point repeat (airport ${airport})`);
    return points;
  });
}

function lonLat(v: unknown, path: string, len: 2 | 3): number[] {
  if (!Array.isArray(v) || v.length !== len || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new MapDataError(`${path}: expected [lon, lat${len === 3 ? ', widthM' : ''}]`);
  }
  const [lon, lat] = v as number[];
  if (Math.abs(lon as number) > 180 || Math.abs(lat as number) > 90) throw new MapDataError(`${path}: lon or lat out of range`);
  return v as number[];
}

export function validateWater(data: unknown): WaterFile {
  const root = obj(data, 'water');
  const minWidthM = num(root, 'minWidthM', 'water', { positive: true });
  const rr = root['regions'];
  const rv = root['rivers'];
  if (!Array.isArray(rr)) throw new MapDataError('water.regions: expected a list');
  if (!Array.isArray(rv)) throw new MapDataError('water.rivers: expected a list');
  const ids = new Set<string>();
  const id = (o: Obj, p: string): string => {
    const v = str(o, 'id', p);
    if (ids.has(v)) throw new MapDataError(`${p}.id: duplicate id "${v}"`);
    ids.add(v);
    return v;
  };
  const regions: WaterRegion[] = rr.map((raw: unknown, i: number) => {
    const p = `water.regions[${i}]`;
    const o = obj(raw, p);
    const rid = id(o, p);
    const ring = o['ring'];
    if (!Array.isArray(ring) || ring.length < 3) throw new MapDataError(`${p}.ring: expected at least 3 points (region ${rid})`);
    return { id: rid, ring: ring.map((q: unknown, k: number) => lonLat(q, `${p}.ring[${k}]`, 2) as unknown as LonLatPoint) };
  });
  const rivers: AuthoredRiver[] = rv.map((raw: unknown, i: number) => {
    const p = `water.rivers[${i}]`;
    const o = obj(raw, p);
    const rid = id(o, p);
    if (typeof o['tidal'] !== 'boolean') throw new MapDataError(`${p}.tidal: expected true or false (river ${rid})`);
    const pts = o['points'];
    if (!Array.isArray(pts) || pts.length < 2) throw new MapDataError(`${p}.points: expected at least 2 points (river ${rid})`);
    const points = pts.map((q: unknown, k: number) => {
      const v = lonLat(q, `${p}.points[${k}] (river ${rid})`, 3);
      if (!((v[2] as number) > 0)) throw new MapDataError(`${p}.points[${k}]: width must be positive (river ${rid})`);
      return v as unknown as readonly [number, number, number];
    });
    const wi = o['widthIn'];
    if (wi !== undefined && wi !== 'real' && wi !== 'world') throw new MapDataError(`${p}.widthIn: expected "real" or "world" (river ${rid})`);
    return wi === undefined ? { id: rid, tidal: o['tidal'], points } : { id: rid, tidal: o['tidal'], widthIn: wi, points };
  });
  return { minWidthM, regions, rivers };
}

type Settings = BuildingStyle & HousingLevel;
const COMMON_KEYS = ['nudge', 'heightM', 'heightSkew', 'streetDeg'] as const;
const STYLE_KEYS = ['coverage', 'footprintM', ...COMMON_KEYS] as const;
const LEVEL_KEYS = ['alongM', 'acrossM', 'lotGapM', 'streetM', 'blockLots', 'fill', ...COMMON_KEYS] as const;

/** The building settings present in `o`, each checked; only those in `allowed` may appear. */
function buildingSettings(o: Obj, path: string, allowed: readonly (keyof Settings)[]): Partial<Settings> {
  const range = (key: string): [number, number] => {
    const v = o[key];
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0) || (v[0] as number) > (v[1] as number)) {
      throw new MapDataError(`${path}.${key}: expected [low, high], both positive`);
    }
    return v as [number, number];
  };
  const blocks = (key: string): [number, number] => {
    const v = o[key];
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n) && (n as number) > 0)) {
      throw new MapDataError(`${path}.${key}: expected [along, across], whole numbers of lots`);
    }
    return v as [number, number];
  };
  const out: { -readonly [K in keyof Settings]?: Settings[K] } = {};
  for (const name of Object.keys(o)) {
    const key = name as keyof Settings;
    if (!allowed.includes(key)) throw new MapDataError(`${path}.${key}: unknown building setting`);
    if (key === 'coverage') out.coverage = num(o, key, path, { min: 0, max: 0.7 });
    else if (key === 'footprintM' || key === 'alongM' || key === 'acrossM' || key === 'heightM') out[key] = range(key);
    else if (key === 'blockLots') out.blockLots = blocks(key);
    else if (key === 'nudge' || key === 'fill') out[key] = num(o, key, path, { min: 0, max: 1 });
    else if (key === 'lotGapM' || key === 'streetM') out[key] = num(o, key, path, { min: 0 });
    else if (key === 'heightSkew') out.heightSkew = num(o, key, path, { positive: true });
    else out.streetDeg = num(o, key, path, { min: -180, max: 360 });
  }
  return out;
}

/** Every setting in `keys`, none missing. */
function fullSettings(raw: unknown, path: string, keys: readonly (keyof Settings)[]): Partial<Settings> {
  const out = buildingSettings(obj(raw, path), path, keys);
  for (const key of keys) {
    if (out[key] === undefined) throw new MapDataError(`${path}.${key}: missing`);
  }
  return out;
}

function typeDefaults(raw: unknown): DistrictsFile['types'] {
  const types: { -readonly [K in keyof DistrictsFile['types']]: DistrictsFile['types'][K] } = {};
  for (const [name, value] of Object.entries(obj(raw, 'districts.types'))) {
    const path = `districts.types.${name}`;
    if (name === 'downtown' || name === 'industrial') types[name] = fullSettings(value, path, STYLE_KEYS) as BuildingStyle;
    else if (name === 'housing') {
      if (!Array.isArray(value) || value.length !== DENSITIES.length) throw new MapDataError(`${path}: expected ${DENSITIES.length} density levels`);
      types.housing = value.map((level: unknown, i: number) => fullSettings(level, `${path}[${i}]`, LEVEL_KEYS) as HousingLevel);
    } else throw new MapDataError(`${path}: unknown district type`);
  }
  return types;
}

export function validateDistricts(data: unknown, cityIds: readonly string[]): DistrictsFile {
  const rd = obj(data, 'districts')['districts'];
  if (!Array.isArray(rd)) throw new MapDataError('districts.districts: expected a list');
  const types = typeDefaults(obj(data, 'districts')['types'] ?? {});
  const ids = new Set<string>();
  const districts: District[] = rd.map((raw: unknown, i: number) => {
    const p = `districts.districts[${i}]`;
    const o = obj(raw, p);
    const id = str(o, 'id', p);
    if (ids.has(id)) throw new MapDataError(`${p}.id: duplicate id "${id}"`);
    ids.add(id);
    const cityId = str(o, 'cityId', p);
    if (!cityIds.includes(cityId)) throw new MapDataError(`${p}.cityId: unknown city "${cityId}" (district ${id})`);
    const type = str(o, 'type', p) as DistrictType;
    if (!DISTRICT_TYPES.includes(type)) throw new MapDataError(`${p}.type: expected one of ${DISTRICT_TYPES.join(', ')} (district ${id})`);
    const ring = o['ring'];
    if (!Array.isArray(ring) || ring.length < 3) throw new MapDataError(`${p}.ring: expected at least 3 points (district ${id})`);
    let district: District = { id, cityId, type, ring: ring.map((q: unknown, k: number) => lonLat(q, `${p}.ring[${k}] (district ${id})`, 2) as unknown as LonLatPoint) };
    const density = o['density'] as Density | undefined;
    if (type === 'housing') {
      if (density === undefined || !DENSITIES.includes(density)) throw new MapDataError(`${p}.density: expected a whole number from 1 to ${DENSITIES.length} (district ${id})`);
      district = { ...district, density };
    } else if (density !== undefined) throw new MapDataError(`${p}.density: only housing has a density (district ${id})`);
    if (o['style'] === undefined) return district;
    const path = `${p}.style (district ${id})`;
    const allowed = type === 'housing' ? LEVEL_KEYS : type === 'park' ? [] : STYLE_KEYS;
    return { ...district, style: buildingSettings(obj(o['style'], path), path, allowed) };
  });
  return { types, districts };
}

/** The kit's pieces are checked as landmarks are. */
export function validateKit(data: unknown): KitFile {
  const root = obj(data, 'kit');
  const enlarge = num(root, 'enlarge', 'kit', { positive: true });
  const raw = root['pieces'];
  if (!Array.isArray(raw)) throw new MapDataError('kit.pieces: expected a list');
  const { landmarks } = validateLandmarks({ footprintScale: 1, landmarks: raw.map((p: unknown, i: number) => ({ ...obj(p, `kit.pieces[${i}]`), cityId: 'kit', lat: 0, lon: 0 })) }, ['kit']);
  /** A non-empty list drawn from `all`. */
  const some = <T extends string>(v: unknown, all: readonly T[], path: string): T[] => {
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => all.includes(x as T))) throw new MapDataError(`${path}: expected a list from ${all.join(', ')}`);
    return v as T[];
  };
  const pieces: KitPiece[] = landmarks.map(({ id, clearRadiusM, solids, decor, wires }, i) => {
    const p = `kit.pieces[${i}] (${id})`;
    const o = obj(raw[i], p);
    const limit = num(o, 'limit', p, { min: 1 });
    if (!Number.isInteger(limit)) throw new MapDataError(`${p}.limit: expected a whole number`);
    const rules = { types: some(o['types'], TOWN_TYPES, `${p}.types`), sizes: some(o['sizes'], TOWN_SIZES, `${p}.sizes`), limit };
    return { id, clearRadiusM, solids, decor, ...(wires ? { wires } : {}), ...rules };
  });
  const spot = (q: unknown, p: string, type: TownType, size: TownSize): KitSpot => {
    const o = obj(q, p);
    const id = str(o, 'piece', p);
    const piece = pieces.find((k) => k.id === id);
    if (!piece) throw new MapDataError(`${p}.piece: unknown piece "${id}"`);
    if (!piece.types.includes(type)) throw new MapDataError(`${p}: a ${type} town may not have "${id}"`);
    if (!piece.sizes.includes(size)) throw new MapDataError(`${p}: a town of size ${size} may not have "${id}"`);
    return { piece: id, x: num(o, 'x', p), y: num(o, 'y', p), turn: num(o, 'turn', p, { min: -180, max: 180 }) };
  };
  const layouts: { [T in TownType]?: { [S in TownSize]?: KitSpot[] } } = {};
  for (const [type, bySize] of Object.entries(obj(root['layouts'], 'kit.layouts'))) {
    if (!TOWN_TYPES.includes(type as TownType)) throw new MapDataError(`kit.layouts.${type}: unknown town type`);
    const out: { [S in TownSize]?: KitSpot[] } = {};
    for (const [size, list] of Object.entries(obj(bySize, `kit.layouts.${type}`))) {
      const path = `kit.layouts.${type}.${size}`;
      if (!TOWN_SIZES.includes(size as TownSize)) throw new MapDataError(`${path}: unknown town size`);
      if (!Array.isArray(list)) throw new MapDataError(`${path}: expected a list`);
      const spots = list.map((q: unknown, i: number) => spot(q, `${path}[${i}]`, type as TownType, size as TownSize));
      for (const piece of pieces) {
        const count = spots.filter((s) => s.piece === piece.id).length;
        if (count > piece.limit) throw new MapDataError(`${path}: ${count} of "${piece.id}", at most ${piece.limit} allowed`);
      }
      out[size as TownSize] = spots;
    }
    layouts[type as TownType] = out;
  }
  return { enlarge, pieces, layouts };
}

export function validateTowns(data: unknown): Town[] {
  const list = obj(data, 'towns')['towns'];
  if (!Array.isArray(list)) throw new MapDataError('towns.towns: expected a list');
  const ids = new Set<string>();
  return list.map((raw: unknown, i: number): Town => {
    const p = `towns.towns[${i}]`;
    const o = obj(raw, p);
    const id = str(o, 'id', p);
    if (ids.has(id)) throw new MapDataError(`${p}.id: duplicate id "${id}"`);
    ids.add(id);
    const type = str(o, 'type', p) as TownType;
    if (!TOWN_TYPES.includes(type)) throw new MapDataError(`${p}.type: expected one of ${TOWN_TYPES.join(', ')} (town ${id})`);
    const size = str(o, 'size', p) as TownSize;
    if (!TOWN_SIZES.includes(size)) throw new MapDataError(`${p}.size: expected one of ${TOWN_SIZES.join(', ')} (town ${id})`);
    const density = o['density'] as Density;
    if (!DENSITIES.includes(density)) throw new MapDataError(`${p}.density: expected a whole number from 1 to ${DENSITIES.length} (town ${id})`);
    const offset = obj(o['offsetM'], `${p}.offsetM`);
    const signature = obj(o['signature'], `${p}.signature`);
    return {
      id,
      name: str(o, 'name', p),
      lat: num(o, 'lat', p, { min: -90, max: 90 }),
      lon: num(o, 'lon', p, { min: -180, max: 180 }),
      offsetM: { x: num(offset, 'x', `${p}.offsetM`), y: num(offset, 'y', `${p}.offsetM`) },
      size,
      type,
      streetDeg: num(o, 'streetDeg', p, { min: -180, max: 360 }),
      density,
      signature: { piece: str(signature, 'piece', `${p}.signature`), enlarge: num(signature, 'enlarge', `${p}.signature`, { positive: true }) },
    };
  });
}

export function validateRoads(data: unknown): RoadsFile {
  const root = obj(data, 'roads');
  const list = (o: Obj, key: string, path: string): string[] => {
    const v = o[key];
    if (!Array.isArray(v) || !v.every((s) => typeof s === 'string' && s !== '')) throw new MapDataError(`${path}.${key}: expected a list of strings`);
    return v as string[];
  };
  const major = obj(root['major'], 'roads.major');
  const minor = obj(root['minor'], 'roads.minor');
  return {
    source: str(root, 'source', 'roads'),
    major: { prefixes: list(major, 'prefixes', 'roads.major'), names: list(major, 'names', 'roads.major') },
    minor: { names: list(minor, 'names', 'roads.minor') },
    exclude: list(root, 'exclude', 'roads'),
    densifyKm: num(root, 'densifyKm', 'roads', { positive: true }),
    simplifyM: num(root, 'simplifyM', 'roads', { min: 0 }),
    mergeM: num(root, 'mergeM', 'roads', { min: 0 }),
    bridgeStepM: num(root, 'bridgeStepM', 'roads', { positive: true }),
  };
}

/** A prism is given by its corners; its box is worked out here. */
function prism(s: Obj, path: string): LandmarkSolidSpec {
  const v = s['points'];
  if (!Array.isArray(v) || v.length < 6 || v.length % 2 !== 0 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new MapDataError(`${path}.points: expected x, y pairs, at least three`);
  const points = v as number[];
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  for (let i = 0; i < xs.length; i++) {
    const [a, b, c] = [i, (i + 1) % xs.length, (i + 2) % xs.length];
    const turn = (xs[b]! - xs[a]!) * (ys[c]! - ys[b]!) - (ys[b]! - ys[a]!) * (xs[c]! - xs[b]!);
    if (turn <= 0) throw new MapDataError(`${path}.points: the outline must be convex and counterclockwise`);
  }
  const bottom = num(s, 'bottom', path, { min: 0 });
  const top = num(s, 'top', path);
  if (top <= bottom) throw new MapDataError(`${path}: top must be above bottom`);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...ys) - Math.min(...ys);
  const columns = s['columns'] === undefined ? undefined : num(s, 'columns', path, { positive: true });
  const cap = s['cap'] === undefined ? undefined : str(s, 'cap', path);
  return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, w, d, topW: w, topD: d, bottom, top, material: str(s, 'material', path), shape: 'prism', points, ...(columns ? { columns } : {}), ...(cap ? { cap } : {}) };
}

export function validateLandmarks(data: unknown, cityIds: readonly string[]): LandmarksFile {
  const root = obj(data, 'landmarks');
  const footprintScale = num(root, 'footprintScale', 'landmarks', { positive: true });
  const list = (v: unknown, path: string): unknown[] => {
    if (!Array.isArray(v)) throw new MapDataError(`${path}: expected a list`);
    return v;
  };
  const ids = new Set<string>();
  const landmarks = list(root['landmarks'], 'landmarks.landmarks').map((raw, i): LandmarkSpec => {
    const p = `landmarks.landmarks[${i}]`;
    const o = obj(raw, p);
    const id = str(o, 'id', p);
    if (ids.has(id)) throw new MapDataError(`${p}.id: duplicate id "${id}"`);
    ids.add(id);
    const cityId = str(o, 'cityId', p);
    if (!cityIds.includes(cityId)) throw new MapDataError(`${p}.cityId: unknown city "${cityId}" (landmark ${id})`);
    const solids = list(o['solids'], `${p}.solids`).map((q, k): LandmarkSolidSpec => {
      const path = `${p}.solids[${k}] (landmark ${id})`;
      const s = obj(q, path);
      if (s['shape'] === 'prism') return prism(s, path);
      const w = num(s, 'w', path, { positive: true });
      const d = num(s, 'd', path, { positive: true });
      const bottom = num(s, 'bottom', path, { min: 0 });
      const top = num(s, 'top', path);
      if (top <= bottom) throw new MapDataError(`${path}: top must be above bottom`);
      // A solid may narrow upward but not overhang.
      const solid = { x: num(s, 'x', path), y: num(s, 'y', path), w, d, topW: num(s, 'topW', path, { min: 0, max: w }), topD: num(s, 'topD', path, { min: 0, max: d }), bottom, top, material: str(s, 'material', path) };
      const shape = s['shape'];
      if (shape !== undefined && shape !== 'drum' && shape !== 'dome') throw new MapDataError(`${path}.shape: expected drum or dome`);
      if (shape !== undefined && (w !== d || solid.topW !== solid.topD)) throw new MapDataError(`${path}: a ${shape} is round, so w must equal d and topW topD`);
      const columns = s['columns'] === undefined ? undefined : num(s, 'columns', path, { positive: true });
      const cap = s['cap'] === undefined ? undefined : str(s, 'cap', path);
      return { ...solid, ...(shape ? { shape } : {}), ...(columns ? { columns } : {}), ...(cap ? { cap } : {}), ...(s['base'] === true ? { base: true } : {}) };
    });
    const decor = list(o['decor'] ?? [], `${p}.decor`).map((q, k): LandmarkDecorSpec => {
      const path = `${p}.decor[${k}] (landmark ${id})`;
      const s = obj(q, path);
      const material = str(s, 'material', path);
      const kind = str(s, 'kind', path);
      if (kind === 'line') {
        const points = list(s['points'], `${path}.points`);
        if (points.length < 4 || points.length % 2 !== 0 || !points.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new MapDataError(`${path}.points: expected x, y pairs, at least two`);
        return { kind, material, width: num(s, 'width', path, { positive: true }), points: points as number[] };
      }
      if (kind === 'rect') return { kind, material, x: num(s, 'x', path), y: num(s, 'y', path), w: num(s, 'w', path, { positive: true }), d: num(s, 'd', path, { positive: true }) };
      const at = { material, x: num(s, 'x', path), y: num(s, 'y', path), radius: num(s, 'radius', path, { positive: true }) };
      if (kind === 'disc') return { kind, ...at };
      if (kind === 'ring') return { kind, ...at, width: num(s, 'width', path, { positive: true }) };
      throw new MapDataError(`${path}.kind: expected disc, ring, line or rect`);
    });
    const numbers = (v: unknown, path: string, group: number, least: number): number[] => {
      const values = list(v, path);
      if (values.length < group * least || values.length % group !== 0 || !values.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new MapDataError(`${path}: expected groups of ${group} numbers, at least ${least}`);
      return values as number[];
    };
    const wires = o['wires'] === undefined ? undefined : list(o['wires'], `${p}.wires`).map((q, k) => {
      const path = `${p}.wires[${k}] (landmark ${id})`;
      const s = obj(q, path);
      return { material: str(s, 'material', path), points: numbers(s['points'], `${path}.points`, 3, 2) };
    });
    const clearAlso = o['clearAlso'] === undefined ? undefined : list(o['clearAlso'], `${p}.clearAlso`).map((q, k) => numbers(q, `${p}.clearAlso[${k}] (landmark ${id})`, 3, 1) as [number, number, number]);
    const extra = {
      ...(o['turn'] === undefined ? {} : { turn: num(o, 'turn', p, { min: -180, max: 180 }) }),
      ...(o['enlarge'] === undefined ? {} : { enlarge: num(o, 'enlarge', p, { positive: true }) }),
      ...(o['overWater'] === true ? { overWater: true } : {}),
      ...(wires ? { wires } : {}),
      ...(clearAlso ? { clearAlso } : {}),
    };
    const spec = { ...extra, id, cityId, lat: num(o, 'lat', p, { min: -90, max: 90 }), lon: num(o, 'lon', p, { min: -180, max: 180 }), clearRadiusM: num(o, 'clearRadiusM', p, { min: 0 }), solids, decor };
    if (o['posts'] === undefined) return spec;
    const path = `${p}.posts (landmark ${id})`;
    const s = obj(o['posts'], path);
    return { ...spec, posts: { x: num(s, 'x', path), y: num(s, 'y', path), radius: num(s, 'radius', path, { positive: true }), count: num(s, 'count', path, { positive: true }), height: num(s, 'height', path, { positive: true }) } };
  });
  return { footprintScale, landmarks };
}
