import { centerlineEnds, type ApproachGuide } from './approach';
import { GUIDE_COLOR } from '../config/palette';
import type { Size } from '../config/display';
import { CLOUD_BASE_M, CLOUD_SEED, CLOUD_SHADOW_ALPHA, CLOUD_ALPHA_HIGH, CLOUD_SHADOW_SKEW, CLOUD_TILE_M, CLOUD_TILE_PX, DEPTH_FX, RING_LABEL_DEG, RING_MARGIN, RING_MAX_RADIUS, RING_TICK_DEG, TURN_LINE_MAX_S, TURN_LINE_MIN_SPEED, TURN_LINE_TICK_S } from '../config/display';
import { BUG_COLOR, HAZE_COLOR, MARKER_COLOR, RING_COLOR, ROUTE_COLOR, SEA_COLOR, TURN_LINE_COLOR } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import {
  CHUNK_CELLS,
  groundAt,
  heightAt,
  waterLevelAt,
  worldHeight,
  worldWidth,
  type GridPatch,
  type WorldGrid,
} from '../sim/world/grid';
import { createAirportLayer, type MapFrame, type Visible } from './airportLayer';
import { createRoadLayer } from './roadLayer';
import { createCityLayer } from './cityLayer';
import { clampZoom, metersPerPixel, screenToWorld, worldToScreen, zoomLabel, type Camera, type Point } from './camera';
import { edgeArrow } from './edgeArrow';
import { cloudTile } from './cloudTile';
import { agl, cloudAlpha, hazeAlpha, heightScale, planeSizeTier, shadowAlpha, shadowOffsetPx } from './depth';
import { createPlaneSprites } from './sprite';
import { surfaceName } from './surfaceName';
import { drawScaleBar, drawText } from './overlay';
import type { Craft } from '../sim/state';
import { bugCrossing, turnNeeded } from './headingBug';
import { turnTrack } from './turnLine';
import { colorCells, colorChunk, reduce2x } from './terrainColors';
import { routeInfo, routeText, type Route } from './route';


/** What the top view needs to know about the craft. */
export interface SideLink {
  readonly craft: Craft;
  /** The craft has hit the ground: draw the wreck instead of the plane. */
  readonly crashed: boolean;
  /** Heading change in rad/s, clockwise positive: how hard the plane is turning right now. */
  readonly turnRate: number;
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
    /** Heading bug, degrees clockwise from north. Drawn on the compass ring while following. */
    bugDeg: number,
    /** Takeoff HUD mode (C4B): the heading bug and its ring are not drawn; the value is kept. */
    takeoff?: boolean,
    /** Approach guidance (C5): the runway center line is drawn out from the threshold. */
    guide?: ApproachGuide | null,
    /** The leg being flown (E3): a line between the two airports, and how far there is to go. */
    route?: Route | null,
    /** Returns true when building tiles are still stand-ins and another frame would sharpen them. */
  ): boolean;
  /** Builds every chunk, airport patch and sprite frame now, so none is built mid-flight. */
  warm(): void;
}

function toCanvas(data: Uint8ClampedArray, width: number, height: number = width): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');
  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
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

  // Fine patches (E3): one canvas each, drawn over the base chunks when zoomed in enough to show the difference.
  const patchCanvases = new Map<string, HTMLCanvasElement>();
  function patchCanvas(p: GridPatch): HTMLCanvasElement {
    let c = patchCanvases.get(p.id);
    if (!c) {
      c = toCanvas(colorCells(p.grid, scale, 0, 0, p.grid.cols, p.grid.rows), p.grid.cols, p.grid.rows);
      patchCanvases.set(p.id, c);
    }
    return c;
  }

  const airportLayer = createAirportLayer(grid.airports);
  const roadLayer = createRoadLayer(grid.roads ?? []);
  const cityLayer = createCityLayer(grid.buildings ?? []);
  const sprites = createPlaneSprites();
  /** Current plane size step; kept between frames for the hysteresis. */
  let planeTier = 0;

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
    for (const p of tier === 0 ? (grid.patches ?? []) : []) {
      const left = Math.round(ox + p.x / mpp);
      const right = Math.round(ox + (p.x + p.grid.cols * p.grid.cellSize) / mpp);
      const top = Math.round(oy + (ny * chunkWorld - p.y - p.grid.rows * p.grid.cellSize) / mpp);
      const bottom = Math.round(oy + (ny * chunkWorld - p.y) / mpp);
      if (left >= area.right || top >= area.bottom || right <= area.left || bottom <= area.top) continue;
      ctx.drawImage(patchCanvas(p), left, top, right - left, bottom - top);
    }
    return { ox, oy, mpp, mapHeight: ny * chunkWorld };
  }

  /** One cloud tile as a canvas: white where cloud, with the tile's alpha; `black` makes the shadow version. */
  const cloudCanvases = new Map<boolean, HTMLCanvasElement>();
  function cloudCanvas(black: boolean): HTMLCanvasElement {
    let c = cloudCanvases.get(black);
    if (!c) {
      const alpha = cloudTile(CLOUD_TILE_PX, CLOUD_SEED);
      const rgba = new Uint8ClampedArray(CLOUD_TILE_PX * CLOUD_TILE_PX * 4);
      for (let i = 0; i < alpha.length; i++) {
        const v = black ? 0 : 255;
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = alpha[i] as number;
      }
      c = toCanvas(rgba, CLOUD_TILE_PX);
      cloudCanvases.set(black, c);
    }
    return c;
  }

  /**
   * Tiles the cloud canvas over frame-space `area`, anchored to the world so it stays put as the camera moves.
   * `shift` moves the whole layer (frame pixels); tile edges are rounded so tiles meet with no gaps.
   */
  function tileClouds(ctx: CanvasRenderingContext2D, frame: MapFrame, area: Visible, canvas: HTMLCanvasElement, shift: Point): void {
    const tilePx = CLOUD_TILE_M / frame.mpp;
    const x0 = frame.ox + shift.x;
    const y0 = frame.oy + frame.mapHeight / frame.mpp + shift.y; // world y = 0 line; tiles grow north (up) from it
    const first = (edge: number, origin: number) => Math.floor((edge - origin) / tilePx);
    const i0 = first(area.left, x0);
    const i1 = first(area.right, x0);
    const j0 = Math.floor((y0 - area.bottom) / tilePx);
    const j1 = Math.floor((y0 - area.top) / tilePx);
    for (let j = j0; j <= j1; j++) {
      const top = Math.round(y0 - (j + 1) * tilePx);
      const bottom = Math.round(y0 - j * tilePx);
      for (let i = i0; i <= i1; i++) {
        const left = Math.round(x0 + i * tilePx);
        ctx.drawImage(canvas, left, top, Math.round(x0 + (i + 1) * tilePx) - left, bottom - top);
      }
    }
  }

  /**
   * Cloud shadows on the ground (scale 1, shifted southeast) and the clouds themselves, which are scaled about the view
   * center by their height so they slide past the ground as you climb. Both fade with the plane's altitude (cloudAlpha).
   */
  function drawClouds(ctx: CanvasRenderingContext2D, view: Size, frame: MapFrame, area: Visible, z: number): void {
    const strength = cloudAlpha(z);
    const shadowPx = (CLOUD_BASE_M * CLOUD_SHADOW_SKEW) / frame.mpp;
    ctx.globalAlpha = CLOUD_SHADOW_ALPHA * (strength / CLOUD_ALPHA_HIGH);
    tileClouds(ctx, frame, area, cloudCanvas(true), { x: shadowPx * Math.SQRT1_2, y: shadowPx * Math.SQRT1_2 });

    const s = heightScale(CLOUD_BASE_M, z);
    const cx = view.width / 2;
    const cy = view.height / 2;
    const shown: Visible = {
      left: cx + (area.left - cx) / s,
      right: cx + (area.right - cx) / s,
      top: cy + (area.top - cy) / s,
      bottom: cy + (area.bottom - cy) / s,
    };
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = strength;
    tileClouds(ctx, frame, shown, cloudCanvas(false), { x: 0, y: 0 });
    ctx.restore();
    ctx.globalAlpha = 1;
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
    drawText(ctx, zoomLabel(camera.zoom), 8, view.height - 48);

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

  /** Radius of the compass ring, pixels. The turn line is this long too. */
  function ringRadius(view: Size): number {
    return Math.max(30, Math.min(view.height / 2 - RING_MARGIN, RING_MAX_RADIUS));
  }

  /** The plane's pixel, floored to a whole pixel so the sprite does not shimmer. */
  function planePixel(view: Size, camera: Camera, craft: Craft): Point {
    const home = worldToScreen(camera, view, craft.x, craft.y);
    return { x: Math.floor(home.x) + 0.5, y: Math.floor(home.y) + 0.5 };
  }

  /**
   * Dashed line from the plane along the path it will fly at its current speed and turn rate,
   * with a tick every few seconds. Straight when level, curving into the turn when banked.
   */
  /** The runway center line, from far out on the approach to the far end, dashed, even where the runway itself is off screen. */
  function drawCenterline(ctx: CanvasRenderingContext2D, view: Size, camera: Camera, g: ApproachGuide): void {
    const { from, to } = centerlineEnds(g);
    const a = worldToScreen(camera, view, from.x, from.y);
    const b = worldToScreen(camera, view, to.x, to.y);
    ctx.strokeStyle = GUIDE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** The leg as a dashed line, a ring at the destination, and bearing, distance and time to go top left. */
  function drawRoute(ctx: CanvasRenderingContext2D, view: Size, camera: Camera, route: Route, craft: Craft): void {
    const a = worldToScreen(camera, view, route.from.x, route.from.y);
    const b = worldToScreen(camera, view, route.to.x, route.to.y);
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    drawText(ctx, routeText(route.toIdent, routeInfo(craft, route, scale.geoDistance)), 5, 30);
  }

  function drawTurnLine(ctx: CanvasRenderingContext2D, view: Size, camera: Camera, side: SideLink, home: Point, bugDeg: number | null): void {
    const SAMPLES_PER_TICK = 4;
    // Start exactly at the plane's drawn pixel, so the line never disagrees with the sprite.
    const raw = worldToScreen(camera, view, side.craft.x, side.craft.y);
    // The line is as long on screen as the compass ring is wide, at any zoom: pick the flight time that covers that many pixels.
    const probe = worldToScreen(camera, view, side.craft.x + 100, side.craft.y);
    const pxPerM = Math.hypot(probe.x - raw.x, probe.y - raw.y) / 100;
    const seconds = Math.min(TURN_LINE_MAX_S, ringRadius(view) / Math.max(1e-6, pxPerM * side.craft.speed));
    const track = turnTrack(side.craft, side.turnRate, seconds, TURN_LINE_TICK_S / SAMPLES_PER_TICK);
    const shown = track.map((q) => {
      const s = worldToScreen(camera, view, q.x, q.y);
      return { x: s.x - raw.x + home.x, y: s.y - raw.y + home.y };
    });
    ctx.strokeStyle = TURN_LINE_COLOR;
    ctx.fillStyle = TURN_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    shown.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = SAMPLES_PER_TICK; i < shown.length; i += SAMPLES_PER_TICK) {
      const q = shown[i];
      if (q) ctx.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 3, 3);
    }
    // Where the line reaches the bug: a short bar across the line.
    const cross = bugDeg === null ? null : bugCrossing(track.map((q) => q.heading), bugDeg);
    const a = cross && shown[cross.index];
    const b = cross && shown[cross.index + 1];
    if (cross && a && b) {
      const x = a.x + (b.x - a.x) * cross.t;
      const y = a.y + (b.y - a.y) * cross.t;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (-(b.y - a.y) / len) * 7;
      const ny = ((b.x - a.x) / len) * 7;
      ctx.strokeStyle = BUG_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - nx, y - ny);
      ctx.lineTo(x + nx, y + ny);
      ctx.stroke();
    }
  }

  /**
   * Compass ring around the plane. It turns with the map (heading up). The bug sits on it with a faint line from the plane,
   * and a text line gives the bug and the turn needed.
   */
  function drawRing(ctx: CanvasRenderingContext2D, view: Size, rotation: number, craft: Craft, home: Point, bugDeg: number): void {
    const r = ringRadius(view);
    // Screen position of a compass heading, at distance d from the plane.
    const at = (deg: number, d: number): Point => {
      const a = (deg * Math.PI) / 180 - rotation;
      return { x: home.x + Math.sin(a) * d, y: home.y - Math.cos(a) * d };
    };
    ctx.strokeStyle = RING_COLOR;
    ctx.fillStyle = RING_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(home.x, home.y, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let deg = 0; deg < 360; deg += RING_TICK_DEG) {
      const long = deg % RING_LABEL_DEG === 0;
      const a = at(deg, r);
      const b = at(deg, r - (long ? 8 : 4));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (long) {
        const p = at(deg, r + 11);
        drawText(ctx, String(deg).padStart(3, '0'), p.x, p.y + 4, 'center');
      }
    }
    // Bug: a faint line from the plane and a filled marker on the ring.
    const tip = at(bugDeg, r);
    const inner = at(bugDeg, r - 12);
    ctx.strokeStyle = BUG_COLOR;
    ctx.fillStyle = BUG_COLOR;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(home.x, home.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const left = at(bugDeg - 4, r + 3);
    const right = at(bugDeg + 4, r + 3);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();
    const need = Math.round(turnNeeded((craft.heading * 180) / Math.PI, bugDeg));
    const label = need === 0 ? 'ON' : `${need < 0 ? 'L' : 'R'} ${Math.abs(need)}`;
    drawText(ctx, `BUG ${String(Math.round(bugDeg) % 360).padStart(3, '0')}  ${label}`, view.width / 2, 16, 'center');
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
    draw(ctx, view, camera, cursor, side, following, bugDeg, takeoff = false, guide = null, route = null) {
      // Terrain and airports are drawn north-up, then turned about the view center so the
      // camera's heading points up.
      const rotation = camera.rotation ?? 0;
      const area = visibleArea(view);
      ctx.save();
      ctx.translate(view.width / 2, view.height / 2);
      ctx.rotate(-rotation);
      ctx.translate(-view.width / 2, -view.height / 2);
      const frame = drawTerrain(ctx, view, { x: camera.x, y: camera.y, zoom: camera.zoom }, area);
      roadLayer.draw(ctx, frame);
      const unfinished = cityLayer.draw(ctx, frame, area);
      // Haze: a pale veil over the terrain and roads, so airports stay crisp.
      const haze = DEPTH_FX.haze ? hazeAlpha(side.craft.z) : 0;
      if (haze > 0) {
        ctx.globalAlpha = haze;
        ctx.fillStyle = `rgb(${HAZE_COLOR.join(',')})`;
        ctx.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
        ctx.globalAlpha = 1;
      }
      airportLayer.draw(ctx, { ...frame, rotation }, clampZoom(camera.zoom), area);
      if (DEPTH_FX.clouds) drawClouds(ctx, view, frame, area, side.craft.z);
      ctx.restore();
      const plane = planePixel(view, camera, side.craft);
      const showBug = following && !side.crashed && !takeoff && !guide;
      if (route) drawRoute(ctx, view, camera, route, side.craft);
      if (guide) drawCenterline(ctx, view, camera, guide);
      if (showBug) drawRing(ctx, view, camera.rotation ?? 0, side.craft, plane, bugDeg);
      const spriteHeading = side.craft.heading - rotation;
      if (!side.crashed && DEPTH_FX.shadow) {
        const height = agl(side.craft.z, heightAt(grid, scale, side.craft.x, side.craft.y));
        const off = shadowOffsetPx(height, rotation);
        sprites.drawTopShadow(ctx, spriteHeading, plane.x, plane.y, off.x, off.y, shadowAlpha(height));
      }
      if (!side.crashed && !(side.craft.onGround && side.craft.speed < TURN_LINE_MIN_SPEED)) drawTurnLine(ctx, view, camera, side, plane, showBug ? bugDeg : null);
      if (side.crashed) sprites.drawWreck(ctx, plane.x, plane.y);
      else {
        planeTier = DEPTH_FX.planeSize ? planeSizeTier(side.craft.z, planeTier) : 0;
        sprites.drawTop(ctx, spriteHeading, plane.x, plane.y, planeTier);
      }
      drawOverlays(ctx, view, camera, cursor);
      if (!following) {
        drawText(ctx, 'FREE LOOK - C to follow', view.width / 2, 16, 'center');
        drawEdgeArrow(ctx, view, plane);
      }
      return unfinished;
    },
    warm() {
      for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) for (let t = 0; t < 3; t++) chunkCanvas(cx, cy, t);
      for (const p of grid.patches ?? []) patchCanvas(p);
      airportLayer.warm();
      cityLayer.warm();
      sprites.warm();
      cloudCanvas(false);
      cloudCanvas(true);
    },
  };
}
