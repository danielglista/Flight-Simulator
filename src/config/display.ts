export interface Size {
  readonly width: number;
  readonly height: number;
}

export type CanvasPanelId = 'top' | 'side' | 'instruments';

/** Internal (pre-scale) canvas sizes. Provisional: see A1_PLAN.md section 9. */
export const CANVAS_PANELS: Readonly<
  Record<CanvasPanelId, { readonly label: string; readonly internal: Size }>
> = {
  top: { label: 'TOP VIEW', internal: { width: 640, height: 360 } },
  side: { label: 'SIDE VIEW', internal: { width: 640, height: 360 } },
  instruments: { label: 'INSTRUMENTS', internal: { width: 400, height: 192 } },
};

/**
 * Instruments panel (D1, D5D): PANEL_COLS x PANEL_ROWS gauge cells of PANEL_CELL px, the HSI_SIZE square HSI to their
 * right, and a LIGHTS_STRIP_H strip of lamps under both; the block is centered in the canvas.
 */
export const PANEL_CELL = 80;
export const PANEL_COLS = 3;
export const PANEL_ROWS = 2;
export const HSI_SIZE = PANEL_CELL * PANEL_ROWS;
export const LIGHTS_STRIP_H = 32;
export const PANEL_W = PANEL_CELL * PANEL_COLS + HSI_SIZE;
export const PANEL_H = HSI_SIZE + LIGHTS_STRIP_H;
export const DIAL_R = 36;
export const NEEDLE_QUANT_DEG = 0.5;

/** Airspeed dial: indicated knots to degrees clockwise from the top, piecewise linear; pegged at the last angle above the last knot. */
export const ASI_TABLE: readonly (readonly [number, number])[] = [
  [0, 0],
  [60, 30],
  [240, 240],
  [400, 320],
];
/** The airspeed dial's stall arc: red up to the stall speed, amber up to this multiple of it. Hidden on the ground below ASI_ARC_MIN_KT. */
export const ASI_AMBER_MULT = 1.2;
export const ASI_ARC_MIN_KT = 30;
/**
 * Power dial (D5B). It reads N1_IDLE_PCT with no thrust and 100 at full: display only, thrust itself still starts at 0.
 * The scale runs 0 to 100 from N1_ZERO_DEG (6 o'clock) over N1_SWEEP_DEG clockwise; red from N1_RED_PCT up (decoration, no limit is enforced).
 */
export const N1_IDLE_PCT = 20;
export const N1_ZERO_DEG = 180;
export const N1_SWEEP_DEG = 270;
export const N1_RED_PCT = 95;
/** Altimeter hands: displayed feet per turn of the long and short hand. */
export const ALT_LONG_FT = 1000;
export const ALT_SHORT_FT = 10000;

/** Artificial horizon (D2): pixels per degree of pitch, and the sky or ground always left at the edge so up stays clear. */
export const HORIZON_PX_PER_DEG = 1.5;
export const HORIZON_MIN_PX = 4;
/**
 * Vertical speed dial: ft/min (as the dial's scale) to degrees away from 9 o'clock, mirrored for descent.
 * `world` shows the readout's value; `altimeter` shows the rate the altimeter actually changes, so its dial runs ALTITUDE_SCALE times higher.
 * A switch to decide by flying (D_PLAN section 4); the losing mode is deleted afterwards.
 */
export type VsMode = 'world' | 'altimeter';
export const VS_MODE: { mode: VsMode } = { mode: 'world' };
export const VSI_TABLE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1000, 60],
  [2000, 110],
  [4000, 160],
];
/** The altitude bug shows on the altimeter rim only within this many displayed feet of the altitude. */
export const ALT_BUG_RIM_FT = 500;

/** Smallest supported window; below this the page scrolls instead of shrinking. */
export const MIN_WINDOW: Size = { width: 1280, height: 720 };

/** Debug panel text refresh while running, Hz. */
export const DEBUG_REFRESH_HZ = 4;
/** Real frames kept for the debug panel's timing figures. */
export const FRAME_SAMPLES = 300;
/** Readout text for screen readers is rewritten at most this often, Hz. */
export const READOUT_SR_HZ = 4;

/** Top view turn line: it is as long on screen as the compass ring's radius at any zoom; this caps the flight time it may show, seconds. */
export const TURN_LINE_MAX_S = 120;
/** Tick marks along the turn line, one per this many seconds. */
export const TURN_LINE_TICK_S = 2;

/**
 * Top view depth cues (C3D). One virtual camera hangs DEPTH_CAMERA_M world meters above the plane;
 * it sets how strong every cue is (exaggerated on purpose). Switches let you compare by eye.
 */
export const DEPTH_CAMERA_M = 3000;
/** Haze and plane size are at full strength from this height (world m, about 19,700 ft), well under the ceiling. */
export const DEPTH_TOP_Z = 1200;
export const DEPTH_FX = { shadow: true, haze: true, planeSize: true, clouds: false };
/** Shadow: pixels of offset per world meter above ground, its cap, peak alpha, and the AGL band (world m) over which it fades out. */
export const SHADOW_PX_PER_M = 0.2;
export const SHADOW_MAX_PX = 40;
export const SHADOW_ALPHA = 0.35;
export const SHADOW_FADE_LOW_M = 200;
export const SHADOW_FADE_HIGH_M = 500;
/** Haze: alpha of the veil over the terrain at DEPTH_TOP_Z and above. */
export const HAZE_MAX = 0.35;
/**
 * Clouds: a static layer CLOUD_BASE_M above sea level (world m), tiled from one seamless noise tile that covers
 * CLOUD_TILE_M of world in CLOUD_TILE_PX pixels. Alpha is LOW while the plane is under the base and HIGH above it,
 * so low flight keeps a clear ground. Cloud shadows fall away from the sun, shifted by CLOUD_BASE_M * CLOUD_SHADOW_SKEW world m.
 */
export const CLOUD_BASE_M = 500;
export const CLOUD_TILE_M = 3000;
export const CLOUD_TILE_PX = 256;
export const CLOUD_SEED = 20240611;
export const CLOUD_ALPHA_LOW = 0.25;
export const CLOUD_ALPHA_HIGH = 0.6;
export const CLOUD_SHADOW_ALPHA = 0.22;
export const CLOUD_SHADOW_SKEW = 0.3;
/** Plane sprite size steps between the ground and DEPTH_TOP_Z, and the extra altitude fraction (of one step) needed to leave the current one. */
export const PLANE_SIZE_TIERS = 4;
export const PLANE_SIZE_HYSTERESIS = 0.1;

/**
 * Side view depth cues (C3E). Each background layer is a band of terrain beside the track, left of the
 * heading (negative: right, toward the viewer). Farthest first; the main profile is not in this table.
 */
export interface SideLayer {
  /** Distance of the band's near edge from the track (world m). */
  readonly nearM: number;
  /** Far edge of the band; `lanes` sample lines are spread from near to far. */
  readonly farM: number;
  readonly lanes: number;
  /** Horizontal parallax factor (1 = same scroll speed as the main profile). */
  readonly k: number;
  /** 0 clear .. 1 sky. */
  readonly haze: number;
}
export const SIDE_LAYERS: readonly SideLayer[] = [
  { nearM: 900, farM: 1500, lanes: 4, k: 0.5, haze: 0.7 },
  { nearM: 450, farM: 750, lanes: 4, k: 0.7, haze: 0.5 },
  { nearM: 200, farM: 350, lanes: 3, k: 0.85, haze: 0.3 },
];
/** The foreground layer, drawn over the plane (toggle: SIDE_FX.foreground, or the debug panel checkbox). */
export const SIDE_FOREGROUND: SideLayer = { nearM: -250, farM: -120, lanes: 3, k: 1.3, haze: 0 };
/**
 * Per-effect switches, to compare by eye. Off, a layer is a single lane at k = 1 at its near edge.
 * parallax and laneBands are wired but still to be checked by eye (C3E steps 3 and 4); foreground is built and toggled at run time too.
 */
export const SIDE_FX = { parallax: true, laneBands: true, slopeShade: true, foreground: false };
/** Slope shading: strength on skin and snow, the slope (px per column) where it saturates, and the share of that strength the body gets. */
export const SLOPE_SHADE = 0.25;
export const SLOPE_SATURATE_PX = 3;
export const SLOPE_SHADE_BODY = 0.4;
/** Foreground: alpha, darkening toward FOREGROUND_TINT (palette), the plane ghost alpha, and an optional cap on how high it may rise (px above the sea row). */
export const FOREGROUND_ALPHA = 0.85;
export const FOREGROUND_DARKEN = 0.55;
export const GHOST_ALPHA = 0.35;
export const FOREGROUND_MAX_RISE_PX = Infinity;

/** Top view heading bug: keys step it by these many degrees (Shift = fine). */
export const BUG_STEP_DEG = 5;
export const BUG_FINE_DEG = 1;
/** Side view altitude bug: keys step it by these many displayed feet (Shift = fine), and the highest it can be set. */
export const ALT_BUG_STEP_FT = 100;
export const ALT_BUG_FINE_FT = 10;
export const ALT_BUG_MAX_FT = 40000;
/** Altitude tape (right side of the side view): pixels per displayed foot, width, tallest height (px), and the trend vector's look-ahead (s). */
export const ALT_TAPE_PX_PER_FT = 0.4;
export const ALT_TAPE_WIDTH_PX = 62;
export const ALT_TAPE_MAX_HEIGHT_PX = 240;
export const ALT_TREND_S = 10;
/** Compass ring around the plane: largest radius and the least gap to the panel edge (px), tick and label spacing (degrees). */
export const RING_MAX_RADIUS = 150;
export const RING_MARGIN = 24;
export const RING_TICK_DEG = 10;
export const RING_LABEL_DEG = 30;

/** Side view: the plane stands on its wheels. Its sprite is lifted this many pixels on the ground, fading to none at WHEEL_FADE_PX of height above it. */
export const WHEEL_PX = 7;
export const WHEEL_FADE_PX = 40;
/** Top view: no turn line below this speed on the ground, m/s (ten seconds of it is meaningless). */
export const TURN_LINE_MIN_SPEED = 5;

/** C4B. Takeoff HUD mode: airborne under this height above ground (world m) with the gear not up; gear counts as up at or below GEAR_UP_AT. */
export const TAKEOFF_HUD_AGL_M = 150;
export const GEAR_UP_AT = 0.05;
/** V-speeds update while on the ground slower than this (m/s) and are frozen once the roll starts. */
export const VSPEED_FREEZE_MS = 2;
/** A takeoff call-out stays on screen this long, seconds. */
export const CALLOUT_HOLD_S = 2;
/** A V1 within this many knots of VR gets no mark or call-out of its own: VR's call-out reads `V1 ROTATE` (D5A). */
export const V1_MERGE_KT = 5;
/** V1's letter on the speed dial keeps at least this many dial degrees before VR's (D5A); its tick stays at the true speed. */
export const VMARK_LABEL_MIN_DEG = 18;
/** Pixel text scale of the call-out banner in the instruments panel (D5A). */
export const CALLOUT_TEXT_SCALE = 2;
/** Call-out POSITIVE RATE needs this much height above ground (world m). */
export const POSITIVE_RATE_AGL_M = 5;
/** Zoom gate: ground zoom on the ground or under ENTER, air zoom above EXIT (height above ground, world m), kept between. Time constant of the zoom ease, seconds. */
export const GROUND_ZOOM_ENTER_AGL = 30.5;
export const GROUND_ZOOM_EXIT_AGL = 40;
export const ZOOM_EASE_S = 0.8;
/**
 * Top view approach zoom: its level (index into ZOOM_LEVELS, 5 = 6x), and where it applies for the picked runway end.
 * It starts before the threshold within CENTERLINE_M, this close to the center line (world m), this near the runway
 * heading (deg) and under MAX_AGL (world m); it is kept out to the wider LEAVE limits, and over the runway.
 */
export const APPROACH_ZOOM = 5;
export const APPROACH_ZOOM_ENTER_OFFSET_M = 400;
export const APPROACH_ZOOM_LEAVE_OFFSET_M = 600;
export const APPROACH_ZOOM_ENTER_DEG = 60;
export const APPROACH_ZOOM_LEAVE_DEG = 90;
export const APPROACH_ZOOM_LEAVE_BACK_M = 500;
export const APPROACH_ZOOM_MAX_AGL = 400;
/**
 * Side view zoom bands by height above ground, displayed feet (the same feet as ALT). Climbing, a band is left above
 * its EXIT; descending, it is entered under its ENTER.
 */
export const SIDE_NEAR_ENTER_FT = 1200;
export const SIDE_NEAR_EXIT_FT = 1400;
export const SIDE_MID_ENTER_FT = 3000;
export const SIDE_MID_EXIT_FT = 3500;
/** The height-above-ground text by the plumb line shows under this height (world m, 2,000 displayed ft). */
export const AGL_TEXT_LIMIT_M = 60;

/** Approach guidance (C5): on under APPROACH_AGL_M above ground with the gear down, within APPROACH_RANGE_M before the threshold, within APPROACH_ALIGN_DEG of the runway heading and APPROACH_WIDTH_M of its line. World m and degrees. */
export const APPROACH_AGL_M = 150;
export const APPROACH_RANGE_M = 4000;
export const APPROACH_ALIGN_DEG = 60;
export const APPROACH_WIDTH_M = 2500;
/** The guide path: its angle (deg) and the aim point past the threshold (m). Matches the Final start. */
export const APPROACH_PATH_DEG = 3;
export const APPROACH_AIM_M = 150;
/** Top view center line: how far before the threshold it reaches and the spacing of its distance ticks (world m), then half the tick and end-bar lengths (pixels). */
export const CENTERLINE_M = 6000;
export const CENTERLINE_TICK_M = 1000;
export const CENTERLINE_TICK_PX = 5;
export const CENTERLINE_END_PX = 12;

/** Runway selection (D5C): airports shown at once, and how much farther one behind the plane counts when ordering them. */
export const AIRPORT_PAGE_SIZE = 3;
export const ORDER_BEHIND_WEIGHT = 2;

/** HSI (D5D): full-scale deviations as angles (sideways from the far end, vertically from the aim point), where the glide path shows, and the pixels of full scale on the HSI's 80 px drawing grid. */
export const HSI_LOC_FULL_DEG = 5;
export const HSI_GS_FULL_DEG = 0.7;
export const HSI_GS_RANGE_M = 8000;
export const HSI_GS_CONE_DEG = 35;
export const HSI_DEV_PX = 12;
export const HSI_GS_PX = 14;

/** Autopilot (D4): keys step the speed target by this many knots (Shift = fine); a notice stays this long (s); the lamps read "captured" inside these margins. */
export const SPD_BUG_STEP_KT = 5;
export const SPD_BUG_FINE_KT = 1;
export const AP_NOTICE_S = 2;
export const AP_CAPTURE_FT = 20;
export const AP_CAPTURE_DEG = 2;
export const AP_CAPTURE_KT = 2;

/** Buildings in the side view (E5.5): those this close beside the flight line show dimmed, mixed this far toward haze. */
export const SIDE_BUILDING_BESIDE_M = 60;
export const SIDE_BUILDING_BESIDE_HAZE = 0.45;
/** Windows on solid buildings: up to this vertical zoom (world m per pixel), one row per floor of this height. */
export const SIDE_BUILDING_WINDOW_MAX_MPP = 0.5;
export const SIDE_BUILDING_FLOOR_M = 3;

/** Landmarks in the side view (E6): shown pale this far to the left of (behind) the flight line, up to the first skyline. */
export const SIDE_LANDMARK_BEHIND_M = 200;
export const SIDE_LANDMARK_HAZE = 0.25;
/** Flag poles show at this vertical scale and closer, m/px. */
export const SIDE_LANDMARK_POST_MAX_MPP = 1;
