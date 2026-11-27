import { BUILDING_DETAIL_MAX_MPP, BUILDING_MAX_MPP, LANDMARK_OVERHEAD_ALPHA } from '../config/map';
import { BUILDING_SHADOW_COLOR, LANDMARK_COLORS, LANDMARK_FLAG_COLOR, LANDMARK_POLE_COLOR, ROOF_EDGE_COLOR, type Rgb } from '../config/palette';
import type { Sun } from '../config/sun';
import type { LandmarkSolid, MapLandmark } from '../sim/world/mapFile';
import { boxOf, landmarkCircle, solidCorners, solidTopAt, type Box } from '../sim/world/obstacles';
import type { MapFrame } from './airportLayer';
import type { Area } from './roadLayer';
import { hull } from './cityLayer';
import { faceLight, shadowVector, towardSun } from './sunLight';

type P = readonly [number, number];

export const landmarkColor = (material: string): Rgb => LANDMARK_COLORS[material] ?? [255, 0, 255];

/**
 * What a solid shows from straight above: its sloping faces (south, east, north, west before turning), each with how
 * brightly the sun falls on it, and its top. A solid with upright sides has faces of no size.
 */
export function solidFaces(s: LandmarkSolid, sun: Sun): { readonly faces: readonly { readonly points: readonly P[]; readonly light: number }[]; readonly top: readonly P[] } {
  const base = solidCorners(s, s.width, s.depth);
  const top = solidCorners(s, s.topWidth, s.topDepth);
  const turn = ((s.turn ?? 0) * Math.PI) / 180;
  const faces = base.map((_, i) => {
    // The face's compass bearing: south, east, north and west, carried round by the turn.
    const bearing = Math.PI - (i * Math.PI) / 2 + turn;
    const light = faceLight(sun, Math.sin(bearing), Math.cos(bearing));
    return { points: [base[i] as P, base[(i + 1) % 4] as P, top[(i + 1) % 4] as P, top[i] as P], light };
  });
  return { faces, top };
}

/** Points round a circle. */
function circle(x: number, y: number, radius: number, steps = 20): P[] {
  return Array.from({ length: steps }, (_, i): P => {
    const a = (i / steps) * Math.PI * 2;
    return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
  });
}

/** A prism's corners as points. */
export function outline(s: LandmarkSolid): P[] {
  const p = s.points ?? [];
  return Array.from({ length: p.length / 2 }, (_, i): P => [p[i * 2] as number, p[i * 2 + 1] as number]);
}

/**
 * The ground a solid shades: its bottom and top outlines, each pushed away from the sun by its height above `floor` (the
 * level the shadow falls on), as one shape.
 */
export function solidShadow(s: LandmarkSolid, sun: Sun, floor = 0): P[] {
  const cast = (points: readonly P[], height: number): P[] => {
    const [east, north] = shadowVector(sun, height - floor);
    return points.map(([x, y]): P => [x + east, y + north]);
  };
  if (s.shape === 'prism') return hull([...cast(outline(s), s.bottom), ...cast(outline(s), s.top)]);
  if (s.shape === 'dome') {
    const r = s.width / 2;
    const h = s.top - s.bottom;
    return hull([0, 0.5, 0.87, 0.98].flatMap((t) => cast(circle(s.x, s.y, r * Math.sqrt(1 - t * t)), s.bottom + h * t)));
  }
  if (s.shape) return hull([...cast(circle(s.x, s.y, s.width / 2), s.bottom), ...cast(circle(s.x, s.y, s.topWidth / 2), s.top)]);
  return hull([...cast(solidCorners(s, s.width, s.depth), s.bottom), ...cast(solidCorners(s, s.topWidth, s.topDepth), s.top)]);
}

/** Where the flag poles stand. */
export function postPoints(posts: NonNullable<MapLandmark['posts']>): P[] {
  return Array.from({ length: posts.count }, (_, i): P => {
    const a = (i / posts.count) * Math.PI * 2;
    return [posts.x + Math.sin(a) * posts.radius, posts.y + Math.cos(a) * posts.radius];
  });
}

const rgb = (c: Rgb, k = 1): string => `rgb(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))})`;

function trace(ctx: CanvasRenderingContext2D, points: readonly P[]): void {
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function fill(ctx: CanvasRenderingContext2D, points: readonly P[], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  trace(ctx, points);
  ctx.fill();
}

/** A drum or dome from above: a dome brightens toward a point on the sunward side of its crown; a drum is a rim and a flat top. */
function paintRound(ctx: CanvasRenderingContext2D, s: LandmarkSolid, mpp: number, sun: Sun): void {
  const color = landmarkColor(s.material);
  const r = s.width / 2;
  const disc = (x: number, y: number, radius: number, k: number): void => {
    ctx.fillStyle = rgb(color, k);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  if (s.shape === 'dome') {
    const steps = 5;
    const [east, north] = towardSun(sun);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const shift = r * 0.3 * Math.SQRT2 * t;
      disc(s.x + east * shift, s.y + north * shift, r * (1 - t), 1 + sun.strength * (0.78 + 0.34 * t - 1));
    }
  } else {
    disc(s.x, s.y, r, 0.84);
    disc(s.x, s.y, s.topWidth / 2, 1);
    if (s.columns && mpp <= BUILDING_DETAIL_MAX_MPP) {
      const count = Math.max(8, Math.round((Math.PI * s.width) / s.columns));
      for (const [x, y] of circle(s.x, s.y, r - mpp / 2, count)) disc(x, y, mpp * 0.6, 0.6);
    }
  }
  if (mpp > BUILDING_DETAIL_MAX_MPP) return;
  ctx.strokeStyle = ROOF_EDGE_COLOR;
  ctx.lineWidth = mpp * 0.6;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Paved ground and paths, in the order given. */
function paintDecor(ctx: CanvasRenderingContext2D, l: MapLandmark): void {
  for (const d of l.decor) {
    ctx.beginPath();
    if (d.kind === 'rect') {
      ctx.fillStyle = rgb(landmarkColor(d.material));
      trace(ctx, solidCorners(d, d.width, d.depth));
      ctx.fill();
      continue;
    }
    if (d.kind === 'disc') {
      ctx.fillStyle = rgb(landmarkColor(d.material));
      ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.strokeStyle = rgb(landmarkColor(d.material));
    ctx.lineWidth = d.width;
    if (d.kind === 'ring') ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    else for (let i = 0; i + 1 < d.points.length; i += 2) i === 0 ? ctx.moveTo(d.points[0] as number, d.points[1] as number) : ctx.lineTo(d.points[i] as number, d.points[i + 1] as number);
    ctx.stroke();
  }
}

function paintPosts(ctx: CanvasRenderingContext2D, posts: NonNullable<MapLandmark['posts']>, mpp: number, sun: Sun): void {
  const [east, north] = shadowVector(sun, posts.height);
  const points = postPoints(posts);
  ctx.strokeStyle = BUILDING_SHADOW_COLOR;
  ctx.lineWidth = mpp;
  ctx.beginPath();
  for (const [x, y] of points) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + east, y + north);
  }
  ctx.globalAlpha = sun.strength;
  ctx.stroke();
  ctx.globalAlpha = 1;
  const dot = Math.max(mpp, 0.5);
  for (const [x, y] of points) {
    ctx.fillStyle = rgb(LANDMARK_FLAG_COLOR);
    ctx.fillRect(x, y - dot / 2, dot * 2, dot);
    ctx.fillStyle = rgb(LANDMARK_POLE_COLOR);
    ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
  }
}

/** One solid from above. */
function paintSolid(ctx: CanvasRenderingContext2D, s: LandmarkSolid, mpp: number, sun: Sun): void {
  const outlined = (points: readonly P[]): void => {
    if (mpp > BUILDING_DETAIL_MAX_MPP) return;
    ctx.strokeStyle = ROOF_EDGE_COLOR;
    ctx.lineWidth = mpp * 0.6;
    ctx.beginPath();
    trace(ctx, points);
    ctx.stroke();
  };
  if (s.shape === 'prism') {
    const points = outline(s);
    fill(ctx, points, rgb(landmarkColor(s.cap ?? s.material)));
    outlined(points);
    return;
  }
  if (s.shape) {
    paintRound(ctx, s, mpp, sun);
    return;
  }
  const color = landmarkColor(s.material);
  const { faces, top } = solidFaces(s, sun);
  for (const face of faces) fill(ctx, face.points, rgb(color, face.light));
  fill(ctx, top, rgb(landmarkColor(s.cap ?? s.material)));
  outlined(solidCorners(s, s.width, s.depth));
}

function paintWires(ctx: CanvasRenderingContext2D, wires: NonNullable<MapLandmark['wires']>, mpp: number): void {
  ctx.lineWidth = Math.max(mpp, 0.5);
  for (const w of wires) {
    ctx.strokeStyle = rgb(landmarkColor(w.material));
    ctx.beginPath();
    for (let i = 0; i < w.points.length; i += 3) {
      const x = w.points[i] as number;
      const y = w.points[i + 1] as number;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * What of a landmark hangs over a plane `height` world m above the landmark's ground: all its solids above that height,
 * if the plane is under one of them, else nothing.
 */
export function overheadSolids(l: MapLandmark, x: number, y: number, height: number): readonly LandmarkSolid[] {
  if (!l.solids.some((s) => s.bottom > height && solidTopAt(s, x, y) >= 0)) return [];
  return l.solids.filter((s) => s.bottom > height).sort((a, b) => a.top - b.top);
}

/** The world box a screen area shows. */
export function worldBox(f: MapFrame, area: Area): Box {
  return {
    minX: (area.left - f.ox) * f.mpp,
    maxX: (area.right - f.ox) * f.mpp,
    minY: f.mapHeight - (area.bottom - f.oy) * f.mpp,
    maxY: f.mapHeight - (area.top - f.oy) * f.mpp,
  };
}

export const boxesMeet = (a: Box, b: Box): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export interface LandmarkLayer {
  /** Draws the landmarks in the frame the terrain was drawn in (north up; the caller has rotated), those in `area`. */
  draw(ctx: CanvasRenderingContext2D, f: MapFrame, area: Area, sun: Sun): void;
  /** Draws over the plane, faintly enough to keep it in sight, what it is flying under. */
  drawOverhead(ctx: CanvasRenderingContext2D, f: MapFrame, plane: { readonly x: number; readonly y: number; readonly z: number }, sun: Sun): void;
}

/** Landmarks from above (E6). There are few, so they are drawn each frame rather than baked into tiles. */
export function createLandmarkLayer(landmarks: readonly MapLandmark[], groundOf: (x: number, y: number) => number): LandmarkLayer {
  // Everything that does not depend on the camera is worked out once for each sun.
  const prepare = (sun: Sun) => landmarks.map((l) => {
    const solids = [...l.solids].sort((a, b) => a.top - b.top);
    // A hill first, so what stands on it shades its top.
    const hill = solids.filter((s) => s.base);
    const standing = solids.filter((s) => !s.base);
    const floor = Math.max(0, ...hill.map((s) => s.top));
    const hillShadows = hill.map((s) => solidShadow(s, sun));
    const standingShadows = standing.map((s) => solidShadow(s, sun, s.bottom >= floor ? floor : 0));
    // What it covers on the map, shadows included.
    const { x, y, radius } = landmarkCircle(l);
    const box = boxOf([x - radius, y - radius, x + radius, y + radius, ...[...hillShadows, ...standingShadows].flat(2)]);
    return { l, hill, standing, hillShadows, standingShadows, box };
  });
  let made: { readonly sun: Sun; readonly list: ReturnType<typeof prepare> } | null = null;
  const preparedFor = (sun: Sun): ReturnType<typeof prepare> => {
    if (made?.sun !== sun) made = { sun, list: prepare(sun) };
    return made.list;
  };
  const grounds = landmarks.map((l) => groundOf(l.x, l.y));
  /** From here on, world meters with y north. */
  const toWorld = (ctx: CanvasRenderingContext2D, f: MapFrame): void => {
    ctx.translate(f.ox, f.oy + f.mapHeight / f.mpp);
    ctx.scale(1 / f.mpp, -1 / f.mpp);
  };
  return {
    draw(ctx, f, area, sun) {
      const seen = worldBox(f, area);
      ctx.save();
      toWorld(ctx, f);
      for (const { l, hill, standing, hillShadows, standingShadows, box } of preparedFor(sun)) {
        if (!boxesMeet(box, seen)) continue;
        if (f.mpp <= BUILDING_MAX_MPP) paintDecor(ctx, l);
        // Shadows as one shape, so they do not darken where they overlap. The long shadow shows at every zoom.
        const shade = (shadows: readonly (readonly P[])[]): void => {
          ctx.fillStyle = BUILDING_SHADOW_COLOR;
          ctx.beginPath();
          for (const points of shadows) trace(ctx, points);
          ctx.globalAlpha = sun.strength;
          ctx.fill();
          ctx.globalAlpha = 1;
        };
        shade(hillShadows);
        for (const s of hill) paintSolid(ctx, s, f.mpp, sun);
        shade(standingShadows);
        if (l.posts && f.mpp <= BUILDING_DETAIL_MAX_MPP) paintPosts(ctx, l.posts, f.mpp, sun);
        for (const s of standing) paintSolid(ctx, s, f.mpp, sun);
        if (l.wires && f.mpp <= BUILDING_MAX_MPP) paintWires(ctx, l.wires, f.mpp);
      }
      ctx.restore();
    },
    drawOverhead(ctx, f, plane, sun) {
      ctx.save();
      toWorld(ctx, f);
      ctx.globalAlpha = LANDMARK_OVERHEAD_ALPHA;
      preparedFor(sun).forEach(({ l, box }, n) => {
        if (!boxesMeet(box, { minX: plane.x, maxX: plane.x, minY: plane.y, maxY: plane.y })) return;
        for (const s of overheadSolids(l, plane.x, plane.y, plane.z - (grounds[n] as number))) paintSolid(ctx, s, f.mpp, sun);
      });
      ctx.restore();
    },
  };
}
