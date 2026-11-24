import type { Size } from '../config/display';
import { MARKER_COLOR, SEA_COLOR } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import {
  CHUNK_CELLS,
  groundAt,
  heightAt,
  waterLevelAt,
  worldHeight,
  worldWidth,
  type WorldGrid,
} from '../sim/world/grid';
import { createAirportLayer, type MapFrame, type Visible } from './airportLayer';
import { clampZoom, metersPerPixel, screenToWorld, worldToScreen, type Camera, type Point } from './camera';
import { edgeArrow } from './edgeArrow';
import { createPlaneSprites } from './sprite';
import { surfaceName } from './surfaceName';
import { drawScaleBar, drawText } from './overlay';
import type { Craft } from '../sim/state';
import { colorChunk, reduce2x } from './terrainColors';


/** What the top view needs to know about the craft. */
export interface SideLink {
  readonly craft: Craft;
  /** The craft has hit the ground: draw the wreck instead of the plane. */
  readonly crashed: boolean;
}

export interface TopView {
  /** Draws the whole panel. `cursor` is in internal pixels, or null. */
  draw(
    ctx: CanvasRenderingContext2D,
    view: Size,
    camera: Camera,
    cursor: Point | null,
    side: SideLink,
    /** False in free look: shows the banner and an arrow to an off-screen plane. */
    following: boolean,
  ): void;
  /** Builds every chunk, airport patch and sprite frame now, so none is built mid-flight. */
  warm(): void;
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

  const airportLayer = createAirportLayer(grid.airports);
  const sprites = createPlaneSprites();

  /** Frame-space area that can show after rotating about the view center: its bounding circle's square. */
  function visibleArea(view: Size): Visible {
    const r = Math.hypot(view.width, view.height) / 2;
    return { left: view.width / 2 - r, top: view.height / 2 - r, right: view.width / 2 + r, bottom: view.height / 2 + r };
  }

  /** Draws the map as if north were up (`flat` has rotation 0); the caller has rotated the canvas. */
  function drawTerrain(ctx: CanvasRenderingContext2D, view: Size, flat: Camera, area: Visible): MapFrame {
    const camera = flat;
    const mpp = metersPerPixel(camera.zoom);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = `rgb(${SEA_COLOR.join(',')})`;
    ctx.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);

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
        if (dx >= area.right || dy >= area.bottom || dx + chunkPx <= area.left || dy + chunkPx <= area.top) continue;
        ctx.drawImage(chunkCanvas(cx, cy, tier), dx, dy, chunkPx, chunkPx);
      }
    }
    return { ox, oy, mpp, mapHeight: ny * chunkWorld };
  }

  function drawOverlays(ctx: CanvasRenderingContext2D, view: Size, camera: Camera, cursor: Point | null): void {
    const mpp = metersPerPixel(camera.zoom);

    // North marker, top right: the arrow points to north, wherever the map is turned.
    const rot = camera.rotation ?? 0;
    const mx = view.width - 30;
    const my = 44;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-rot);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(-6, 0);
    ctx.lineTo(6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawText(ctx, 'N', mx - Math.sin(rot) * 26, my - Math.cos(rot) * 26 + 4, 'center');

    drawScaleBar(ctx, mpp, 8, view.height - 28);

    // Readout: what is under the cursor (or the view center).
    const p = cursor ? screenToWorld(camera, view, cursor.x, cursor.y) : { x: camera.x, y: camera.y };
    const real = heightAt(grid, scale, p.x, p.y) * scale.altitude;
    const inMap = p.x >= 0 && p.y >= 0 && p.x < worldWidth(grid) && p.y < worldHeight(grid);
    const bed = groundAt(grid, scale, p.x, p.y);
    const level = waterLevelAt(grid, scale, p.x, p.y);
    const name = surfaceName(grid, p.x, p.y);
    const what =
      level > bed ? `water ${Math.round((level - bed) * scale.altitude)} m deep over ${name}` : name;
    const text = inMap
      ? `x ${Math.round(p.x)} y ${Math.round(p.y)} ${what} ${Math.round(real)} m real / ${Math.round(real / scale.altitude)} m world`
      : `x ${Math.round(p.x)} y ${Math.round(p.y)} outside map`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, view.height - 16, view.width, 16);
    drawText(ctx, text, 5, view.height - 4);
  }

  /** The plane's pixel, floored to a whole pixel so the sprite does not shimmer. */
  function planePixel(view: Size, camera: Camera, craft: Craft): Point {
    const home = worldToScreen(camera, view, craft.x, craft.y);
    return { x: Math.floor(home.x) + 0.5, y: Math.floor(home.y) + 0.5 };
  }

  /** Yellow arrow at the panel edge pointing at a plane that is off screen. */
  function drawEdgeArrow(ctx: CanvasRenderingContext2D, view: Size, plane: Point): void {
    const arrow = edgeArrow(view, plane);
    if (!arrow) return;
    ctx.save();
    ctx.translate(arrow.x, arrow.y);
    ctx.rotate(arrow.angle);
    ctx.fillStyle = MARKER_COLOR;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, -8);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  return {
    draw(ctx, view, camera, cursor, side, following) {
      // Terrain and airports are drawn north-up, then turned about the view center so the
      // camera's heading points up.
      const rotation = camera.rotation ?? 0;
      const area = visibleArea(view);
      ctx.save();
      ctx.translate(view.width / 2, view.height / 2);
      ctx.rotate(-rotation);
      ctx.translate(-view.width / 2, -view.height / 2);
      const frame = drawTerrain(ctx, view, { x: camera.x, y: camera.y, zoom: camera.zoom }, area);
      airportLayer.draw(ctx, { ...frame, rotation }, clampZoom(camera.zoom), area);
      ctx.restore();
      const plane = planePixel(view, camera, side.craft);
      if (side.crashed) sprites.drawWreck(ctx, plane.x, plane.y);
      else sprites.drawTop(ctx, side.craft.heading - (camera.rotation ?? 0), plane.x, plane.y);
      drawOverlays(ctx, view, camera, cursor);
      if (!following) {
        drawText(ctx, 'FREE LOOK - C to follow', view.width / 2, 16, 'center');
        drawEdgeArrow(ctx, view, plane);
      }
    },
    warm() {
      for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) for (let t = 0; t < 3; t++) chunkCanvas(cx, cy, t);
      airportLayer.warm();
      sprites.warm();
    },
  };
}
