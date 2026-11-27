import type { Placement } from './place';
import { Raster, type Rgb } from './raster';

/** One pixel is 10 world m. */
export const PX_PER_KM = 100;

export const COLORS = {
  background: [250, 250, 245],
  worldGrid: [222, 222, 222],
  realGrid: [110, 150, 215],
  box: [0, 0, 0],
  core: [215, 40, 40],
  ring: [235, 150, 30],
  airport: [30, 150, 70],
  ground: [90, 60, 30],
  corridor: [150, 60, 190],
  unwarped: [150, 150, 150],
  warped: [235, 150, 30],
  final: [0, 0, 0],
} as const satisfies Record<string, Rgb>;

export const COLOR_KEY: readonly (readonly [string, string])[] = [
  ['light gray lines', 'world grid, 1 km'],
  ['blue lines', 'real grid, every 10 real km, after warping'],
  ['black rectangle', 'map box'],
  ['red box', 'city core'],
  ['orange circles', 'warp radii: 8 km, 80 km and 90 km real (ring edge is the outer one)'],
  ['green outline', 'airport outline: bends the land and is kept clear'],
  ['brown outlines', 'airport ground'],
  ['purple box', 'approach corridor'],
  ['gray cross', 'airport real position with no warping'],
  ['orange cross', 'airport after warping, before the push'],
  ['black cross', 'airport final position'],
];

/** Draw a placement as an image, one pixel per 10 world meters. */
export function renderPreview(pl: Placement): Raster {
  const { box, warp } = pl;
  const width = Math.round(box.w * PX_PER_KM);
  const height = Math.round(box.h * PX_PER_KM);
  const r = new Raster(width, height, COLORS.background);
  const left = box.cx - box.w / 2;
  const top = box.cy + box.h / 2;
  const px = (x: number): number => (x - left) * PX_PER_KM;
  const py = (y: number): number => (top - y) * PX_PER_KM;

  // 1 world km grid
  for (let x = Math.ceil(left); x <= left + box.w; x++) r.line(px(x), 0, px(x), height - 1, COLORS.worldGrid);
  for (let y = Math.ceil(top - box.h); y <= top; y++) r.line(0, py(y), width - 1, py(y), COLORS.worldGrid);

  // Real 10 km grid, passed through the warp. The real range is padded because warping pulls land in.
  const sg = 1 / warp.geoDistance;
  const pad = 150;
  const x0 = Math.floor(((left / sg) - pad) / 10) * 10;
  const x1 = Math.ceil(((left + box.w) / sg + pad) / 10) * 10;
  const y0 = Math.floor(((top - box.h) / sg - pad) / 10) * 10;
  const y1 = Math.ceil((top / sg + pad) / 10) * 10;
  const sample = 0.5;
  for (let gx = x0; gx <= x1; gx += 10) {
    const pts: [number, number][] = [];
    for (let gy = y0; gy <= y1; gy += sample) {
      const w = warp.toWorld(gx, gy);
      pts.push([px(w.x), py(w.y)]);
    }
    r.polyline(pts, COLORS.realGrid);
  }
  for (let gy = y0; gy <= y1; gy += 10) {
    const pts: [number, number][] = [];
    for (let gx = x0; gx <= x1; gx += sample) {
      const w = warp.toWorld(gx, gy);
      pts.push([px(w.x), py(w.y)]);
    }
    r.polyline(pts, COLORS.realGrid);
  }

  // Warp radii
  const prof = warp.profile;
  for (const c of pl.cities) {
    for (const rad of [prof.shape.rampKm, prof.shape.plateauEndKm, prof.shape.ringKm]) {
      r.circle(px(c.world.x), py(c.world.y), prof.f(rad) * PX_PER_KM, COLORS.ring);
    }
    r.box(px(c.core.cx), py(c.core.cy), c.core.w * PX_PER_KM, c.core.h * PX_PER_KM, COLORS.core, 2);
  }

  for (const a of pl.airports) {
    r.polyline(a.corridor.map((p) => [px(p.x), py(p.y)] as const), COLORS.corridor, true);
    r.polyline(a.outline.map((p) => [px(p.x), py(p.y)] as const), COLORS.airport, true, 2);
    for (const g of a.ground) r.polyline(g.map((p) => [px(p.x), py(p.y)] as const), COLORS.ground, true);
    r.cross(px(a.real.x * sg), py(a.real.y * sg), 8, COLORS.unwarped);
    r.cross(px(a.warped.x), py(a.warped.y), 8, COLORS.warped);
    r.cross(px(a.world.x), py(a.world.y), 8, COLORS.final, 2);
  }

  r.box(width / 2, height / 2, width - 2, height - 2, COLORS.box, 2);
  return r;
}
