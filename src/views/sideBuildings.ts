import { SIDE_BUILDING_BESIDE_HAZE, SIDE_BUILDING_BESIDE_M, SIDE_BUILDING_FLOOR_M, SIDE_BUILDING_WINDOW_MAX_MPP, type Size } from '../config/display';
import { SIDE_WINDOW_COLOR, type Rgb } from '../config/palette';
import type { ScaleConfig } from '../config/scales';
import type { Sun } from '../config/sun';
import type { Craft } from '../sim/state';
import { groundAt, type WorldGrid } from '../sim/world/grid';
import type { MapBuilding } from '../sim/world/mapFile';
import { roofColor } from './cityLayer';
import { heightToY, sliceWindow, verticalMetersPerPixel, type SliceWindow } from './sideCamera';
import { faceLight } from './sunLight';

type Footprint = Pick<MapBuilding, 'x' | 'y' | 'width' | 'depth' | 'angle'>;

/**
 * Where a line from (ox, oy) along `heading` (radians clockwise from north) goes through a footprint: distances
 * along the line where it enters and leaves, or null when it misses. This is what a plane on that line would hit.
 */
export function lineSpan(b: Footprint, ox: number, oy: number, heading: number): readonly [number, number] | null {
  const a = (b.angle * Math.PI) / 180;
  const dx = Math.sin(heading);
  const dy = Math.cos(heading);
  let enter = -Infinity;
  let leave = Infinity;
  // The two pairs of walls: across the building's width axis, then its depth axis.
  for (const [ux, uy, half] of [
    [Math.sin(a), Math.cos(a), b.width / 2],
    [Math.cos(a), -Math.sin(a), b.depth / 2],
  ] as const) {
    const at = (ox - b.x) * ux + (oy - b.y) * uy;
    const rate = dx * ux + dy * uy;
    if (Math.abs(rate) < 1e-9) {
      if (Math.abs(at) > half) return null;
      continue;
    }
    const t0 = (-half - at) / rate;
    const t1 = (half - at) / rate;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
  }
  return enter < leave ? [enter, leave] : null;
}

/** A building seen from a line: its extent along it, and how far its middle is to the LEFT of it (behind, on screen). */
export function besideLine(b: Footprint, ox: number, oy: number, heading: number): { readonly from: number; readonly to: number; readonly left: number } {
  const dx = Math.sin(heading);
  const dy = Math.cos(heading);
  const a = (b.angle * Math.PI) / 180;
  const along = (b.x - ox) * dx + (b.y - oy) * dy;
  const left = -(b.x - ox) * dy + (b.y - oy) * dx;
  const cos = Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
  const sin = Math.abs(dx * Math.cos(a) - dy * Math.sin(a));
  const half = (cos * b.width + sin * b.depth) / 2;
  return { from: along - half, to: along + half, left };
}

/** One wall of a building as seen from a line: which one, its extent along the line, and how brightly the sun lights it. */
export interface Wall {
  /** 0..3, quarter turns clockwise from the wall facing the building's angle. */
  readonly face: number;
  readonly from: number;
  readonly to: number;
  readonly light: number;
}

/**
 * The walls turned toward the viewer, who looks to the left of the heading, left to right on screen: one when square
 * on, otherwise two meeting at the near corner. Together they cover the extent `besideLine` gives.
 */
export function wallsSeen(b: Footprint, ox: number, oy: number, heading: number, sun: Sun): Wall[] {
  const dx = Math.sin(heading);
  const dy = Math.cos(heading);
  const seen: { readonly face: number; readonly nx: number; readonly ny: number; readonly back: number; readonly length: number }[] = [];
  for (let face = 0; face < 4; face++) {
    const bearing = ((b.angle + face * 90) * Math.PI) / 180;
    const nx = Math.sin(bearing);
    const ny = Math.cos(bearing);
    // Toward the viewer is to the right of the heading.
    if (nx * dy - ny * dx <= 1e-6) continue;
    // How much of the line the wall takes up: its own length, foreshortened.
    const length = (face % 2 === 0 ? b.depth : b.width) * Math.abs(nx * dy - ny * dx);
    seen.push({ face, nx, ny, back: nx * dx + ny * dy, length });
  }
  // A wall facing back down the line is on the left.
  seen.sort((p, q) => p.back - q.back);
  let from = (b.x - ox) * dx + (b.y - oy) * dy - seen.reduce((sum, w) => sum + w.length, 0) / 2;
  return seen.map((w) => {
    const wall = { face: w.face, from, to: from + w.length, light: faceLight(sun, w.nx, w.ny) };
    from = wall.to;
    return wall;
  });
}

/** One screen run of a skyline: columns [x, x + width) from row `top` down to row `foot`. */
export interface Block {
  readonly x: number;
  readonly width: number;
  readonly top: number;
  readonly foot: number;
  readonly color: string;
}

/**
 * The outline of overlapping blocks: per screen column the one reaching highest, with neighboring columns that came out
 * the same joined. However many buildings there are, there are never more runs than columns.
 */
export function skylineRuns(blocks: Iterable<Block>, columns: number): Block[] {
  const top = new Float64Array(columns).fill(Infinity);
  const foot = new Float64Array(columns);
  const color = new Array<string>(columns).fill('');
  for (const b of blocks) {
    for (let x = Math.max(0, b.x); x < Math.min(columns, b.x + b.width); x++) {
      if (b.top >= (top[x] as number)) continue;
      top[x] = b.top;
      foot[x] = b.foot;
      color[x] = b.color;
    }
  }
  const out: Block[] = [];
  for (let x = 0; x < columns; ) {
    if (top[x] === Infinity) {
      x++;
      continue;
    }
    let end = x + 1;
    while (end < columns && top[end] === top[x] && foot[end] === foot[x] && color[end] === color[x]) end++;
    out.push({ x, width: end - x, top: top[x] as number, foot: foot[x] as number, color: color[x] as string });
    x = end;
  }
  return out;
}

export interface SideBuildings {
  /** A parallax layer's skyline: buildings whose middles lie in its band, hazed. Draw over that layer's terrain. */
  drawSkyline(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number, layer: { readonly nearM: number; readonly farM: number; readonly haze: number; readonly k: number }, haze: Rgb, sun: Sun): void;
  /** Buildings just off the flight line, dimmed. Draw BEFORE the main terrain, which hides their feet. */
  drawBeside(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number, haze: Rgb, sun: Sun): void;
  /** Buildings the flight line goes through, solid: what is drawn here can be hit. Draw over the main terrain. */
  drawCrossed(ctx: CanvasRenderingContext2D, view: Size, craft: Craft, zoom: number, base: number, sun: Sun): void;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c: Rgb, k = 1): string => `rgb(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))})`;

interface Shown {
  readonly b: MapBuilding;
  readonly from: number;
  readonly to: number;
}

export function createSideBuildings(grid: WorldGrid, scale: ScaleConfig): SideBuildings {
  const buildings = grid.buildings ?? [];
  const grounds = new Map<MapBuilding, number>();
  const groundOf = (b: MapBuilding): number => {
    let g = grounds.get(b);
    if (g === undefined) {
      g = groundAt(grid, scale, b.x, b.y);
      grounds.set(b, g);
    }
    return g;
  };

  /** Buildings with middles between `lo` and `hi` left of the line that fall inside the window. */
  function inBand(w: SliceWindow, lo: number, hi: number): Shown[] {
    const out: Shown[] = [];
    const dx = Math.sin(w.heading);
    const dy = Math.cos(w.heading);
    for (const b of buildings) {
      // Cheap rejection first: this runs over every building each frame.
      const left = -(b.x - w.origin.x) * dy + (b.y - w.origin.y) * dx;
      if (left < lo || left > hi) continue;
      const along = (b.x - w.origin.x) * dx + (b.y - w.origin.y) * dy;
      if (along < -100 || along > w.length + 100) continue;
      const s = besideLine(b, w.origin.x, w.origin.y, w.heading);
      out.push({ b, from: s.from, to: s.to });
    }
    return out;
  }

  /** Screen columns and rows of one building drawn from `from` to `to` meters along a window. */
  function place(view: Size, zoom: number, base: number, w: SliceWindow, s: Shown): { x: number; width: number; top: number; foot: number } | null {
    const mpp = w.length / Math.max(1, w.samples - 1);
    const x = Math.round(s.from / mpp);
    const right = Math.round(s.to / mpp);
    if (right < 0 || x >= view.width) return null;
    const ground = groundOf(s.b);
    const top = Math.round(heightToY(view, zoom, ground + s.b.height, base));
    if (top >= view.height) return null;
    return { x, width: Math.max(1, right - x), top, foot: Math.round(heightToY(view, zoom, ground, base)) };
  }

  // Wall colors, lit and mixed toward the haze, worked out once per building, wall and haze amount for each sun: this
  // runs for thousands a frame.
  const mixed = new Map<number, Map<MapBuilding, string[]>>();
  let mixedFor: Sun | null = null;
  function hazed(b: MapBuilding, wall: Wall, haze: Rgb, amount: number, sun: Sun): string {
    if (sun !== mixedFor) {
      mixed.clear();
      mixedFor = sun;
    }
    let at = mixed.get(amount);
    if (!at) {
      at = new Map();
      mixed.set(amount, at);
    }
    let faces = at.get(b);
    if (!faces) {
      faces = [];
      at.set(b, faces);
    }
    let out = faces[wall.face];
    if (!out) {
      const c = roofColor(b);
      out = rgb(mix([c[0] * wall.light, c[1] * wall.light, c[2] * wall.light], haze, amount));
      faces[wall.face] = out;
    }
    return out;
  }

  /** A building's block cut into its walls. Too narrow to show two, it takes the wider wall's color. */
  function walls(view: Size, zoom: number, base: number, w: SliceWindow, s: Shown, haze: Rgb, amount: number, sun: Sun): Block[] {
    const p = place(view, zoom, base, w, s);
    if (!p) return [];
    const seen = wallsSeen(s.b, w.origin.x, w.origin.y, w.heading, sun);
    const widest = seen.reduce((best, wall) => (wall.to - wall.from > best.to - best.from ? wall : best), seen[0] as Wall);
    if (seen.length < 2 || p.width < 3) return [{ ...p, color: hazed(s.b, widest, haze, amount, sun) }];
    const mpp = w.length / Math.max(1, w.samples - 1);
    const corner = Math.min(p.x + p.width, Math.max(p.x, Math.round((seen[0] as Wall).to / mpp)));
    return [
      { ...p, width: corner - p.x, color: hazed(s.b, seen[0] as Wall, haze, amount, sun) },
      { ...p, x: corner, width: p.x + p.width - corner, color: hazed(s.b, seen[1] as Wall, haze, amount, sun) },
    ];
  }

  function fill(ctx: CanvasRenderingContext2D, blocks: readonly Block[]): void {
    for (const r of blocks) {
      if (r.foot <= r.top) continue;
      ctx.fillStyle = r.color;
      ctx.fillRect(r.x, r.top, r.width, r.foot - r.top);
    }
  }

  return {
    drawSkyline(ctx, view, craft, zoom, base, layer, haze, sun) {
      const w = sliceWindow(craft, view, zoom, layer.k);
      const blocks: Block[] = [];
      for (const s of inBand(w, layer.nearM, layer.farM)) blocks.push(...walls(view, zoom, base, w, s, haze, layer.haze, sun));
      fill(ctx, skylineRuns(blocks, view.width));
    },
    drawBeside(ctx, view, craft, zoom, base, haze, sun) {
      const w = sliceWindow(craft, view, zoom);
      const blocks: Block[] = [];
      for (const s of inBand(w, -SIDE_BUILDING_BESIDE_M, SIDE_BUILDING_BESIDE_M)) {
        if (lineSpan(s.b, w.origin.x, w.origin.y, w.heading)) continue; // solid, drawn later
        // Down to the bottom of the panel; the main terrain covers what is below ground.
        for (const wall of walls(view, zoom, base, w, s, haze, SIDE_BUILDING_BESIDE_HAZE, sun)) blocks.push({ ...wall, foot: view.height });
      }
      fill(ctx, skylineRuns(blocks, view.width));
    },
    drawCrossed(ctx, view, craft, zoom, base, sun) {
      const w = sliceWindow(craft, view, zoom);
      const floorPx = SIDE_BUILDING_FLOOR_M / verticalMetersPerPixel(zoom);
      const windows = verticalMetersPerPixel(zoom) <= SIDE_BUILDING_WINDOW_MAX_MPP;
      for (const near of inBand(w, -SIDE_BUILDING_BESIDE_M, SIDE_BUILDING_BESIDE_M)) {
        const span = lineSpan(near.b, w.origin.x, w.origin.y, w.heading);
        if (!span) continue;
        const p = place(view, zoom, base, w, { ...near, from: span[0], to: span[1] });
        if (!p || p.foot <= p.top) continue;
        const color = roofColor(near.b);
        const height = p.foot - p.top;
        // The walls seen from here, kept to the columns the flight line cuts.
        const mpp = w.length / Math.max(1, w.samples - 1);
        const seen = wallsSeen(near.b, w.origin.x, w.origin.y, w.heading, sun);
        let x = p.x;
        seen.forEach((wall, n) => {
          const end = n === seen.length - 1 ? p.x + p.width : Math.min(p.x + p.width, Math.max(x, Math.round(wall.to / mpp)));
          ctx.fillStyle = rgb(color, wall.light);
          ctx.fillRect(x, p.top, end - x, height);
          x = end;
        });
        // A dark edge and roof line, so neighbors stay apart.
        ctx.fillStyle = rgb(color, 0.72);
        ctx.fillRect(p.x + p.width - 1, p.top, 1, height);
        ctx.fillStyle = rgb(color, 0.45);
        ctx.fillRect(p.x, p.top, p.width, 1);
        if (!windows || p.width < 4) continue;
        ctx.fillStyle = SIDE_WINDOW_COLOR;
        for (let y = p.top + 3; y < p.foot - 2; y += floorPx) {
          for (let x = p.x + 2; x < p.x + p.width - 2; x += 4) ctx.fillRect(x, Math.round(y), 2, 2);
        }
      }
    },
  };
}
