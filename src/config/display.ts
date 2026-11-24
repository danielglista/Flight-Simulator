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
  instruments: { label: 'INSTRUMENTS', internal: { width: 320, height: 160 } },
};

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
export const DEPTH_CAMERA_M = 1500;
export const DEPTH_FX = { shadow: true, haze: true, planeSize: true, clouds: false };
/** Shadow: pixels of offset per world meter above ground, its cap, peak alpha, and the AGL band (world m) over which it fades out. */
export const SHADOW_PX_PER_M = 0.4;
export const SHADOW_MAX_PX = 40;
export const SHADOW_ALPHA = 0.35;
export const SHADOW_FADE_LOW_M = 100;
export const SHADOW_FADE_HIGH_M = 250;
/** Haze: alpha of the veil over the terrain at the ceiling. */
export const HAZE_MAX = 0.35;
/**
 * Clouds: a static layer CLOUD_BASE_M above sea level (world m), tiled from one seamless noise tile that covers
 * CLOUD_TILE_M of world in CLOUD_TILE_PX pixels. Alpha is LOW while the plane is under the base and HIGH above it,
 * so low flight keeps a clear ground. Cloud shadows fall southeast, shifted by CLOUD_BASE_M * CLOUD_SHADOW_SKEW world m.
 */
export const CLOUD_BASE_M = 250;
export const CLOUD_TILE_M = 3000;
export const CLOUD_TILE_PX = 256;
export const CLOUD_SEED = 20240611;
export const CLOUD_ALPHA_LOW = 0.25;
export const CLOUD_ALPHA_HIGH = 0.6;
export const CLOUD_SHADOW_ALPHA = 0.22;
export const CLOUD_SHADOW_SKEW = 0.3;
/** Plane sprite size steps between the ground and the ceiling, and the extra altitude fraction (of one step) needed to leave the current one. */
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
export const ALT_BUG_MAX_FT = 20000;
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
