import { DEFAULT_GRID, DENSITIES, DISTRICT_TYPES, type BuildingStyle, type Density, type District, type DistrictsFile, type DistrictType, type GridSettings, type HousingLevel, type RoadsFile } from './types';
import type { Airport, AuthoredRiver, City, FootprintRect, LonLatPoint, MapBox, MapScales, PlacesFile, ScalesFile, WaterFile, WaterRegion } from './types';
import type { WarpShape } from './warp';

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
    const cityId = str(o, 'cityId', p);
    if (!ids.has(cityId)) throw new MapDataError(`${p}.cityId: unknown city "${cityId}" (airport ${id})`);
    const sz = o['size'];
    if (sz !== 'major' && sz !== 'small') throw new MapDataError(`${p}.size: expected "major" or "small" (airport ${id})`);
    const base = {
      id,
      name: str(o, 'name', p),
      cityId,
      lat: num(o, 'lat', p, { min: -90, max: 90 }),
      lon: num(o, 'lon', p, { min: -180, max: 180 }),
      size: sz,
      boundaryKm: size(o, 'boundaryKm', p),
      runwayHeadingDeg: num(o, 'runwayHeadingDeg', p, { min: 0, max: 360 }),
    } as const;
    let extra: { footprint?: FootprintRect[]; elevationM?: number; pushOverrideKm?: number; stampFadeKm?: number; stampAnchorKm?: { x: number; y: number } } = {};
    const fp = o['footprint'];
    if (fp !== undefined) {
      if (!Array.isArray(fp) || fp.length === 0) throw new MapDataError(`${p}.footprint: expected a non-empty list (airport ${id})`);
      extra = {
        ...extra,
        footprint: fp.map((r: unknown, k: number) => {
          const q = `${p}.footprint[${k}]`;
          const ro = obj(r, q);
          return {
            x: num(ro, 'x', q),
            y: num(ro, 'y', q),
            length: num(ro, 'length', q, { positive: true }),
            width: num(ro, 'width', q, { positive: true }),
            headingDeg: num(ro, 'headingDeg', q, { min: 0, max: 360 }),
          };
        }),
      };
    }
    if (o['elevationM'] !== undefined) extra = { ...extra, elevationM: num(o, 'elevationM', p) };
    if (o['pushOverrideKm'] !== undefined) extra = { ...extra, pushOverrideKm: num(o, 'pushOverrideKm', p, { positive: true }) };
    if (o['stampFadeKm'] !== undefined) extra = { ...extra, stampFadeKm: num(o, 'stampFadeKm', p, { positive: true }) };
    if (o['stampAnchorKm'] !== undefined) {
      const q = `${p}.stampAnchorKm`;
      const an = obj(o['stampAnchorKm'], q);
      const anchor = { x: num(an, 'x', q), y: num(an, 'y', q) };
      const bk = (base as { boundaryKm: { w: number; h: number } }).boundaryKm;
      if (Math.abs(anchor.x) > bk.w / 2 || Math.abs(anchor.y) > bk.h / 2) throw new MapDataError(`${q}: must lie inside the boundary (airport ${id})`);
      extra = { ...extra, stampAnchorKm: anchor };
    }
    airports.push({ ...base, ...extra });
  });
  return { cities, airports };
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
