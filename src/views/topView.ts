import type { Size } from '../config/display';
import { MARKER_COLOR, SEA_COLOR } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import {
  CHUNK_CELLS,
  groundAt,
  heightAt,
  surfaceAt,
  waterLevelAt,
  worldHeight,
  worldWidth,
  type WorldGrid,
} from '../sim/world/grid';
import { TERRAIN_NAMES } from '../sim/world/terrain';
import { metersPerPixel, screenToWorld, worldToScreen, type Camera, type Point } from './camera';
import { drawScaleBar, drawText } from './overlay';
import type { Probe } from './probe';
import { LAYER_OFFSETS, sliceWindow } from './sideCamera';
import { colorChunk, reduce2x } from './terrainColors';


/** What the side view currently shows, so the top view can mark the same stretch. */
export interface SideLink {
  readonly probe: Probe;
  readonly size: Size;
  readonly zoom: number;
  /** Distance ahead of the probe under the side-view cursor, or null. */
  readonly hoverDistance: number | null;
}

export interface TopView {
  /** Draws the whole panel. `cursor` is in internal pixels, or null. */
  draw(
    ctx: CanvasRenderingContext2D,
    view: Size,
    camera: Camera,
    cursor: Point | null,
    side: SideLink,
  ): void;
}

function toCanvas(data: Uint8ClampedArray, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');
  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  return canvas;
}

export function createTopView(grid: WorldGrid, scale: ScaleConfig): TopView {
  const chunkWorld = CHUNK_CELLS * grid.cellSize;
  const nx = Math.ceil(grid.cols / CHUNK_CELLS);
  const ny = Math.ceil(grid.rows / CHUNK_CELLS);

  // Per chunk: [full, half, quarter] pixel data, and the offscreen canvases built from them.
  const data = new Map<number, Uint8ClampedArray[]>();
  const canvases = new Map<string, HTMLCanvasElement>();

  /** tier 0: 1 px per cell, 1: 2 cells per px, 2: 4 cells per px. */
  function chunkCanvas(cx: number, cy: number, tier: number): HTMLCanvasElement {
    const key = `${cx},${cy},${tier}`;
    const cached = canvases.get(key);
    if (cached) return cached;
    const id = cy * nx + cx;
    let tiers = data.get(id);
    if (!tiers) {
      tiers = [colorChunk(grid, scale, cx, cy)];
      data.set(id, tiers);
    }
    while (tiers.length <= tier) {
      const last = tiers[tiers.length - 1] as Uint8ClampedArray;
      tiers.push(reduce2x(last, CHUNK_CELLS / 2 ** (tiers.length - 1)));
    }
    const canvas = toCanvas(tiers[tier] as Uint8ClampedArray, CHUNK_CELLS / 2 ** tier);
    canvases.set(key, canvas);
    return canvas;
  }

  function drawTerrain(ctx: CanvasRenderingContext2D, view: Size, camera: Camera): void {
    const mpp = metersPerPixel(camera.zoom);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = `rgb(${SEA_COLOR.join(',')})`;
    ctx.fillRect(0, 0, view.width, view.height);

    // Round the map origin once; chunks sit at whole-pixel offsets from it.
    const nw = worldToScreen(camera, view, 0, ny * chunkWorld);
    const ox = Math.round(nw.x);
    const oy = Math.round(nw.y);
    const chunkPx = chunkWorld / mpp;
    const tier = mpp >= 40 ? 2 : mpp >= 20 ? 1 : 0;
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        const dx = ox + cx * chunkPx;
        const dy = oy + (ny - 1 - cy) * chunkPx;
        if (dx >= view.width || dy >= view.height || dx + chunkPx <= 0 || dy + chunkPx <= 0) continue;
        ctx.drawImage(chunkCanvas(cx, cy, tier), dx, dy, chunkPx, chunkPx);
      }
    }
  }

  function drawOverlays(ctx: CanvasRenderingContext2D, view: Size, camera: Camera, cursor: Point | null): void {
    const mpp = metersPerPixel(camera.zoom);

    // North marker, top right.
    const nxp = view.width - 18;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(nxp, 8);
    ctx.lineTo(nxp - 6, 22);
    ctx.lineTo(nxp + 6, 22);
    ctx.closePath();
    ctx.fill();
    drawText(ctx, 'N', nxp, 36, 'center');

    drawScaleBar(ctx, mpp, 8, view.height - 28);

    // Readout: what is under the cursor (or the view center).
    const p = cursor ? screenToWorld(camera, view, cursor.x, cursor.y) : { x: camera.x, y: camera.y };
    const real = heightAt(grid, scale, p.x, p.y) * scale.altitude;
    const inMap = p.x >= 0 && p.y >= 0 && p.x < worldWidth(grid) && p.y < worldHeight(grid);
    const bed = groundAt(grid, scale, p.x, p.y);
    const level = waterLevelAt(grid, scale, p.x, p.y);
    const name = TERRAIN_NAMES[surfaceAt(grid, p.x, p.y)] ?? '?';
    const what =
      level > bed ? `water ${Math.round((level - bed) * scale.altitude)} m deep over ${name}` : name;
    const text = inMap
      ? `x ${Math.round(p.x)} y ${Math.round(p.y)} ${what} ${Math.round(real)} m real / ${Math.round(real / scale.altitude)} m world`
      : `x ${Math.round(p.x)} y ${Math.round(p.y)} outside map`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, view.height - 16, view.width, 16);
    drawText(ctx, text, 5, view.height - 4);
  }

  /** Probe dot and the slice line, covering exactly what the side view shows. */
  function drawSlice(ctx: CanvasRenderingContext2D, view: Size, camera: Camera, side: SideLink): void {
    const { probe } = side;
    const w = sliceWindow(probe, side.size, side.zoom);
    const dx = Math.sin(probe.heading);
    const dy = Math.cos(probe.heading);
    const at = (d: number): Point =>
      worldToScreen(camera, view, probe.x + dx * d, probe.y + dy * d);
    const p0 = at(0);
    const back = at(w.startDistance);
    const end = at(w.startDistance + w.length);
    // Corridor drawn in the side view as hazy layers, to the left of the heading.
    const reach = Math.max(...LAYER_OFFSETS);
    const lx = -dy;
    const ly = dx;
    const corner = (d: number, o: number): Point =>
      worldToScreen(camera, view, probe.x + dx * d + lx * o, probe.y + dy * d + ly * o);
    const d0 = w.startDistance;
    const d1 = w.startDistance + w.length;
    const quad = [corner(d0, 0), corner(d1, 0), corner(d1, reach), corner(d0, reach)];
    ctx.fillStyle = 'rgba(255,211,77,0.10)';
    ctx.beginPath();
    quad.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,211,77,0.25)';
    for (const o of LAYER_OFFSETS) {
      const a = corner(d0, o);
      const b = corner(d1, o);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,211,77,0.45)';
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.lineTo(p0.x, p0.y);
    ctx.stroke();
    ctx.strokeStyle = MARKER_COLOR;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    // End tick (perpendicular) and arrow.
    ctx.beginPath();
    ctx.moveTo(end.x - dy * 5, end.y - dx * 5);
    ctx.lineTo(end.x + dy * 5, end.y + dx * 5);
    ctx.stroke();
    // Screen direction: x = dx, y flipped.
    const ux = dx;
    const uy = -dy;
    const tip = { x: p0.x + ux * 14, y: p0.y + uy * 14 };
    ctx.fillStyle = MARKER_COLOR;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * 8 - uy * 4, tip.y - uy * 8 + ux * 4);
    ctx.lineTo(tip.x - ux * 8 + uy * 4, tip.y - uy * 8 - ux * 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p0.x, p0.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
    if (side.hoverDistance !== null) {
      const h = at(side.hoverDistance);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
  }

  return {
    draw(ctx, view, camera, cursor, side) {
      drawTerrain(ctx, view, camera);
      drawSlice(ctx, view, camera, side);
      drawOverlays(ctx, view, camera, cursor);
    },
  };
}
