import type { Size } from '../config/display';
import { MARKER_COLOR, SEA_COLOR, SKY_BANDS, TERRAIN_COLORS, waterColor, type Rgb } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import { sliceAlong } from '../sim/world/slice';
import { TERRAIN_NAMES, Terrain } from '../sim/world/terrain';
import { SNOW_LINE_M } from '../sim/world/testMap'; // temporary, until the map carries its own snow line
import type { WorldGrid } from '../sim/world/grid';
import { drawScaleBar, drawText } from './overlay';
import { formatHeading, type Probe } from './probe';
import {
  exaggeration,
  heightToY,
  probeColumn,
  seaRow,
  sideMetersPerPixel,
  LAYER_HAZE,
  LAYER_OFFSETS,
  shiftLeft,
  sliceWindow,
  visualWaterDepth,
  WATER_EXAGGERATION,
  WATER_MIN_PX,
  type SliceWindow,
  xToDistance,
} from './sideCamera';
import type { Point } from './camera';

const rgb = (c: Rgb, k = 1): string =>
  `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;


export interface SideView {
  draw(ctx: CanvasRenderingContext2D, view: Size, probe: Probe, zoom: number, cursor: Point | null): void;
  /** Distance ahead of the probe at an internal x. */
  distanceAt(view: Size, zoom: number, x: number): number;
}

export function createSideView(grid: WorldGrid, scale: ScaleConfig): SideView {
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
    w: SliceWindow,
    haze: number,
  ) {
    const slice = sliceAlong(grid, scale, w.origin, w.heading, w.length, w.samples);
    const yOf = (h: number): number => Math.min(Math.round(heightToY(view, zoom, h)), view.height);
    for (let x = 0; x < view.width; x++) {
      const code = slice.surface[x] as number;
      const bed = slice.groundWorldM[x] as number;
      const level = slice.waterWorldM[x] as number;
      const wet = level > bed; // false for NaN (dry)
      const yTop = wet ? yOf(level) : yOf(bed);
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
        ctx.fillStyle = rgb(mix(waterColor(depthReal), HAZE_COLOR, haze));
        ctx.fillRect(x, yTop, 1, view.height - yTop);
        // Bright line at the surface, so water reads against the sky.
        ctx.fillStyle = rgb(mix([225, 245, 250], HAZE_COLOR, haze));
        ctx.fillRect(x, yTop, 1, Math.min(1, view.height - yTop));
      }
      const top = (TERRAIN_COLORS[code] ?? SEA_COLOR) as Rgb;
      const skin = 4;
      ctx.fillStyle = rgb(mix(top, HAZE_COLOR, haze), wet ? 0.7 : 1);
      ctx.fillRect(x, yBed, 1, skin);
      let bodyTop = yBed + skin;
      if (code === Terrain.snow && !wet) {
        // Snow lies down to the snow line, so a peak is a solid white triangle.
        const lineY = Math.min(Math.round(heightToY(view, zoom, snowLineWorld)), view.height);
        if (lineY > bodyTop) {
          ctx.fillStyle = rgb(mix(top, HAZE_COLOR, haze), 0.93);
          ctx.fillRect(x, bodyTop, 1, lineY - bodyTop);
          bodyTop = lineY;
        }
      }
      ctx.fillStyle = rgb(mix(bodyColor(bed), HAZE_COLOR, haze));
      ctx.fillRect(x, bodyTop, 1, Math.max(0, view.height - bodyTop));
    }
    return slice;
  }

  function drawGround(ctx: CanvasRenderingContext2D, view: Size, probe: Probe, zoom: number) {
    const w = sliceWindow(probe, view, zoom);
    LAYER_OFFSETS.forEach((offset, i) =>
      drawProfile(ctx, view, zoom, shiftLeft(w, offset), LAYER_HAZE[i] as number),
    );
    return drawProfile(ctx, view, zoom, w, 0);
  }

  function drawScale(ctx: CanvasRenderingContext2D, view: Size, zoom: number): void {
    // Tick every 1,000 REAL m = 100 world m at altitude scale 10.
    const stepWorld = 1000 / scale.altitude;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    const sea = Math.round(seaRow(view)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, sea);
    ctx.lineTo(view.width, sea);
    ctx.stroke();
    for (let k = 1; ; k++) {
      const y = Math.round(heightToY(view, zoom, k * stepWorld)) + 0.5;
      if (y < 0) break;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, y - 0.5, 6, 1);
      // Same unit as the horizontal scale bar (world m), with the real altitude beside it.
      drawText(ctx, `${k * stepWorld} m (${k}k real)`, 9, y + 4);
    }
  }

  function drawMarker(ctx: CanvasRenderingContext2D, view: Size, probe: Probe, zoom: number, groundH: number) {
    const x = probeColumn(view) + 0.5;
    const gy = heightToY(view, zoom, groundH);
    ctx.strokeStyle = MARKER_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, view.height - 16);
    ctx.stroke();
    ctx.setLineDash([]);
    const ty = Math.max(14, gy - 14);
    ctx.fillStyle = MARKER_COLOR;
    ctx.beginPath();
    ctx.moveTo(x - 6, ty - 8);
    ctx.lineTo(x + 6, ty - 8);
    ctx.lineTo(x, ty);
    ctx.closePath();
    ctx.fill();
    void probe;
  }

  function drawLabels(ctx: CanvasRenderingContext2D, view: Size, probe: Probe, zoom: number): void {
    drawText(ctx, `HDG ${formatHeading(probe.heading)}`, probeColumn(view) + 10, 16);
    const ex = exaggeration(zoom);
    drawText(ctx, `vert x${ex}  water depth x${WATER_EXAGGERATION}`, view.width - 8, 16, 'right');
    drawScaleBar(ctx, sideMetersPerPixel(zoom), view.width - 180, view.height - 56);
  }

  function drawReadout(
    ctx: CanvasRenderingContext2D,
    view: Size,
    slice: ReturnType<typeof sliceAlong>,
    zoom: number,
    cursor: Point | null,
  ): void {
    const col = Math.min(view.width - 1, Math.max(0, Math.floor(cursor ? cursor.x : probeColumn(view))));
    const d = Math.round(xToDistance(view, zoom, col));
    const h = slice.heightWorldM[col] as number;
    const bed = slice.groundWorldM[col] as number;
    const wetLevel = slice.waterWorldM[col] as number;
    const name = TERRAIN_NAMES[slice.surface[col] as number] ?? '?';
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

  return {
    draw(ctx, view, probe, zoom, cursor) {
      drawSky(ctx, view);
      const slice = drawGround(ctx, view, probe, zoom);
      drawScale(ctx, view, zoom);
      drawMarker(ctx, view, probe, zoom, slice.heightWorldM[probeColumn(view)] as number);
      drawLabels(ctx, view, probe, zoom);
      drawReadout(ctx, view, slice, zoom, cursor);
    },
    distanceAt: (view, zoom, x) => xToDistance(view, zoom, Math.floor(x)),
  };
}
