import { TERRAIN_COLORS, type Rgb } from '../config/palette';
import { airportContains, fineSurfaceAt, OFF_AIRPORT, type Airport, type Runway } from '../sim/world/airport';
import { Terrain } from '../sim/world/terrain';
import { ZOOM_LEVELS } from './camera';
import { drawText } from './overlay';
import { tinted } from './terrainColors';

/**
 * How map meters turn into screen pixels this frame. `ox`, `oy` are the
 * ROUNDED screen position of the map's northwest corner, the same one the
 * terrain chunks use, so everything drawn here stays locked to the ground.
 */
export interface MapFrame {
  readonly ox: number;
  readonly oy: number;
  readonly mpp: number;
  /** Map height in world meters (the y flip). */
  readonly mapHeight: number;
  /** Radians the whole frame is turned on screen (canvas rotation is -rotation); labels undo it. Default 0. */
  readonly rotation?: number;
}

/** Frame-space rectangle (pixels before any rotation) that counts as visible. */
export interface Visible {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const frameX = (f: MapFrame, x: number): number => f.ox + x / f.mpp;
export const frameY = (f: MapFrame, y: number): number => f.oy + (f.mapHeight - y) / f.mpp;

/**
 * One RGBA canvas of the airport's fine grid at `mpp` world meters per pixel.
 * Each pixel samples the surface at its center, so edges are exact rather than
 * a nearest-neighbor scaling of 2 m cells. Pixels outside the boundary are
 * transparent. Runway objects are not in it; the runway is drawn over it.
 */
export function bakePatch(a: Airport, mpp: number): { data: Uint8ClampedArray; width: number; height: number } {
  const width = Math.ceil((a.maxX - a.minX) / mpp);
  const height = Math.ceil((a.maxY - a.minY) / mpp);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    const y = a.maxY - (py + 0.5) * mpp;
    for (let px = 0; px < width; px++) {
      const x = a.minX + (px + 0.5) * mpp;
      if (!airportContains(a, x, y)) continue;
      const code = fineSurfaceAt(a, x, y);
      if (code === OFF_AIRPORT) continue;
      const color = tinted(TERRAIN_COLORS[code] as Rgb, a.fieldElevationM);
      const o = (py * width + px) * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

const RUNWAY_FILL = TERRAIN_COLORS[Terrain.runway] as Rgb;
const MARK = 'rgba(240,240,235,0.95)';
const MIN_DRAWN_WIDTH_PX = 2;

export interface AirportLayer {
  /** Patch, runways, markings and labels for every airport. `zoom` indexes ZOOM_LEVELS. */
  draw(ctx: CanvasRenderingContext2D, f: MapFrame, zoom: number, view: Visible): void;
  /** Bakes every patch at every zoom that uses one. */
  warm(): void;
}

function toCanvas(p: { data: Uint8ClampedArray; width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');
  ctx.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return canvas;
}

export function createAirportLayer(airports: readonly Airport[]): AirportLayer {
  const patches = new Map<string, HTMLCanvasElement>();

  function patch(a: Airport, mpp: number): HTMLCanvasElement {
    const key = `${a.ident}@${mpp}`;
    let c = patches.get(key);
    if (!c) {
      c = toCanvas(bakePatch(a, mpp));
      patches.set(key, c);
    }
    return c;
  }

  function drawRunway(ctx: CanvasRenderingContext2D, f: MapFrame, rw: Runway, zoom: number): void {
    const ux = (rw.b.x - rw.a.x) / rw.length;
    const uy = (rw.b.y - rw.a.y) / rw.length;
    const hw = Math.max(rw.width / 2, (MIN_DRAWN_WIDTH_PX / 2) * f.mpp);
    const corner = (p: { x: number; y: number }, s: number): [number, number] => [
      frameX(f, p.x + uy * hw * s),
      frameY(f, p.y - ux * hw * s),
    ];
    const pts = [corner(rw.a, 1), corner(rw.b, 1), corner(rw.b, -1), corner(rw.a, -1)];
    ctx.fillStyle = `rgb(${RUNWAY_FILL.join(',')})`;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();

    if (zoom < 4) return;
    // Markings, in world meters along (s) and across (t) the runway, from threshold a.
    const at = (s: number, t: number): [number, number] => [
      frameX(f, rw.a.x + ux * s + uy * t),
      frameY(f, rw.a.y + uy * s - ux * t),
    ];
    const px = Math.max(1, 1 / f.mpp); // never thinner than one pixel
    ctx.strokeStyle = MARK;
    ctx.lineCap = 'butt';
    // Threshold bars at both ends: 7 across, 15 m long, 3 m in from the end.
    ctx.lineWidth = Math.max(px, 1.5 / f.mpp);
    for (const end of [0, 1]) {
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        const t = k * 2.8;
        const s0 = end === 0 ? 3 : rw.length - 3;
        const s1 = end === 0 ? 18 : rw.length - 18;
        const [x0, y0] = at(s0, t);
        const [x1, y1] = at(s1, t);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
    // Dashed centerline: 15 m on, 10 m off, clear of the threshold bars and numbers.
    ctx.lineWidth = Math.max(px, 0.9 / f.mpp);
    const [c0x, c0y] = at(zoom >= 5 ? 70 : 25, 0);
    const [c1x, c1y] = at(rw.length - (zoom >= 5 ? 70 : 25), 0);
    ctx.setLineDash([15 / f.mpp, 10 / f.mpp]);
    ctx.beginPath();
    ctx.moveTo(c0x, c0y);
    ctx.lineTo(c1x, c1y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (zoom < 5) return;
    // Runway numbers, upright when read while approaching: landing from a reads names[0] at a.
    const size = 16 / f.mpp;
    ctx.font = `bold ${size}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = MARK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const end of [0, 1]) {
      const [x, y] = at(end === 0 ? 38 : rw.length - 38, 0);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rw.heading + (end === 0 ? 0 : Math.PI));
      ctx.fillText(rw.names[end] as string, 0, 0);
      ctx.restore();
    }
  }

  return {
    warm() {
      for (const a of airports) for (let z = 2; z < ZOOM_LEVELS.length; z++) patch(a, ZOOM_LEVELS[z] as number);
    },
    draw(ctx, f, zoom, view) {
      for (const a of airports) {
        const x0 = frameX(f, a.minX);
        const y0 = frameY(f, a.maxY);
        const w = (a.maxX - a.minX) / f.mpp;
        const h = (a.maxY - a.minY) / f.mpp;
        if (x0 > view.right || y0 > view.bottom || x0 + w < view.left || y0 + h < view.top) continue;
        ctx.imageSmoothingEnabled = false;
        if (zoom >= 2) {
          // The patch is baked at the nearest zoom level; mid-ease it is stretched to the actual scale.
          const levelMpp = ZOOM_LEVELS[zoom] as number;
          const p = patch(a, levelMpp);
          const k = levelMpp / f.mpp;
          if (Math.abs(k - 1) < 1e-9) ctx.drawImage(p, Math.round(x0), Math.round(y0));
          else ctx.drawImage(p, Math.round(x0), Math.round(y0), Math.round(p.width * k), Math.round(p.height * k));
        }
        for (const rw of a.runways) drawRunway(ctx, f, rw, zoom);
        // Ident label beside the middle of the first runway.
        const rw = a.runways[0];
        if (rw) {
          const mx = frameX(f, (rw.a.x + rw.b.x) / 2);
          const my = frameY(f, (rw.a.y + rw.b.y) / 2);
          // Keep the label upright however the map is turned.
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate(f.rotation ?? 0);
          drawText(ctx, `${a.ident} ${rw.names.join('/')}`, 10, -10);
          ctx.restore();
        }
      }
    },
  };
}
