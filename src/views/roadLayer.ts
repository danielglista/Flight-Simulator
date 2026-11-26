import { ROAD_BRIDGE_MAX_MPP, ROAD_DASH_M, ROAD_LINES_MAX_MPP, ROAD_MARKINGS_MAX_MPP, ROAD_MINOR_MAX_MPP, ROAD_MIN_PX, ROAD_REACH_M, ROAD_TILE_M, ROAD_WIDTH_M, ROAD_YELLOW_MAX_MPP } from '../config/map';
import {
  ROAD_ASPHALT_COLOR,
  ROAD_BRIDGE_DECK_COLOR,
  ROAD_BRIDGE_RAIL_COLOR,
  ROAD_BRIDGE_SHADOW_COLOR,
  ROAD_CENTER_LINE_COLOR,
  ROAD_EDGE_LINE_COLOR,
  ROAD_MEDIAN_COLOR,
} from '../config/palette';
import type { MapRoad } from '../sim/world/mapFile';
import type { MapFrame } from './airportLayer';

type Kind = MapRoad['kind'];

/** Minor roads are left out when zoomed far out; major ones always show. */
export function roadShown(kind: Kind, mpp: number): boolean {
  return kind === 'major' || mpp <= ROAD_MINOR_MAX_MPP;
}

/** Stroke width in world meters: true to the class when zoomed in, never thinner than a few pixels' worth. */
export function roadWidthM(kind: Kind, mpp: number): number {
  return Math.max(ROAD_WIDTH_M[kind], ROAD_MIN_PX[kind] * mpp);
}

/** One stroke along a road's centerline. */
export interface RoadStroke {
  readonly color: string;
  /** World m. */
  readonly width: number;
  readonly dash?: readonly number[];
  /** Offset on the ground, world m east and south (a bridge's shadow). */
  readonly shift?: number;
}

/**
 * The strokes that make up a road, bottom first, all centered on its line: each narrower one paints over the middle of
 * the one below, leaving lines along both sides. Major roads are divided highways (yellow lines beside a grass
 * median, a dashed lane line each way, white edges); minor ones have one lane each way and a double yellow line.
 * Detail drops away as the zoom gets coarser.
 */
export function roadStrokes(kind: Kind, mpp: number): RoadStroke[] {
  const width = roadWidthM(kind, mpp);
  const asphalt = (w: number): RoadStroke => ({ color: ROAD_ASPHALT_COLOR, width: w });
  const out = [asphalt(width)];
  if (mpp > ROAD_LINES_MAX_MPP) return out;

  const full = mpp <= ROAD_MARKINGS_MAX_MPP;
  const line = Math.max(0.5, mpp * 0.8); // a painted line, never much under a pixel
  const edge = width - (full ? 2 : 1); // shoulder outside the white line
  out.push({ color: ROAD_EDGE_LINE_COLOR, width: edge }, asphalt(edge - 2 * line));
  if (!full) return out;
  if (kind === 'major') {
    const lanes = width / 2; // the two dashed lines are this far apart
    out.push({ color: ROAD_EDGE_LINE_COLOR, width: lanes + line, dash: ROAD_DASH_M }, asphalt(lanes - line));
  }
  const median = kind === 'major' ? 2.4 : Math.max(0.4, line);
  const yellow = mpp <= ROAD_YELLOW_MAX_MPP;
  if (yellow) out.push({ color: ROAD_CENTER_LINE_COLOR, width: median + 2 * line });
  if (kind === 'major') out.push({ color: ROAD_MEDIAN_COLOR, width: median });
  else if (yellow) out.push(asphalt(median));
  return out;
}

/** What goes under a bridge's road: its shadow on the water, pier caps, rails and deck. */
export function bridgeStrokes(kind: Kind, mpp: number): RoadStroke[] {
  if (mpp > ROAD_BRIDGE_MAX_MPP) return [];
  const width = roadWidthM(kind, mpp);
  const rail = Math.max(0.8, mpp);
  const deck = width + 2 * Math.max(1.5, mpp);
  return [
    { color: ROAD_BRIDGE_SHADOW_COLOR, width: deck, shift: 5 },
    { color: ROAD_BRIDGE_DECK_COLOR, width: deck + 7, dash: [4, 28] },
    { color: ROAD_BRIDGE_RAIL_COLOR, width: deck + 2 * rail },
    { color: ROAD_BRIDGE_DECK_COLOR, width: deck },
  ];
}

/** Roads cut into square tiles: each segment goes to the tile holding its middle, in runs that stay joined. */
export function tileRoads(roads: readonly MapRoad[], size: number): Map<string, MapRoad[]> {
  const tiles = new Map<string, MapRoad[]>();
  for (const r of roads) {
    let key = '';
    let run: number[] = [];
    for (let i = 0; i + 3 < r.points.length; i += 2) {
      const [x0, y0, x1, y1] = r.points.slice(i, i + 4) as [number, number, number, number];
      const k = `${Math.floor((x0 + x1) / 2 / size)},${Math.floor((y0 + y1) / 2 / size)}`;
      if (k !== key) {
        key = k;
        run = [x0, y0];
        const list = tiles.get(k) ?? [];
        list.push({ kind: r.kind, bridge: r.bridge, points: run });
        tiles.set(k, list);
      }
      run.push(x1, y1);
    }
  }
  return tiles;
}

/** A world rectangle, meters. */
export interface Area {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

export interface TileRange {
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
}

/** The tiles whose roads can show in `area`: segments are short, so reaching `reach` past it is enough. */
export function tilesFor(area: Area, size: number, reach: number): TileRange {
  return {
    i0: Math.floor((area.left - reach) / size),
    i1: Math.floor((area.right + reach) / size),
    j0: Math.floor((area.bottom - reach) / size),
    j1: Math.floor((area.top + reach) / size),
  };
}

/** The world area on the canvas, given a context already set to draw in world meters (rotation included). */
function viewArea(ctx: CanvasRenderingContext2D): Area {
  const m = ctx.getTransform().inverse();
  const { width, height } = ctx.canvas;
  const corners = [m.transformPoint({ x: 0, y: 0 }), m.transformPoint({ x: width, y: 0 }), m.transformPoint({ x: 0, y: height }), m.transformPoint({ x: width, y: height })];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}

export interface RoadLayer {
  /** Draws the highways in view, in the frame the terrain was drawn in (north up; the caller has rotated). */
  draw(ctx: CanvasRenderingContext2D, f: MapFrame): void;
}

export function createRoadLayer(roads: readonly MapRoad[]): RoadLayer {
  const tiles = tileRoads(roads, ROAD_TILE_M);
  // One path per class, over land and over water, in world meters, for the tiles in view; rebuilt when those change.
  const paths = new Map<string, Path2D>();
  let shownRange = '';

  function show(r: TileRange): void {
    const key = `${r.i0},${r.i1},${r.j0},${r.j1}`;
    if (key === shownRange) return;
    shownRange = key;
    paths.clear();
    for (let i = r.i0; i <= r.i1; i++) {
      for (let j = r.j0; j <= r.j1; j++) {
        for (const road of tiles.get(`${i},${j}`) ?? []) {
          const p = path(road.kind, road.bridge);
          p.moveTo(road.points[0] as number, road.points[1] as number);
          for (let k = 2; k < road.points.length; k += 2) p.lineTo(road.points[k] as number, road.points[k + 1] as number);
        }
      }
    }
  }

  function path(kind: Kind, bridge: boolean): Path2D {
    const key = `${kind},${bridge}`;
    let p = paths.get(key);
    if (!p) {
      p = new Path2D();
      paths.set(key, p);
    }
    return p;
  }

  function stroke(ctx: CanvasRenderingContext2D, s: RoadStroke, p: Path2D, cap: CanvasLineCap): void {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = s.dash ? 'butt' : cap;
    ctx.setLineDash(s.dash ? [...s.dash] : []);
    // World y points north, so south is negative.
    if (s.shift) ctx.translate(s.shift, -s.shift);
    ctx.stroke(p);
    if (s.shift) ctx.translate(-s.shift, s.shift);
  }

  /**
   * All roads of one level (ground, or bridges) together. Each step of the markings is done for every road before the
   * next, so roads that meet merge instead of painting their borders across each other.
   */
  function drawLevel(ctx: CanvasRenderingContext2D, mpp: number, bridge: boolean): void {
    const kinds = (['minor', 'major'] as const).filter((k) => roadShown(k, mpp));
    for (const kind of kinds) {
      if (bridge) for (const s of bridgeStrokes(kind, mpp)) stroke(ctx, s, path(kind, true), 'butt');
    }
    for (const kind of kinds) {
      for (const s of roadStrokes(kind, mpp)) stroke(ctx, s, path(kind, bridge), bridge ? 'butt' : 'round');
    }
  }

  return {
    draw(ctx, f) {
      if (roads.length === 0) return;
      ctx.save();
      ctx.translate(f.ox, f.oy + f.mapHeight / f.mpp);
      ctx.scale(1 / f.mpp, -1 / f.mpp);
      // Round joints cost more to draw and cannot be seen once zoomed out.
      ctx.lineJoin = f.mpp <= ROAD_LINES_MAX_MPP ? 'round' : 'bevel';
      show(tilesFor(viewArea(ctx), ROAD_TILE_M, ROAD_REACH_M));
      drawLevel(ctx, f.mpp, false);
      drawLevel(ctx, f.mpp, true);
      ctx.restore();
    },
  };
}
