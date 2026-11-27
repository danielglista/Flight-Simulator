import { SIDE_BUILDING_BESIDE_M, SIDE_LANDMARK_BEHIND_M, SIDE_LANDMARK_HAZE, SIDE_LANDMARK_POST_MAX_MPP, type Size } from '../config/display';
import { LANDMARK_FLAG_COLOR, LANDMARK_POLE_COLOR, type Rgb } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import type { Craft } from '../sim/state';
import { heightAt, type WorldGrid } from '../sim/world/grid';
import type { LandmarkSolid, MapLandmark } from '../sim/world/mapFile';
import { landmarkCircle, solidCorners, solidTopAt } from '../sim/world/obstacles';
import { landmarkColor, postPoints } from './landmarkLayer';
import { heightToY, sliceWindow, verticalMetersPerPixel, type SliceWindow } from './sideCamera';
import { lineSpan } from './sideBuildings';

/** A solid's outline seen across a line: extents along it at the bottom and top, and how far its middle is to the LEFT. */
export function silhouette(s: LandmarkSolid, ox: number, oy: number, heading: number): { readonly base: readonly [number, number]; readonly top: readonly [number, number]; readonly left: number } {
  const dx = Math.sin(heading);
  const dy = Math.cos(heading);
  const along = (s.x - ox) * dx + (s.y - oy) * dy;
  const turn = ((s.turn ?? 0) * Math.PI) / 180;
  const alongWidth = Math.abs(dx * Math.cos(turn) - dy * Math.sin(turn));
  const alongDepth = Math.abs(dx * Math.sin(turn) + dy * Math.cos(turn));
  const half = (width: number, depth: number): number => (alongWidth * width + alongDepth * depth) / 2;
  if (s.shape === 'prism') {
    const p = s.points ?? [];
    const at: number[] = [];
    for (let i = 0; i < p.length; i += 2) at.push(((p[i] as number) - ox) * dx + ((p[i + 1] as number) - oy) * dy);
    const span: [number, number] = [Math.min(...at), Math.max(...at)];
    return { base: span, top: span, left: -(s.x - ox) * dy + (s.y - oy) * dx };
  }
  // A circle is as wide from every side.
  const base = s.shape ? s.width / 2 : half(s.width, s.depth);
  const top = s.shape ? s.topWidth / 2 : half(s.topWidth, s.topDepth);
  return { base: [along - base, along + base], top: [along - top, along + top], left: -(s.x - ox) * dy + (s.y - oy) * dx };
}

/** How brightly the northwest light falls on the south, east, north and west faces. */
const FACE_LIGHT = [0.84, 0.7, 1.08, 0.98] as const;

/** The same light for a wall facing any way: it gives the four values above for the four compass faces. */
export function faceLight(nx: number, ny: number): number {
  const [south, east, north, west] = FACE_LIGHT;
  return (ny > 0 ? north : south) * ny * ny + (nx > 0 ? east : west) * nx * nx;
}

/** One face of a solid as seen from the side: where its bottom and top edges start and end along the line of flight. */
export interface SideFace {
  readonly base: readonly [number, number];
  readonly top: readonly [number, number];
  readonly light: number;
}

/**
 * The faces turned toward the viewer, who looks to the left of the heading: one when square on, otherwise two. Each
 * keeps its own light, so circling a solid shows its faces come round.
 */
export function sideFaces(s: LandmarkSolid, ox: number, oy: number, heading: number): SideFace[] {
  const dx = Math.sin(heading);
  const dy = Math.cos(heading);
  const along = (x: number, y: number): number => (x - ox) * dx + (y - oy) * dy;
  if (s.shape === 'prism') {
    const p = s.points ?? [];
    const walls: SideFace[] = [];
    for (let i = 0; i < p.length; i += 2) {
      const [ax, ay, bx, by] = [p[i] as number, p[i + 1] as number, p[(i + 2) % p.length] as number, p[(i + 3) % p.length] as number];
      const length = Math.hypot(bx - ax, by - ay);
      // Outward from a counterclockwise outline.
      const nx = (by - ay) / length;
      const ny = -(bx - ax) / length;
      if (-nx * dy + ny * dx >= -1e-6) continue;
      const span: [number, number] = [Math.min(along(ax, ay), along(bx, by)), Math.max(along(ax, ay), along(bx, by))];
      walls.push({ base: span, top: span, light: faceLight(nx, ny) });
    }
    return walls;
  }
  // Southwest, southeast, northeast, northwest, so edge i runs along face i.
  const base = solidCorners(s, s.width, s.depth);
  const top = solidCorners(s, s.topWidth, s.topDepth);
  const turn = ((s.turn ?? 0) * Math.PI) / 180;
  const out: SideFace[] = [];
  for (let i = 0; i < 4; i++) {
    const bearing = Math.PI - (i * Math.PI) / 2 + turn;
    const nx = Math.sin(bearing);
    const ny = Math.cos(bearing);
    // The view runs along (-dy, dx); a face shows when it points back against that.
    if (-nx * dy + ny * dx >= -1e-6) continue;
    const span = (points: typeof base): [number, number] => {
      const a = along(...(points[i] as readonly [number, number]));
      const b = along(...(points[(i + 1) % 4] as readonly [number, number]));
      return [Math.min(a, b), Math.max(a, b)];
    };
    out.push({ base: span(base), top: span(top), light: faceLight(nx, ny) });
  }
  return out;
}

/** Strips a round wall is shaded in. */
const ROUND_STRIPS = 7;

/**
 * Light on a round wall at `across` (-1 to 1 along the line of flight) seen from the right of `heading`: the same
 * northwest sun as the flat faces, so a dome's bright side comes round as you circle it.
 */
export function roundLight(across: number, heading: number): number {
  const toward = Math.sqrt(Math.max(0, 1 - across * across));
  // The wall's compass normal: part along the line of flight, part back toward the viewer on the right.
  const east = Math.sin(heading) * across + Math.cos(heading) * toward;
  const north = Math.cos(heading) * across - Math.sin(heading) * toward;
  return 0.92 + 0.2 * (north - east) * Math.SQRT1_2;
}

/** Order for painting: what stands on the ground farthest first, then what stands on top of it, lowest first. */
export function paintOrder<T extends { readonly s: LandmarkSolid; readonly left: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const raised = Number(a.s.bottom > 0) - Number(b.s.bottom > 0);
    if (raised !== 0) return raised;
    return a.s.bottom > 0 ? a.s.bottom - b.s.bottom || b.left - a.left : b.left - a.left || a.s.top - b.s.top;
  });
}

/** Landmarks in the order to paint them: the one farthest to the left of the line first. */
export function farthestFirst<T extends { readonly x: number; readonly y: number }>(landmarks: readonly T[], w: Pick<SliceWindow, 'origin' | 'heading'>): T[] {
  const left = (l: T): number => -(l.x - w.origin.x) * Math.cos(w.heading) + (l.y - w.origin.y) * Math.sin(w.heading);
  return [...landmarks].sort((a, b) => left(b) - left(a));
}

/**
 * Can anything in the circle show in a slice `widthM` long, between `lo` and `hi` to the left of its line? Asked first,
 * so landmarks out of sight cost nothing more.
 */
export function inSlice(c: { readonly x: number; readonly y: number; readonly radius: number }, w: Pick<SliceWindow, 'origin' | 'heading'>, widthM: number, lo: number, hi: number): boolean {
  const dx = Math.sin(w.heading);
  const dy = Math.cos(w.heading);
  const along = (c.x - w.origin.x) * dx + (c.y - w.origin.y) * dy;
  const left = -(c.x - w.origin.x) * dy + (c.y - w.origin.y) * dx;
  return along + c.radius >= 0 && along - c.radius <= widthM && left + c.radius >= lo && left - c.radius <= hi;
}

export interface SideLandmarks {
  /** Landmarks in a parallax layer's band, hazed. */
  drawSkyline(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number, layer: { readonly nearM: number; readonly farM: number; readonly haze: number; readonly k: number }, haze: Rgb): void;
  /** Whole outlines of those near the flight line, a little pale. Draw BEFORE the main terrain, which hides their feet. */
  drawBeside(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number, haze: Rgb): void;
  /** The cut the flight line makes through them, solid: what is drawn here can be hit. Draw over the main terrain. */
  drawCrossed(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number): void;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c: Rgb, k = 1): string => `rgb(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))})`;

export function createSideLandmarks(grid: WorldGrid, scale: ScaleConfig): SideLandmarks {
  const landmarks = (grid.landmarks ?? []).map((l) => ({ ...l, ground: heightAt(grid, scale, l.x, l.y), circle: landmarkCircle(l), solids: [...l.solids].sort((a, b) => a.top - b.top) }));
  const metersPerColumn = (w: SliceWindow): number => w.length / Math.max(1, w.samples - 1);

  /** The landmarks that can show between `lo` and `hi` to the left of the window's line. */
  const near = (view: Size, w: SliceWindow, lo: number, hi: number) => landmarks.filter((l) => inSlice(l.circle, w, view.width * metersPerColumn(w), lo, hi));

  /** The faces of one solid between screen rows `yb` and `yt`; `footPx` carries them on down below `yb`. */
  function paintFaces(ctx: CanvasRenderingContext2D, faces: readonly SideFace[], mpp: number, yb: number, yt: number, color: Rgb, footPx: number | null): void {
    for (const f of faces) {
      const [b0, b1] = [f.base[0] / mpp, f.base[1] / mpp];
      const [t0, t1] = [f.top[0] / mpp, f.top[1] / mpp];
      ctx.fillStyle = rgb(color, f.light);
      ctx.beginPath();
      // At least half a pixel wide, so a thin shaft does not vanish.
      ctx.moveTo(b0, yb);
      ctx.lineTo(Math.max(b1, b0 + 0.5), yb);
      ctx.lineTo(Math.max(t1, t0 + 0.5), yt);
      ctx.lineTo(t0, yt);
      ctx.closePath();
      ctx.fill();
      if (footPx !== null && footPx > yb) ctx.fillRect(b0, yb, Math.max(0.5, b1 - b0), footPx - yb);
    }
  }

  /** A drum or dome between screen rows `yb` and `yt`, in upright strips of its outline. */
  function paintRound(ctx: CanvasRenderingContext2D, s: LandmarkSolid, center: number, mpp: number, heading: number, yb: number, yt: number, color: Rgb, footPx: number | null): void {
    const r = s.width / 2 / mpp;
    const topR = s.topWidth / 2 / mpp;
    for (let i = 0; i < ROUND_STRIPS; i++) {
      const a = (i / ROUND_STRIPS) * 2 - 1;
      const b = ((i + 1) / ROUND_STRIPS) * 2 - 1;
      ctx.fillStyle = rgb(color, roundLight((a + b) / 2, heading));
      ctx.beginPath();
      if (s.shape === 'dome') {
        ctx.moveTo(center + a * r, yb);
        ctx.lineTo(center + b * r, yb);
        for (const e of [b, (a + b) / 2, a]) ctx.lineTo(center + e * r, yb - (yb - yt) * Math.sqrt(Math.max(0, 1 - e * e)));
      } else {
        ctx.moveTo(center + a * r, yb);
        ctx.lineTo(center + Math.max(b * r, a * r + 0.5), yb);
        ctx.lineTo(center + b * topR, yt);
        ctx.lineTo(center + a * topR, yt);
      }
      ctx.closePath();
      ctx.fill();
    }
    if (footPx !== null && footPx > yb) ctx.fillRect(center - r, yb, 2 * r, footPx - yb);
  }

  /** Dark upright lines for columns and windows, where they are far enough apart on screen to be told apart. */
  function paintColumns(ctx: CanvasRenderingContext2D, s: LandmarkSolid, faces: readonly SideFace[], center: number, mpp: number, yb: number, yt: number, color: Rgb): void {
    if (!s.columns || s.columns / mpp < 2.5 || yb - yt < 4) return;
    const top = Math.round(yt + (yb - yt) * 0.18);
    const height = Math.round(yb - (yb - yt) * 0.14) - top;
    ctx.fillStyle = rgb(color, 0.55);
    const line = (x: number): void => ctx.fillRect(Math.round(x), top, 1, height);
    if (s.shape === 'drum' || s.shape === 'dome') {
      // Evenly spaced round the circle, so they crowd toward the edges.
      const count = Math.max(8, Math.round((Math.PI * s.width) / s.columns));
      for (let i = 1; i < count / 2; i++) line(center - Math.cos((i / (count / 2)) * Math.PI) * (s.width / 2 / mpp));
      return;
    }
    for (const f of faces) {
      const length = f.base[1] - f.base[0];
      const count = Math.floor(length / s.columns);
      for (let i = 1; i < count; i++) line((f.base[0] + (length * i) / count) / mpp);
    }
  }

  /** One whole solid, walls and columns. */
  function paintSolid(ctx: CanvasRenderingContext2D, s: LandmarkSolid, w: SliceWindow, yb: number, yt: number, color: Rgb, footPx: number | null): void {
    const mpp = metersPerColumn(w);
    const center = ((s.x - w.origin.x) * Math.sin(w.heading) + (s.y - w.origin.y) * Math.cos(w.heading)) / mpp;
    const round = s.shape === 'drum' || s.shape === 'dome';
    const faces = round ? [] : sideFaces(s, w.origin.x, w.origin.y, w.heading);
    if (round) paintRound(ctx, s, center, mpp, w.heading, yb, yt, color, footPx);
    else paintFaces(ctx, faces, mpp, yb, yt, color, footPx);
    paintColumns(ctx, s, faces, center, mpp, yb, yt, color);
  }

  /** Every solid whose middle is between `lo` and `hi` to the left of the line. */
  function outlines(ctx: CanvasRenderingContext2D, view: Size, zoom: number, base: number, w: SliceWindow, lo: number, hi: number, haze: Rgb, amount: number, footPx: number | null): void {
    const mpp = metersPerColumn(w);
    // Farthest first, so a nearer tower covers one behind it.
    for (const l of farthestFirst(near(view, w, lo, hi), w)) {
      // What is in front covers what is behind it.
      const seen = paintOrder(l.solids.map((s) => { const o = silhouette(s, w.origin.x, w.origin.y, w.heading); return { s, o, left: o.left }; }));
      for (const { s, o } of seen) {
        if (o.left < lo || o.left > hi) continue;
        if (o.base[1] / mpp < 0 || o.base[0] / mpp >= view.width) continue;
        const yb = heightToY(view, zoom, l.ground + s.bottom, base);
        const yt = heightToY(view, zoom, l.ground + s.top, base);
        // A solid standing on the ground runs on down, to meet terrain drawn after it.
        paintSolid(ctx, s, w, yb, yt, mix(landmarkColor(s.material), haze, amount), s.bottom === 0 ? footPx : null);
      }
    }
  }

  function posts(ctx: CanvasRenderingContext2D, view: Size, zoom: number, base: number, w: SliceWindow, l: MapLandmark & { readonly ground: number }): void {
    if (!l.posts || verticalMetersPerPixel(zoom) > SIDE_LANDMARK_POST_MAX_MPP) return;
    const mpp = metersPerColumn(w);
    const dx = Math.sin(w.heading);
    const dy = Math.cos(w.heading);
    const foot = Math.round(heightToY(view, zoom, l.ground, base));
    const top = Math.round(heightToY(view, zoom, l.ground + l.posts.height, base));
    for (const [px, py] of postPoints(l.posts)) {
      const left = -(px - w.origin.x) * dy + (py - w.origin.y) * dx;
      if (left < -SIDE_BUILDING_BESIDE_M || left > SIDE_LANDMARK_BEHIND_M) continue;
      const x = Math.round(((px - w.origin.x) * dx + (py - w.origin.y) * dy) / mpp);
      if (x < 0 || x >= view.width) continue;
      ctx.fillStyle = rgb(LANDMARK_POLE_COLOR);
      ctx.fillRect(x, top, 1, Math.max(0, foot - top));
      ctx.fillStyle = rgb(LANDMARK_FLAG_COLOR);
      ctx.fillRect(x + 1, top, 3, 2);
    }
  }

  /** Cables and braces near the flight line, as thin lines. */
  function wires(ctx: CanvasRenderingContext2D, view: Size, zoom: number, base: number, w: SliceWindow, l: MapLandmark & { readonly ground: number }, haze: Rgb): void {
    const mpp = metersPerColumn(w);
    const dx = Math.sin(w.heading);
    const dy = Math.cos(w.heading);
    ctx.lineWidth = 1;
    for (const wire of l.wires ?? []) {
      ctx.strokeStyle = rgb(mix(landmarkColor(wire.material), haze, SIDE_LANDMARK_HAZE));
      ctx.beginPath();
      let down = false;
      for (let i = 0; i < wire.points.length; i += 3) {
        const px = wire.points[i] as number;
        const py = wire.points[i + 1] as number;
        const left = -(px - w.origin.x) * dy + (py - w.origin.y) * dx;
        if (left < -SIDE_BUILDING_BESIDE_M || left > SIDE_LANDMARK_BEHIND_M) {
          down = false;
          continue;
        }
        const x = ((px - w.origin.x) * dx + (py - w.origin.y) * dy) / mpp;
        const y = heightToY(view, zoom, l.ground + (wire.points[i + 2] as number), base);
        if (down) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        down = true;
      }
      ctx.stroke();
    }
  }

  return {
    drawSkyline(ctx, view, craft, zoom, base, layer, haze) {
      outlines(ctx, view, zoom, base, sliceWindow(craft, view, zoom, layer.k), layer.nearM, layer.farM, haze, layer.haze, null);
    },
    drawBeside(ctx, view, craft, zoom, base, haze) {
      const w = sliceWindow(craft, view, zoom);
      outlines(ctx, view, zoom, base, w, -SIDE_BUILDING_BESIDE_M, SIDE_LANDMARK_BEHIND_M, haze, SIDE_LANDMARK_HAZE, view.height);
      for (const l of near(view, w, -SIDE_BUILDING_BESIDE_M, SIDE_LANDMARK_BEHIND_M)) {
        posts(ctx, view, zoom, base, w, l);
        wires(ctx, view, zoom, base, w, l, haze);
      }
    },
    drawCrossed(ctx, view, craft, zoom, base) {
      const w = sliceWindow(craft, view, zoom);
      const mpp = metersPerColumn(w);
      const dx = Math.sin(w.heading);
      const dy = Math.cos(w.heading);
      for (const l of near(view, w, 0, 0)) {
        const foot = Math.round(heightToY(view, zoom, l.ground, base));
        for (const { s } of paintOrder(l.solids.map((s) => ({ s, left: silhouette(s, w.origin.x, w.origin.y, w.heading).left })))) {
          // lineSpan takes a footprint whose width runs along its angle: north here, so the sides are swapped.
          const span = lineSpan({ x: s.x, y: s.y, width: s.depth, depth: s.width, angle: s.turn ?? 0 }, w.origin.x, w.origin.y, w.heading);
          if (!span) continue;
          const color = landmarkColor(s.material);
          const first = Math.max(0, Math.round(span[0] / mpp));
          const last = Math.min(view.width - 1, Math.max(Math.round(span[0] / mpp), Math.round(span[1] / mpp) - 1));
          const columns: { readonly x: number; readonly top: number }[] = [];
          for (let x = first; x <= last; x++) {
            // The column's middle, kept inside the span so a thin solid still gets its one column.
            const d = Math.min(span[1] - 1e-6, Math.max(span[0] + 1e-6, (x + 0.5) * mpp));
            const height = solidTopAt(s, w.origin.x + dx * d, w.origin.y + dy * d);
            if (height >= 0) columns.push({ x, top: Math.round(heightToY(view, zoom, l.ground + height, base)) });
          }
          const yb = s.bottom === 0 ? foot : Math.round(heightToY(view, zoom, l.ground + s.bottom, base));
          // The faces as seen from here, kept to the columns the flight line cuts.
          ctx.save();
          ctx.beginPath();
          for (const c of columns) if (yb > c.top) ctx.rect(c.x, c.top, 1, yb - c.top);
          ctx.clip();
          // Underneath, so no column is left bare where a face is narrower than a pixel.
          ctx.fillStyle = rgb(color);
          ctx.fillRect(first, 0, last - first + 1, view.height);
          paintSolid(ctx, s, w, yb, Math.round(heightToY(view, zoom, l.ground + s.top, base)), color, null);
          ctx.restore();
          ctx.fillStyle = rgb(color, 0.5);
          for (const c of columns) if (yb > c.top) ctx.fillRect(c.x, c.top, 1, 1);
        }
      }
    },
  };
}
