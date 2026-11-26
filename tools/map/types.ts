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
  /** Margin around each airport boundary and city core that the patch covers, world km. */
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

/** One paved or cleared area of an airport, in real km relative to the airport center (x east, y north). */
export interface FootprintRect {
  readonly x: number;
  readonly y: number;
  /** Along the heading. */
  readonly length: number;
  /** Across it. */
  readonly width: number;
  /** Degrees clockwise from north. */
  readonly headingDeg: number;
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
  /** Ground the generator levels and keeps dry: runways, apron, terminal. Defaults to the whole boundary. Approximate; E3 defines the real layout. */
  readonly footprint?: readonly FootprintRect[];
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
