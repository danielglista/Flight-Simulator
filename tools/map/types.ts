import type { WarpShape } from './warp';

/** Horizontal and vertical scales: real meters per world meter (E_PLAN §4.2). */
export interface MapScales {
  readonly geoDistance: number;
  readonly airportMajor: number;
  readonly airportSmall: number;
  readonly cityCore: number;
  readonly altitude: number;
  readonly buildingHeight: number;
}

export interface MapBox {
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
}

/** Cell sizes in world meters: a coarse base grid everywhere, and finer patches over airports and city cores. */
export interface GridSettings {
  readonly baseCellM: number;
  readonly patchCellM: number;
  /** Margin around each airport outline and city core that the patch covers, world km. */
  readonly patchMarginKm: number;
}

export const DEFAULT_GRID: GridSettings = { baseCellM: 20, patchCellM: 10, patchMarginKm: 0.3 };

export interface ScalesFile {
  readonly scales: MapScales;
  readonly grid: GridSettings;
  readonly box: MapBox;
  readonly warp: WarpShape;
}

export interface City {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** Real km, east-west by north-south. World size is this divided by cityCore. */
  readonly coreKm: { readonly w: number; readonly h: number };
  /** Hills added over the city and fading out across its warp ring: real m of relief, real km between hilltops. */
  readonly hills?: { readonly amplitudeM: number; readonly featureKm: number };
  /**
   * The city's own warp: its center (which may sit between the city and its airport, so both fall in
   * the core) and its core and ramp radii, real km. The ring is shared. Defaults to the city center and scales.warp.
   */
  readonly warp?: { readonly lat: number; readonly lon: number; readonly coreKm: number; readonly rampKm: number };
}

export interface Airport {
  readonly id: string;
  readonly name: string;
  readonly cityId: string;
  readonly lat: number;
  readonly lon: number;
  readonly size: 'major' | 'small';
  /** Real km, east-west by north-south. World size is this divided by the airport scale. */
  readonly boundaryKm: { readonly w: number; readonly h: number };
  /** Main runway axis, degrees clockwise from north. */
  readonly runwayHeadingDeg: number;
  /**
   * Ground the generator levels and keeps dry, and the game uses as airport: runways, apron, terminal.
   * One or more simple polygons of [lon, lat] corners, either winding.
   */
  readonly ground: readonly (readonly LonLatPoint[])[];
  /** Field elevation, real m. Defaults to the mean of the surrounding natural ground. */
  readonly elevationM?: number;
  /** Hand override: final world distance from the city center, km, along the real bearing. */
  readonly pushOverrideKm?: number;
  /**
   * When set, the land around the airport bends to meet its stamp, fading over this many world km
   * (tools/map/stamp.ts). Without it the stamp is simply laid over the warped land.
   */
  readonly stampFadeKm?: number;
  /**
   * The point of the airport (real km from its center, x east, y north) that stays where the warp
   * and push put it; the stamp grows around it. Defaults to the center. Put it under water that
   * passes beside the airport, so the stamp's extra size pushes the water aside instead of widening it.
   */
  readonly stampAnchorKm?: { readonly x: number; readonly y: number };
}

export interface PlacesFile {
  readonly cities: readonly City[];
  readonly airports: readonly Airport[];
}

/** Lon, lat. */
export type LonLatPoint = readonly [number, number];

/** Inside a region, Natural Earth's coast, lakes and rivers are replaced: the region is land, then authored water is cut in. */
export interface WaterRegion {
  readonly id: string;
  readonly ring: readonly LonLatPoint[];
}

/** A hand-drawn river: centerline points as [lon, lat, real width in m]. */
export interface AuthoredRiver {
  readonly id: string;
  /** Tidal water is at sea level and drawn as sea; otherwise it is cut into the land like a river. */
  readonly tidal: boolean;
  /**
   * What the third number of each point means: "real" (default) is the river's real width in m, scaled
   * like the land around it; "world" is the drawn width in world m, for rivers laid out by hand where
   * the warp would squeeze them unevenly.
   */
  readonly widthIn?: 'real' | 'world';
  readonly points: readonly (readonly [number, number, number])[];
}

export interface WaterFile {
  /** No authored river is drawn narrower than this, world m. */
  readonly minWidthM: number;
  readonly regions: readonly WaterRegion[];
  readonly rivers: readonly AuthoredRiver[];
}

export const DISTRICT_TYPES = ['downtown', 'housing', 'industrial', 'park'] as const;
export type DistrictType = (typeof DISTRICT_TYPES)[number];

/** A city district (data/map/districts.json). Later entries paint over earlier ones. */
export interface District {
  readonly id: string;
  readonly cityId: string;
  readonly type: DistrictType;
  /** Outline, lon and lat. */
  readonly ring: readonly LonLatPoint[];
  /** Housing only, and required there: how closely it is built, 1 (exurb) to 5 (rowhomes). */
  readonly density?: Density;
  /** Where this district differs from its type's (or level's) defaults. */
  readonly style?: Partial<BuildingStyle & HousingLevel>;
}

export const DENSITIES = [1, 2, 3, 4, 5] as const;
export type Density = (typeof DENSITIES)[number];

/** What every built-up district says. */
interface CommonStyle {
  /** Share of the room left over in its lot that a building may move by: 0 straight rows, 1 anywhere in the lot. */
  readonly nudge: number;
  /** Lowest and highest building, REAL m. */
  readonly heightM: readonly [number, number];
  /** 1 spreads heights evenly; higher makes most low and a few tall. */
  readonly heightSkew: number;
  /** Street grid heading, degrees clockwise from north. */
  readonly streetDeg: number;
}

/** How downtown and industrial ground is built up (lot gaps, streets and blocks are BUILDING_LAYOUT's). */
export interface BuildingStyle extends CommonStyle {
  /** Share of the ground under roofs, streets included in the ground. */
  readonly coverage: number;
  /** Shortest and longest building side, world m. */
  readonly footprintM: readonly [number, number];
}

/** One housing density level. "Along" and "across" are relative to the street heading; lengths in world m. */
export interface HousingLevel extends CommonStyle {
  /** Shortest and longest building side along the street heading, and across it. */
  readonly alongM: readonly [number, number];
  readonly acrossM: readonly [number, number];
  readonly lotGapM: number;
  readonly streetM: number;
  /** Lots along and across between streets. */
  readonly blockLots: readonly [number, number];
  /** Share of lots built. */
  readonly fill: number;
}

export interface DistrictsFile {
  /** Defaults per district type; a type without an entry (park) has no buildings. Housing has one entry per density. */
  readonly types: {
    readonly downtown?: BuildingStyle;
    readonly industrial?: BuildingStyle;
    readonly housing?: readonly HousingLevel[];
  };
  readonly districts: readonly District[];
}

/** Which real roads to put on the map (data/map/roads.json). Their lines come from the TIGER shapefile named by `source`. */
export interface RoadsFile {
  /** Path under tools/raw, without extension. */
  readonly source: string;
  readonly major: { readonly prefixes: readonly string[]; readonly names: readonly string[] };
  readonly minor: { readonly names: readonly string[] };
  /** Names containing any of these are left out. */
  readonly exclude: readonly string[];
  /** Real km between warped points, world m of thinning tolerance, and world m between water checks. */
  readonly densifyKm: number;
  readonly simplifyM: number;
  /** A stretch running alongside one already placed, closer than this (world m), is the same road. */
  readonly mergeM: number;
  readonly bridgeStepM: number;
}

/** A landmark solid as authored: real meters from the landmark's position, x east and y north. */
export interface LandmarkSolidSpec {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly topW: number;
  readonly topD: number;
  readonly bottom: number;
  readonly top: number;
  readonly material: string;
  readonly shape?: 'drum' | 'dome' | 'prism';
  /** Part of the ground itself, such as a hill: drawn under the rest, whose shadows then fall on it. */
  readonly base?: boolean;
  /** A prism's plan: x, y of each corner of a convex outline, counterclockwise. Its x, y, width and depth are then the box round it. */
  readonly points?: readonly number[];
  /** The color of the top from above, where it differs from the walls. */
  readonly cap?: string;
  readonly columns?: number;
}

export type LandmarkDecorSpec =
  | { readonly kind: 'rect'; readonly material: string; readonly x: number; readonly y: number; readonly w: number; readonly d: number }
  | { readonly kind: 'disc'; readonly material: string; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly kind: 'ring'; readonly material: string; readonly x: number; readonly y: number; readonly radius: number; readonly width: number }
  | { readonly kind: 'line'; readonly material: string; readonly width: number; readonly points: readonly number[] };

export interface LandmarkSpec {
  readonly id: string;
  readonly cityId: string;
  readonly lat: number;
  readonly lon: number;
  /** No ordinary building within this of the position, real m. */
  readonly clearRadiusM: number;
  readonly solids: readonly LandmarkSolidSpec[];
  readonly decor: readonly LandmarkDecorSpec[];
  /** Degrees clockwise the whole landmark is turned about its position; absent for none. */
  readonly turn?: number;
  /** Draws the whole landmark this many times larger, plan and height, so a small one is not lost; absent for 1. */
  readonly enlarge?: number;
  /** More ground kept clear of ordinary buildings: x, y, radius, real m before turning. */
  readonly clearAlso?: readonly (readonly [number, number, number])[];
  /** Stands over water on purpose, as a bridge does. */
  readonly overWater?: boolean;
  /** Lines in the air: x, y, z, ... real m. */
  readonly wires?: readonly { readonly material: string; readonly points: readonly number[] }[];
  readonly posts?: { readonly x: number; readonly y: number; readonly radius: number; readonly count: number; readonly height: number };
}

export interface LandmarksFile {
  /** Real meters per world meter of a landmark's plan. */
  readonly footprintScale: number;
  readonly landmarks: readonly LandmarkSpec[];
}
