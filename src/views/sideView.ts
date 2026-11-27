import { AGL_TEXT_LIMIT_M, APPROACH_PATH_DEG, ALT_TAPE_MAX_HEIGHT_PX, ALT_TAPE_PX_PER_FT, ALT_TAPE_WIDTH_PX, ALT_TREND_S, FOREGROUND_ALPHA, FOREGROUND_DARKEN, FOREGROUND_MAX_RISE_PX, GHOST_ALPHA, SIDE_FOREGROUND, SIDE_FX, SIDE_LAYERS, SLOPE_SHADE_BODY, type SideLayer, type Size } from '../config/display';
import { GUIDE_COLOR, BUG_COLOR, STALL_COLOR, WARN_COLOR, FOREGROUND_TINT, PATH_LINE_COLOR, SEA_COLOR, SKY_BANDS, TAPE_BACK_COLOR, TERRAIN_COLORS, TREND_COLOR, waterColor, type Rgb } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import type { Sun } from '../config/sun';
import { sliceAlong, type Slice } from '../sim/world/slice';
import { Terrain } from '../sim/world/terrain';
import { SNOW_LINE_M } from '../sim/world/testMap'; // temporary, until the map carries its own snow line
import { runwaySpan } from '../sim/world/airport';
import { heightAt, type WorldGrid } from '../sim/world/grid';
import { surfaceName } from './surfaceName';
import { guideText, type ApproachGuide } from './approach';
import { createPlaneSprites } from './sprite';
import { createSideBuildings } from './sideBuildings';
import { createSideLandmarks } from './sideLandmarks';
import { drawScaleBar, drawText } from './overlay';
import type { Craft } from '../sim/state';
import { formatAgl, formatHeading, heightAboveGround } from './format';
import { flapStepOf } from '../config/planeShape';
import { bugWorldZ, climbNeededFt, formatClimb, interceptDistance, tapeY } from './altitudeBug';
import { displayedAltitudeFt } from '../sim/units';
import {
  baseHeight,
  exaggeration,
  heightToY,
  planeRow,
  planeColumn,
  seaRow,
  sideMetersPerPixel,
  PATH_LINE_PX,
  pathLineOffset,
  shiftLeft,
  sliceWindow,
  verticalMetersPerPixel,
  visualWaterDepth,
  WATER_EXAGGERATION,
  WATER_MIN_PX,
  type SliceWindow,
  wheelOffsetPx,
  xToDistance,
} from './sideCamera';
import { zoomLabel, type Point } from './camera';
import { envelope, laneOffsets, slopeShade } from './sideLayers';
import { drawRunwayRemaining, type TakeoffHud } from './takeoffStrip';
import type { ApNoticeText } from './autopilotText';

// Colors repeat from column to column, so cache the strings by their packed value.
const rgbCache = new Map<number, string>();
const rgb = (c: Rgb, k = 1): string => {
  const r = Math.min(255, Math.round(c[0] * k));
  const g = Math.min(255, Math.round(c[1] * k));
  const b = Math.min(255, Math.round(c[2] * k));
  const key = (r << 16) | (g << 8) | b;
  let s = rgbCache.get(key);
  if (s === undefined) {
    s = `rgb(${r},${g},${b})`;
    rgbCache.set(key, s);
  }
  return s;
};


export interface SideView {
  draw(
    ctx: CanvasRenderingContext2D,
    view: Size,
    craft: Craft,
    zoom: number,
    cursor: Point | null,
    crashed: boolean,
    /** Altitude bug, displayed feet. */
    altBugFt: number,
    /** Where the light comes from (E8): the lit faces of landmarks. */
    sun: Sun,
    /** Takeoff HUD mode (C4B): runway left replaces the altitude bug and tape. Null otherwise. */
    hud?: TakeoffHud | null,
    /** Approach guidance (C5): the glide line and the LOC / HDG / GS text replace the bugs. Null otherwise. */
    guide?: ApproachGuide | null,
    /** Autopilot (D4): the altitude bug line is solid while it holds, and a refusal or let-go notice shows at the call-out place. */
    ap?: { readonly on: boolean; readonly notice: ApNoticeText | null },
    /** Magnetic variation here, degrees: the HDG text reads magnetic. */
    variationDeg?: number,
  ): void;
  /** Builds every sprite frame now, so none is built mid-flight. */
  warm(): void;
  /** Distance ahead of the plane at an internal x. */
  distanceAt(view: Size, zoom: number, x: number): number;
}

export function createSideView(grid: WorldGrid, scale: ScaleConfig): SideView {
  const sprites = createPlaneSprites();
  const sideBuildings = createSideBuildings(grid, scale);
  const sideLandmarks = createSideLandmarks(grid, scale);

  function drawSky(ctx: CanvasRenderingContext2D, view: Size): void {
    const bandH = Math.ceil(view.height / SKY_BANDS.length);
    SKY_BANDS.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, i * bandH, view.width, bandH);
    });
  }

  const SOIL: Rgb = [84, 62, 44];
  const ROCK: Rgb = [92, 84, 78];
  const SEA_FLOOR: Rgb = [66, 60, 54];
  const smooth = (t: number): number => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };

  /**
   * Body color under the surface layer. It depends on the height of the ground,
   * not on the surface type: the surface type flips from cell to cell (forest,
   * grass, mountain, road), and coloring the body by it makes vertical stripes
   * wherever a slice crosses a boundary. Rock takes over smoothly with height,
   * and the sea floor darkens smoothly below sea level.
   */
  function bodyColor(bedWorldM: number): Rgb {
    const real = bedWorldM * scale.altitude;
    const rocky = mix(SOIL, ROCK, smooth((real - 250) / 500));
    return mix(rocky, SEA_FLOOR, smooth(-real / 100));
  }

  const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const HAZE_COLOR: Rgb = [90, 135, 190];
  const snowLineWorld = SNOW_LINE_M / scale.altitude;

  /** One terrain profile, drawn per column: the bed, with any water as a band over it. */
  function drawProfile(
    ctx: CanvasRenderingContext2D,
    view: Size,
    zoom: number,
    slice: Slice,
    haze: number,
    base: number,
    darken = 0,
    maxRisePx = Infinity,
  ) {
    // Haze toward the sky, then (foreground only) darkening toward the foreground tint.
    const tone = (c: Rgb): Rgb => {
      const h = mix(c, HAZE_COLOR, haze);
      return darken > 0 ? mix(h, FOREGROUND_TINT, darken) : h;
    };
    const topLimit = seaRow(view) - maxRisePx; // a finite cap flattens tall peaks into a ridge
    const yOf = (h: number): number =>
      Math.min(Math.max(Math.round(heightToY(view, zoom, h, base)), topLimit), view.height);
    // Screen row of the surface (water surface when wet) per column, for the slope shading.
    const tops = new Int32Array(view.width);
    for (let x = 0; x < view.width; x++) {
      const bed = slice.groundWorldM[x] as number;
      const level = slice.waterWorldM[x] as number;
      tops[x] = level > bed ? yOf(level) : yOf(bed);
    }
    for (let x = 0; x < view.width; x++) {
      const code = slice.surface[x] as number;
      const bed = slice.groundWorldM[x] as number;
      const level = slice.waterWorldM[x] as number;
      const wet = level > bed; // false for NaN (dry)
      const yTop = tops[x] as number;
      const prev = tops[Math.max(0, x - 1)] as number;
      const next = tops[Math.min(view.width - 1, x + 1)] as number;
      const shade = SIDE_FX.slopeShade ? slopeShade(prev, next) : 1;
      const shadeBody = SIDE_FX.slopeShade ? slopeShade(prev, next, SLOPE_SHADE_BODY) : 1;
      // Water depth is drawn larger than true (the surface itself is exact), so
      // rivers and lakes can be seen at this altitude scale.
      const yBed = wet
        ? Math.min(
            Math.max(yOf(level - visualWaterDepth(level - bed)), yTop + WATER_MIN_PX),
            view.height,
          )
        : yTop;
      if (wet) {
        const depthReal = (level - bed) * scale.altitude;
        ctx.fillStyle = rgb(tone(waterColor(depthReal)));
        ctx.fillRect(x, yTop, 1, view.height - yTop);
        // Bright line at the surface, so water reads against the sky.
        ctx.fillStyle = rgb(tone([225, 245, 250]));
        ctx.fillRect(x, yTop, 1, Math.min(1, view.height - yTop));
      }
      const top = (TERRAIN_COLORS[code] ?? SEA_COLOR) as Rgb;
      const skin = 4;
      ctx.fillStyle = rgb(tone(top), wet ? 0.7 : shade);
      ctx.fillRect(x, yBed, 1, skin);
      let bodyTop = yBed + skin;
      if (code === Terrain.snow && !wet) {
        // Snow lies down to the snow line, so a peak is a solid white triangle.
        const lineY = Math.min(Math.round(heightToY(view, zoom, snowLineWorld, base)), view.height);
        if (lineY > bodyTop) {
          ctx.fillStyle = rgb(tone(top), 0.93 * shade);
          ctx.fillRect(x, bodyTop, 1, lineY - bodyTop);
          bodyTop = lineY;
        }
      }
      ctx.fillStyle = rgb(tone(bodyColor(bed)), shadeBody);
      ctx.fillRect(x, bodyTop, 1, Math.max(0, view.height - bodyTop));
      if (code === Terrain.runway && haze === 0 && darken === 0) {
        // Runways are thin: a white line on top so they stand out from other pavement.
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, yBed, 1, 1);
      }
    }
    return slice;
  }

  function layerSlice(craft: Craft, view: Size, zoom: number, layer: SideLayer): Slice {
    const w = sliceWindow(craft, view, zoom, SIDE_FX.parallax ? layer.k : 1);
    const lanes = SIDE_FX.laneBands ? layer : { ...layer, lanes: 1 };
    const slices = laneOffsets(lanes).map((offset) => {
      const s = shiftLeft(w, offset);
      return sliceAlong(grid, scale, s.origin, s.heading, s.length, s.samples);
    });
    return envelope(slices);
  }

  let fgCanvas: HTMLCanvasElement | null = null;

  /**
   * The foreground profile, drawn dark on an offscreen canvas and laid over the scene at FOREGROUND_ALPHA
   * (one blend for the whole layer, so water and skin do not double up). Returns the screen row of its top
   * per column, or null when it is off.
   */
  function drawForeground(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number): Float32Array | null {
    if (!SIDE_FX.foreground) return null;
    if (!fgCanvas) fgCanvas = document.createElement('canvas');
    if (fgCanvas.width !== view.width || fgCanvas.height !== view.height) {
      fgCanvas.width = view.width;
      fgCanvas.height = view.height;
    }
    const off = fgCanvas.getContext('2d');
    if (!off) return null;
    off.clearRect(0, 0, view.width, view.height);
    const slice = layerSlice(craft, view, zoom, SIDE_FOREGROUND);
    drawProfile(off, view, zoom, slice, 0, base, FOREGROUND_DARKEN, FOREGROUND_MAX_RISE_PX);
    ctx.globalAlpha = FOREGROUND_ALPHA;
    ctx.drawImage(fgCanvas, 0, 0);
    ctx.globalAlpha = 1;
    const tops = new Float32Array(view.width);
    for (let x = 0; x < view.width; x++) tops[x] = heightToY(view, zoom, slice.heightWorldM[x] as number, base);
    return tops;
  }

  /** True when the foreground rises over the plane sprite or its path line, so the ghost is needed. */
  function foregroundCoversPlane(view: Size, craft: Craft, zoom: number, tops: Float32Array): boolean {
    const pc = planeColumn(view);
    const y = planeRow(view, zoom, craft.z) + 6; // sprite half-height, about
    for (let x = Math.max(0, pc - 24); x <= Math.min(view.width - 1, pc + 24 + PATH_LINE_PX); x++) {
      if ((tops[x] as number) <= y) return true;
    }
    return false;
  }

  function drawGround(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number, sun: Sun) {
    for (const layer of SIDE_LAYERS) {
      drawProfile(ctx, view, zoom, layerSlice(craft, view, zoom, layer), layer.haze, base);
      sideBuildings.drawSkyline(ctx, view, craft, zoom, base, SIDE_FX.parallax ? layer : { ...layer, k: 1 }, HAZE_COLOR);
      sideLandmarks.drawSkyline(ctx, view, craft, zoom, base, SIDE_FX.parallax ? layer : { ...layer, k: 1 }, HAZE_COLOR, sun);
    }
    sideBuildings.drawBeside(ctx, view, craft, zoom, base, HAZE_COLOR);
    sideLandmarks.drawBeside(ctx, view, craft, zoom, base, HAZE_COLOR, sun);
    const w = sliceWindow(craft, view, zoom);
    const main = sliceAlong(grid, scale, w.origin, w.heading, w.length, w.samples);
    drawProfile(ctx, view, zoom, main, 0, base);
    sideBuildings.drawCrossed(ctx, view, craft, zoom, base);
    sideLandmarks.drawCrossed(ctx, view, craft, zoom, base, sun);
    return main;
  }

  /** Posts at both ends of each runway the slice crosses, and its name. Independent of the sampling. */
  function drawRunwaySpans(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number): void {
    const w = sliceWindow(craft, view, zoom);
    const mpp = sideMetersPerPixel(zoom);
    const dx = Math.sin(w.heading);
    const dy = Math.cos(w.heading);
    for (const airport of grid.airports) {
      for (const rw of airport.runways) {
        const span = runwaySpan(rw, w.origin, w.heading);
        if (!span) continue;
        const x0 = span.enter / mpp;
        const x1 = span.exit / mpp;
        if (x1 < 0 || x0 > view.width - 1) continue;
        const postY = (t: number): number =>
          Math.round(heightToY(view, zoom, heightAt(grid, scale, w.origin.x + dx * t, w.origin.y + dy * t), base));
        let top = view.height;
        for (const [t, col] of [
          [span.enter, x0],
          [span.exit, x1],
        ] as const) {
          if (col < 0 || col > view.width - 1) continue;
          const y = postY(t);
          top = Math.min(top, y - 14);
          // Off screen when the view has scrolled away from the ground.
          if (y < 0 || y - 14 >= view.height) continue;
          ctx.fillStyle = '#fff';
          ctx.fillRect(Math.round(col), y - 14, 1, 14);
        }
        if (top === view.height) top = postY(span.enter) - 14;
        if (top < 12 || top > view.height - 20) continue;
        const mid = Math.min(view.width - 30, Math.max(30, (Math.max(0, x0) + Math.min(view.width - 1, x1)) / 2));
        drawText(ctx, rw.names.join('/'), mid, top - 4, 'center');
      }
    }
  }

  function drawScale(ctx: CanvasRenderingContext2D, view: Size, zoom: number, base: number): void {
    // Tick every 1,000 REAL m = 100 world m at altitude scale 10.
    const stepWorld = 1000 / scale.altitude;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    const sea = Math.round(heightToY(view, zoom, 0, base)) + 0.5;
    if (sea < view.height - 16) {
      ctx.beginPath();
      ctx.moveTo(0, sea);
      ctx.lineTo(view.width, sea);
      ctx.stroke();
    }
    for (let k = 1; ; k++) {
      const y = Math.round(heightToY(view, zoom, k * stepWorld, base)) + 0.5;
      if (y < 0) break;
      if (y > view.height - 16) continue; // below the panel or under the readout bar
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, y - 0.5, 6, 1);
      // Same unit as the horizontal scale bar (world m), with the real altitude beside it.
      drawText(ctx, `${k * stepWorld} m (${k}k real)`, 9, y + 4);
    }
  }

  /** Faint plumb line from the plane down to the ground: the height above terrain. */
  function drawPlumb(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, groundH: number, base: number, lift: number): void {
    const x = planeColumn(view) + 0.5;
    const planeY = planeRow(view, zoom, craft.z) - lift + 0.5;
    const groundY = heightToY(view, zoom, groundH, base);
    if (groundY <= planeY) return;
    ctx.strokeStyle = 'rgba(255,211,77,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, planeY);
    ctx.lineTo(x, Math.min(groundY, view.height - 16));
    ctx.stroke();
    ctx.setLineDash([]);
    const agl = heightAboveGround(craft.z, groundH);
    if (!craft.onGround && agl > 0.05 && agl < AGL_TEXT_LIMIT_M) drawText(ctx, formatAgl(displayedAltitudeFt(agl, scale)), x + 8, (planeY + Math.min(groundY, view.height - 16)) / 2 + 4);
  }

  function drawPlane(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, crashed: boolean, lift: number): void {
    const x = planeColumn(view) + 0.5;
    const row = planeRow(view, zoom, craft.z);
    // The wreck sits on the ground; a plane stands on its wheels, so its sprite is lifted by `lift`.
    const y = row - lift;
    if (crashed) sprites.drawWreck(ctx, x, row);
    else {
      // The gap between nose and path line is the angle of attack.
      const end = pathLineOffset(craft.pathAngle, exaggeration(zoom), PATH_LINE_PX);
      ctx.strokeStyle = PATH_LINE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.floor(x), Math.floor(y) + 0.5);
      ctx.lineTo(Math.floor(x) + end.dx, Math.floor(y) + 0.5 + end.dy);
      ctx.stroke();
      sprites.drawSide(ctx, craft.pitch, x, y, craft.gear > 0.5, flapStepOf(craft.flaps));
    }
  }

  /**
   * Altitude bug: a dashed line across the view at the target height, a tick where the current path reaches it,
   * and a magnified altitude tape on the right (precision the main scale cannot show), with a trend vector.
   */
  function drawAltBug(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number, bugFt: number, solid = false): void {
    const altFt = displayedAltitudeFt(craft.z, scale);
    const need = climbNeededFt(altFt, bugFt);
    const bugZ = bugWorldZ(bugFt, scale);
    const tapeLeft = view.width - ALT_TAPE_WIDTH_PX - 6;

    // Line across the main view, and where the path line reaches it.
    const ly = Math.round(heightToY(view, zoom, bugZ, base)) + 0.5;
    const onScreen = ly >= 0 && ly <= view.height - 16;
    if (onScreen) {
      ctx.strokeStyle = BUG_COLOR;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash(solid ? [] : [8, 5]);
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(tapeLeft - 4, ly);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const d = interceptDistance(craft.z, bugZ, craft.pathAngle);
      if (d !== null) {
        const x = Math.round(planeColumn(view) + d / sideMetersPerPixel(zoom)) + 0.5;
        if (x < tapeLeft - 4) {
          ctx.strokeStyle = BUG_COLOR;
          ctx.beginPath();
          ctx.moveTo(x, ly - 7);
          ctx.lineTo(x, ly + 7);
          ctx.stroke();
        }
      }
    }
    const arrow = onScreen ? '' : ly < 0 ? '^ ' : 'v ';
    const labelY = onScreen ? ly - 4 : ly < 0 ? 30 : view.height - 22;
    drawText(ctx, `${arrow}ALT BUG ${bugFt} ft`, tapeLeft - 8, labelY, 'right');

    // The tape: current altitude at the middle, 10 ft per 4 px.
    const top = 40;
    const h = Math.max(80, Math.min(ALT_TAPE_MAX_HEIGHT_PX, view.height - 16 - top - 18));
    const cy = top + h / 2;
    const half = h / 2;
    ctx.fillStyle = TAPE_BACK_COLOR;
    ctx.fillRect(tapeLeft, top, ALT_TAPE_WIDTH_PX, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(tapeLeft, top, ALT_TAPE_WIDTH_PX, h);
    ctx.clip();
    const spanFt = half / ALT_TAPE_PX_PER_FT;
    ctx.fillStyle = '#fff';
    for (let ft = Math.ceil((altFt - spanFt) / 10) * 10; ft <= altFt + spanFt; ft += 10) {
      const y = Math.round(cy - (ft - altFt) * ALT_TAPE_PX_PER_FT);
      const major = ft % 100 === 0;
      const len = major ? 12 : ft % 50 === 0 ? 8 : 4;
      ctx.fillRect(tapeLeft + ALT_TAPE_WIDTH_PX - len, y, len, 1);
      if (major) drawText(ctx, String(ft), tapeLeft + 4, y + 4);
    }
    // Trend: where altitude will be in ALT_TREND_S at the current climb rate.
    const trendFt = displayedAltitudeFt(craft.speed * Math.sin(craft.pathAngle) * ALT_TREND_S, scale);
    const ty = tapeY(altFt + trendFt, altFt, cy, ALT_TAPE_PX_PER_FT, half);
    ctx.fillStyle = TREND_COLOR;
    ctx.fillRect(tapeLeft + ALT_TAPE_WIDTH_PX - 3, Math.min(cy, ty), 3, Math.abs(ty - cy) + 1);
    // Bug marker: a bar across the tape, clamped to the edge when far off.
    const by = Math.round(tapeY(bugFt, altFt, cy, ALT_TAPE_PX_PER_FT, half));
    ctx.fillStyle = BUG_COLOR;
    ctx.fillRect(tapeLeft, by - 1, ALT_TAPE_WIDTH_PX, 3);
    ctx.restore();
    // Current altitude: a pointer at the middle, from the left.
    ctx.fillStyle = TREND_COLOR;
    ctx.beginPath();
    ctx.moveTo(tapeLeft - 7, cy - 5);
    ctx.lineTo(tapeLeft, cy);
    ctx.lineTo(tapeLeft - 7, cy + 5);
    ctx.fill();
    drawText(ctx, `${formatClimb(need)}`, tapeLeft + ALT_TAPE_WIDTH_PX / 2, top + h + 14, 'center');
  }

  function drawLabels(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, variationDeg: number): void {
    drawText(ctx, `HDG ${formatHeading(craft.heading + (variationDeg * Math.PI) / 180)}`, planeColumn(view) + 10, 16);
    const ex = exaggeration(zoom);
    drawText(ctx, `vert x${ex}  water depth x${WATER_EXAGGERATION}`, view.width - 8, 16, 'right');
    drawScaleBar(ctx, sideMetersPerPixel(zoom), view.width - 180, view.height - 56);
    drawText(ctx, zoomLabel(zoom), view.width - 180, view.height - 76);
  }

  function drawReadout(
    ctx: CanvasRenderingContext2D,
    view: Size,
    slice: ReturnType<typeof sliceAlong>,
    w: SliceWindow,
    zoom: number,
    cursor: Point | null,
  ): void {
    const col = Math.min(view.width - 1, Math.max(0, Math.floor(cursor ? cursor.x : planeColumn(view))));
    const d = Math.round(xToDistance(view, zoom, col));
    const h = slice.heightWorldM[col] as number;
    const bed = slice.groundWorldM[col] as number;
    const wetLevel = slice.waterWorldM[col] as number;
    const dist = col * sideMetersPerPixel(zoom);
    const name = surfaceName(grid, w.origin.x + Math.sin(w.heading) * dist, w.origin.y + Math.cos(w.heading) * dist);
    const sign = d >= 0 ? '+' : '-';
    const what =
      wetLevel > bed
        ? `water ${Math.round((wetLevel - bed) * scale.altitude)} m deep over ${name}`
        : name;
    const real = h * scale.altitude;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, view.height - 16, view.width, 16);
    drawText(ctx, `${sign}${Math.abs(d)} m world  ${what}  ${Math.round(real)} m real / ${Math.round(h)} m world`, 5, view.height - 4);
    if (cursor) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(col, 0, 1, view.height - 16);
    }
  }

  const groundAtAim = (g: ApproachGuide): number => heightAt(grid, scale, g.aim.x, g.aim.y);

  /** The 3 degree glide path through the aim point, as a dashed line in this view's slice, and the LOC / HDG / GS text. */
  function drawApproach(ctx: CanvasRenderingContext2D, view: Size, zoom: number, base: number, g: ApproachGuide, aimZ: number): void {
    const pc = planeColumn(view);
    const mpp = sideMetersPerPixel(zoom);
    const slope = Math.tan(APPROACH_PATH_DEG * (Math.PI / 180));
    const at = (d: number): { x: number; y: number } => ({ x: pc + 0.5 + d / mpp, y: heightToY(view, zoom, aimZ + Math.max(0, g.aimAhead - d) * slope, base) });
    const near = at(Math.max(0, g.aimAhead - 6000));
    const aim = at(g.aimAhead);
    if (g.aimAhead > 0) {
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(near.x, near.y);
      ctx.lineTo(aim.x, aim.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = GUIDE_COLOR;
      ctx.fillRect(Math.round(aim.x) - 2, Math.round(aim.y) - 2, 5, 5);
    }
    drawText(ctx, guideText(g), Math.round(view.width / 2), 16, 'center');
  }

  return {
    draw(ctx, view, craft, zoom, cursor, crashed, altBugFt, sun, hud = null, guide = null, ap = { on: false, notice: null }, variationDeg = 0) {
      const base = baseHeight(view, zoom, craft.z);
      drawSky(ctx, view);
      const slice = drawGround(ctx, view, craft, zoom, base, sun);
      drawRunwaySpans(ctx, view, craft, zoom, base);
      drawScale(ctx, view, zoom, base);
      const groundH = slice.heightWorldM[planeColumn(view)] as number;
      const lift = crashed ? 0 : wheelOffsetPx((craft.z - groundH) / verticalMetersPerPixel(zoom));
      drawPlumb(ctx, view, craft, zoom, groundH, base, lift);
      drawPlane(ctx, view, craft, zoom, crashed, lift);
      const fgTops = drawForeground(ctx, view, craft, zoom, base);
      if (fgTops && foregroundCoversPlane(view, craft, zoom, fgTops)) {
        // The plane is never lost behind a ridge: a faint copy goes over the foreground.
        ctx.globalAlpha = GHOST_ALPHA;
        drawPlane(ctx, view, craft, zoom, crashed, lift);
        ctx.globalAlpha = 1;
      }
      if (guide) drawApproach(ctx, view, zoom, base, guide, groundAtAim(guide));
      else if (hud) drawRunwayRemaining(ctx, view.width, hud);
      else if (!crashed) drawAltBug(ctx, view, craft, zoom, base, altBugFt, ap.on);
      if (ap.notice && !crashed) {
        ctx.font = 'bold 22px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#000';
        ctx.fillText(ap.notice.text, view.width / 2 + 1, 63);
        ctx.fillStyle = ap.notice.kind === 'dropped' ? STALL_COLOR : WARN_COLOR;
        ctx.fillText(ap.notice.text, view.width / 2, 62);
      }
      drawLabels(ctx, view, craft, zoom, variationDeg);
      drawReadout(ctx, view, slice, sliceWindow(craft, view, zoom), zoom, cursor);
    },
    distanceAt: (view, zoom, x) => xToDistance(view, zoom, Math.floor(x)),
    warm: () => sprites.warm(),
  };
}
