/** Loading and joining the generated map (E3). All numbers provisional. */

/** The map the page loads, relative to the site root. Written by `node tools/build-map.mjs`. */
export const MID_ATLANTIC_URL = 'maps/mid-atlantic.bin';

/** Ground heights of a fine patch blend into the base grid over this far inside its edge, world m. */
export const PATCH_BLEND_M = 80;

/** How far the map under a masked airport's ground may stand from its field height, real m. */
export const FIELD_TOLERANCE_M = 3;

/** Route readout: within this of the destination (world m) only the time is shown, not nautical miles. */
export const ROUTE_NEAR_M = 2000;
/** Slower than this over the ground (m/s) there is no time to go. */
export const ROUTE_MIN_SPEED = 30;

/** Highways (E5.2): drawn width in world m, the thinnest they are drawn in pixels, and where minor ones drop out. */
export const ROAD_WIDTH_M = { major: 16, minor: 10 } as const;
export const ROAD_MIN_PX = { major: 1.25, minor: 1 } as const;
export const ROAD_MINOR_MAX_MPP = 10;
/** Roads are cut into squares this big (world m) so only those near the view are drawn. */
export const ROAD_TILE_M = 400;
/** How far past the view a road can still show: bridge decks, piers and shadows, world m. */
export const ROAD_REACH_M = 40;
/** Coarsest zoom (m/px) for each level of road detail: every marking; edge lines; bridge shadows and decks. */
export const ROAD_MARKINGS_MAX_MPP = 1.25;
export const ROAD_LINES_MAX_MPP = 2.5;
/** Yellow center lines only at the closest zoom: farther out they are too thin and smear into one stripe. */
export const ROAD_YELLOW_MAX_MPP = 0.8;
export const ROAD_BRIDGE_MAX_MPP = 10;
/** Lane line dashes and the gap between them, world m. */
export const ROAD_DASH_M = [6, 9] as const;

/** Buildings in the top view (E5.4): not drawn coarser than this (m/px); outlines and roof shapes to this zoom. */
export const BUILDING_MAX_MPP = 10;
export const BUILDING_DETAIL_MAX_MPP = 1.25;
/** Side of a baked tile, pixels, and how many are kept (256 px tiles are about 0.25 MB each). */
export const BUILDING_TILE_PX = 256;
export const BUILDING_CACHE_TILES = 150;
/** Levels this zoomed-out or more are baked at load and kept; closer ones are baked as they come into view. */
export const BUILDING_PREBAKE_MIN_MPP = 2.5;
/**
 * Time per frame for painting tiles, ms. A tile that does not fit carries on next frame; until it is done the old one,
 * or else the stored zoomed-out one, is shown.
 */
export const BUILDING_BAKE_MS = 6;
/** Buildings painted between looks at the clock. */
export const BUILDING_BAKE_BATCH = 100;
/** How far a bridge's shadow lies from its deck, world m. */
export const BRIDGE_SHADOW_M = 5 * Math.SQRT2;
/** How solid what the plane flies under is drawn over it in the top view (E6). */
export const LANDMARK_OVERHEAD_ALPHA = 0.6;

/** Practice aid: Mid-Atlantic runways are this many times their real width (1 = true width; 1.2 helps practice). */
export const RUNWAY_WIDTH_MULT = 1;

/**
 * Town sizes (E6B.2E): center to the corners of the outline, world m. A few named classes, tuned by eye.
 * No `smallCity` is built yet.
 */
export const TOWN_RADIUS_M = { town: 160, largeTown: 220, smallCity: 400 } as const;
