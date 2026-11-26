import type { BoxKm, Placement } from './place';
import { buildSkeleton, DEFAULT_TERRAIN, type BuildWindow, type Skeleton, type SkeletonInput, type TerrainConfig } from './skeleton';
import type { GridSettings } from './types';

export interface PatchSpec {
  readonly id: string;
  readonly kind: 'airport' | 'city';
  readonly window: BuildWindow;
}

/**
 * Expand a box by a margin and snap it outward to the base grid, whose cell edges are at
 * `originKm + k * baseCellKm`, so patch edges land on base cell edges.
 */
export function snapWindow(b: BoxKm, marginKm: number, baseCellKm: number, originKm: { x: number; y: number } = { x: 0, y: 0 }): BuildWindow {
  const snapDown = (v: number, o: number): number => o + Math.floor((v - o) / baseCellKm + 1e-9) * baseCellKm;
  const snapUp = (v: number, o: number): number => o + Math.ceil((v - o) / baseCellKm - 1e-9) * baseCellKm;
  const l = snapDown(b.cx - b.w / 2 - marginKm, originKm.x);
  const bo = snapDown(b.cy - b.h / 2 - marginKm, originKm.y);
  const r = snapUp(b.cx + b.w / 2 + marginKm, originKm.x);
  const t = snapUp(b.cy + b.h / 2 + marginKm, originKm.y);
  return { left: l, bottom: bo, width: r - l, height: t - bo };
}

/** One patch per airport (its boundary) and per city (its core). */
export function planPatches(pl: Placement, grid: GridSettings): PatchSpec[] {
  const baseKm = grid.baseCellM / 1000;
  const origin = { x: pl.box.cx - pl.box.w / 2, y: pl.box.cy - pl.box.h / 2 };
  const out: PatchSpec[] = [];
  for (const a of pl.airports) out.push({ id: a.airport.id, kind: 'airport', window: snapWindow(a.boundary, grid.patchMarginKm, baseKm, origin) });
  for (const c of pl.cities) out.push({ id: c.city.id, kind: 'city', window: snapWindow(c.core, grid.patchMarginKm, baseKm, origin) });
  return out;
}

export interface Patch extends PatchSpec {
  readonly skeleton: Skeleton;
}

export interface Built {
  readonly base: Skeleton;
  readonly patches: readonly Patch[];
}

/** The coarse base grid for the whole map plus a finer patch for every airport and city core. */
export function buildWithPatches(input: SkeletonInput, grid: GridSettings, cfg: TerrainConfig = DEFAULT_TERRAIN): Built {
  const base = buildSkeleton(input, { ...cfg, cellM: grid.baseCellM });
  const patches = planPatches(input.placement, grid).map((spec) => ({
    ...spec,
    skeleton: buildSkeleton(input, { ...cfg, cellM: grid.patchCellM }, spec.window),
  }));
  return { base, patches };
}
