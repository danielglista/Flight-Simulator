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
