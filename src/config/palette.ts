import { Terrain } from '../sim/world/terrain';

export type Rgb = readonly [number, number, number];

/** Placeholder colors. H1 replaces them. */
export const TERRAIN_COLORS: Readonly<Record<number, Rgb>> = {
  [Terrain.seabed]: [150, 138, 110],
  [Terrain.grass]: [88, 142, 62],
  [Terrain.forest]: [36, 92, 50],
  [Terrain.farmland]: [176, 164, 84],
  [Terrain.desert]: [216, 192, 132],
  [Terrain.mountain]: [124, 112, 100],
  [Terrain.snow]: [240, 244, 250],
  [Terrain.urban]: [152, 152, 162],
  [Terrain.road]: [58, 58, 64],
  [Terrain.airport]: [100, 100, 112],
  [Terrain.runway]: [44, 44, 50],
  [Terrain.taxiway]: [78, 78, 86],
  [Terrain.downtown]: [146, 142, 144],
  [Terrain.residential]: [164, 140, 118],
  [Terrain.suburb]: [128, 148, 100],
  [Terrain.industrial]: [128, 118, 132],
  [Terrain.park]: [96, 168, 80],
};

/** Water color runs from shallow to deep with depth (real meters). */
export const WATER_SHALLOW: Rgb = [48, 176, 170]; // teal, so shallow water is not the sky blue
export const WATER_DEEP: Rgb = [20, 48, 104];
export const WATER_DEEP_M = 60;
export const SEA_COLOR: Rgb = WATER_DEEP;

export function waterColor(depthRealM: number): Rgb {
  const t = Math.min(1, Math.max(0, depthRealM / WATER_DEEP_M));
  return [
    WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * t,
    WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * t,
    WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * t,
  ];
}

/** Side-view sky bands, top to bottom, and the map marker. Placeholders until H1. */
export const SKY_BANDS: readonly string[] = ['#16345f', '#1f4a80', '#2f6aa3', '#5a93c4'];
export const MARKER_COLOR = '#ffd34d';

/** Gauge faces (D1). Placeholders until H2. */
export const GAUGE_BG = '#05080e';
export const GAUGE_RING = '#8fa0bd';
export const GAUGE_TICK = '#c9d3e6';
export const GAUGE_NUM = '#e8f0ff';
export const GAUGE_NEEDLE = '#ffffff';
export const GAUGE_NEEDLE_SHORT = '#ffd34d';
export const GAUGE_WINDOW = '#000000';
export const PANEL_LINE = '#1c2c44';

/** Instrument readouts, B4. D1 replaces them. */
export const READOUT_BG = '#0d1a2b';
export const READOUT_LABEL = '#6b778d';
export const READOUT_VALUE = '#e8f0ff';
export const READOUT_UNIT = '#8fa0bd';
/** Stall warning text, and the stalled state (filled box). D3 replaces them with lights. */
export const WARN_COLOR = '#ffb020';
export const STALL_COLOR = '#ff4a3d';
/** The short line from the plane along its path in the side view. */
export const PATH_LINE_COLOR = 'rgba(255,255,255,0.45)';
/** The curved line ahead of the plane in the top view: where the current turn leads. */
export const TURN_LINE_COLOR = 'rgba(255,211,77,0.75)';
/** Pale veil over the top view terrain that thickens with altitude. */
export const HAZE_COLOR: Rgb = [196, 214, 232];
/** Side view foreground: terrain colors are mixed toward this (C3E). */
export const FOREGROUND_TINT: Rgb = [24, 34, 48];
/** Compass ring in the top view, and the heading bug on it. */
export const RING_COLOR = 'rgba(255,255,255,0.4)';
export const BUG_COLOR = '#4dd2ff';
/** Altitude tape: backing panel, and the trend vector (where altitude will be in a few seconds). */
export const TAPE_BACK_COLOR = 'rgba(0,0,0,0.5)';
export const TREND_COLOR = '#ffd34d';
/** Takeoff speeds on the airspeed dial, the next one to reach, and the call-out banner in the instruments panel (D5A). */
export const VMARK_COLOR = '#7dffa0';
export const VMARK_NEXT_COLOR = '#ffd34d';
export const CALLOUT_COLOR = '#7dffa0';
export const CALLOUT_BG = '#000000';
export const CALLOUT_PROMPT_COLOR = '#ffffff';

/** Approach guidance lines: the glide path in the side view and the center line in the top view. */
export const GUIDE_COLOR = 'rgba(125,255,160,0.85)';

/** Horizon, compass and vertical speed (D2). Placeholders until H2. */
export const HORIZON_SKY = '#3f7fc4';
export const HORIZON_GROUND = '#8a5a2b';
export const HORIZON_LINE = '#ffffff';
export const HORIZON_WINGS = '#ffd34d';
export const PATH_MARKER_COLOR = '#7dffa0';

/** Lamps and control gauges (D3). Placeholders until H2. */
export const LAMP_OFF_BG = '#141c2b';
export const LAMP_OFF_TEXT = '#4a5670';
export const LAMP_GREEN = '#2fbf5a';
export const LAMP_TEXT_DARK = '#0a0e14';
/** Flap and gear gauge (D3). */
export const BAR_LEVER = '#e8f0ff';
export const BAR_ENGINE = '#4dd2ff';
/** Power dial (D5B): engine fill, lever marker, and the gap while the engine catches up. */
export const N1_FILL = '#1f7a45';
export const N1_LEVER = '#ffd34d';
export const N1_GAP = '#ffb020';
export const N1_RED = '#ff4a3d';
/** The mark on the power dial below which the engine spools up slowly. */
export const N1_STABLE = '#7dffa0';
/** Top view: the route between two airports (E3). */
export const ROUTE_COLOR = '#ff6ad5';

/** Highways in the top view (E5.2). */
export const ROAD_ASPHALT_COLOR = 'rgb(46,47,52)';
export const ROAD_EDGE_LINE_COLOR = 'rgb(226,226,222)';
export const ROAD_CENTER_LINE_COLOR = 'rgb(238,186,40)';
export const ROAD_MEDIAN_COLOR = 'rgb(66,100,52)';
/** Bridges: concrete deck and piers, the dark rail along each side, and the shadow on the water. */
export const ROAD_BRIDGE_DECK_COLOR = 'rgb(186,184,176)';
export const ROAD_BRIDGE_RAIL_COLOR = 'rgb(72,70,66)';
export const ROAD_BRIDGE_SHADOW_COLOR = 'rgba(0,0,0,0.35)';
/** HSI (D5D): course arrow, deviation bar and glide diamond; and the bearing needle. */
export const HSI_COURSE = '#5fe07f';
export const HSI_BEARING = '#ff6ad5';

/** Roofs by district style (E5.4): downtown, residential, suburb, industrial. */
export const ROOF_COLORS: readonly (readonly Rgb[])[] = [
  [
    [184, 180, 172],
    [160, 164, 170],
    [196, 184, 164],
    [132, 136, 146],
  ],
  [
    [166, 92, 72],
    [140, 76, 62],
    [172, 120, 90],
    [112, 108, 112],
  ],
  [
    [104, 100, 106],
    [150, 90, 72],
    [128, 100, 80],
    [186, 178, 166],
  ],
  [
    [190, 196, 202],
    [150, 160, 170],
    [214, 212, 204],
    [130, 140, 140],
  ],
];
export const ROOF_EDGE_COLOR = 'rgba(30,28,30,0.7)';
export const BUILDING_SHADOW_COLOR = 'rgba(0,0,0,0.38)';

/** Windows on buildings in the side view (E5.5). */
export const SIDE_WINDOW_COLOR = 'rgba(30,40,60,0.75)';

/** Landmark materials (E6), by the names used in data/map/landmarks.json. */
export const LANDMARK_COLORS: Readonly<Record<string, Rgb>> = {
  'marble-lower': [222, 219, 210],
  'marble-upper': [210, 200, 180],
  'marble-tip': [226, 220, 206],
  'dark-glass': [58, 64, 72],
  'capitol-stone': [232, 229, 216],
  'capitol-dome': [238, 235, 222],
  'copper-roof': [128, 174, 164],
  bronze: [72, 78, 70],
  terrace: [202, 197, 186],
  'plaza-red': [172, 152, 144],
  lawn: [80, 126, 62],
  pool: [78, 128, 140],
  'lincoln-stone': [236, 230, 216],
  'lincoln-shadow': [166, 132, 100],
  'lincoln-door': [74, 52, 40],
  skylight: [168, 180, 186],
  'pool-green': [74, 122, 84],
  road: [128, 128, 130],
  tree: [48, 92, 46],
  'pentagon-stone': [206, 192, 160],
  'pentagon-roof': [142, 148, 146],
  'pentagon-court': [128, 120, 106],
  apron: [162, 160, 154],
  plaza: [190, 189, 184],
  'plaza-line': [108, 108, 110],
  path: [200, 172, 138],
  'cityhall-stone': [201, 196, 183],
  'cityhall-tower': [226, 221, 208],
  'cityhall-white': [214, 222, 232],
  slate: [96, 104, 116],
  clock: [52, 62, 60],
  'museum-stone': [218, 172, 100],
  'museum-roof': [90, 100, 118],
  'museum-pediment': [178, 112, 82],
  steps: [188, 172, 140],
  'step-line': [140, 126, 102],
  'bridge-blue': [122, 170, 196],
  'bridge-cable': [166, 204, 224],
  'bridge-road': [112, 114, 118],
  'bridge-stone': [166, 152, 130],
  'liberty-glass': [62, 82, 116],
  'liberty-two-glass': [84, 124, 164],
  'liberty-trim': [214, 222, 230],
  'ctc-glass': [92, 132, 170],
  'ctc-core': [214, 222, 228],
  'ctc-dark': [90, 98, 110],
  'jefferson-marble': [234, 231, 222],
  'jefferson-dome': [242, 240, 234],
  'jefferson-shadow': [172, 166, 152],
  'jefferson-pediment': [214, 208, 194],
  'whitehouse-stone': [240, 238, 230],
  'whitehouse-shade': [206, 202, 190],
  'whitehouse-roof': [150, 154, 158],
  'whitehouse-pole': [226, 228, 232],
  'flag-red': [186, 48, 44],
  'flower-grey': [182, 190, 180],
};
export const LANDMARK_POLE_COLOR: Rgb = [226, 228, 232];
export const LANDMARK_FLAG_COLOR: Rgb = [178, 44, 52];
