import type { Size } from '../config/display';
import { SEA_COLOR } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import {
  CHUNK_CELLS,
  heightAt,
  surfaceAt,
  worldHeight,
  worldWidth,
  type WorldGrid,
} from '../sim/world/grid';
import { TERRAIN_NAMES } from '../sim/world/terrain';
import { metersPerPixel, screenToWorld, worldToScreen, type Camera, type Point } from './camera';
import { colorChunk, reduce2x } from './terrainColors';

const NICE_LENGTHS = [50, 100, 200, 500, 1000, 2000];
const FONT = '12px ui-monospace, Consolas, monospace';

export interface TopView {
  /** Draws the whole panel. `cursor` is in internal pixels, or null. */
  draw(ctx: CanvasRenderingContext2D, view: Size, camera: Camera, cursor: Point | null): void;
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

  function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    ctx.font = FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
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
    ctx.textAlign = 'center';
    drawText(ctx, 'N', nxp, 36);

    // Scale bar, labelled in world meters (displayed distance does not exist before E1).
    let len = NICE_LENGTHS[0] as number;
    for (const l of NICE_LENGTHS) if (l / mpp <= 160) len = l;
    const px = Math.round(len / mpp);
    const by = view.height - 28;
    ctx.fillStyle = '#000';
    ctx.fillRect(7, by - 1, px + 2, 5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(8, by, px, 3);
    ctx.textAlign = 'left';
    drawText(ctx, `${len} m world`, 8, by - 4);

    // Readout: what is under the cursor (or the view center).
    const p = cursor ? screenToWorld(camera, view, cursor.x, cursor.y) : { x: camera.x, y: camera.y };
    const real = heightAt(grid, scale, p.x, p.y) * scale.altitude;
    const inMap = p.x >= 0 && p.y >= 0 && p.x < worldWidth(grid) && p.y < worldHeight(grid);
    const text = inMap
      ? `x ${Math.round(p.x)} y ${Math.round(p.y)} ${TERRAIN_NAMES[surfaceAt(grid, p.x, p.y)] ?? '?'} ${Math.round(real)} m real / ${Math.round(real / scale.altitude)} m world`
      : `x ${Math.round(p.x)} y ${Math.round(p.y)} outside map`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, view.height - 16, view.width, 16);
    drawText(ctx, text, 5, view.height - 4);
  }

  return {
    draw(ctx, view, camera, cursor) {
      drawTerrain(ctx, view, camera);
      drawOverlays(ctx, view, camera, cursor);
    },
  };
}
