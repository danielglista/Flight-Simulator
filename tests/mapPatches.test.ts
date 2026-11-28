import { describe, expect, it } from 'vitest';
import placesJson from '../data/map/places.json';
import scalesJson from '../data/map/scales.json';
import { buildWithPatches, planPatches, snapWindow } from '../tools/map/patches';
import { placeAll } from '../tools/map/place';
import type { PolygonGeo } from '../tools/map/skeleton';
import { MapDataError, validatePlaces, validateScales } from '../tools/map/validate';

const sf = validateScales(scalesJson);
const places = validatePlaces(placesJson);
const placement = placeAll(sf.scales, sf.box, sf.warp, places);

describe('grid settings', () => {
  it('default to a 20 m base with 10 m patches', () => {
    expect(sf.grid.baseCellM).toBe(20);
    expect(sf.grid.patchCellM).toBe(10);
  });
  it('allow 5 m patches and reject sizes that do not divide', () => {
    expect(validateScales({ ...scalesJson, grid: { baseCellM: 20, patchCellM: 5, patchMarginKm: 0.3 } }).grid.patchCellM).toBe(5);
    expect(() => validateScales({ ...scalesJson, grid: { baseCellM: 20, patchCellM: 8, patchMarginKm: 0.3 } })).toThrow(MapDataError);
    expect(() => validateScales({ ...scalesJson, grid: { baseCellM: 10, patchCellM: 20, patchMarginKm: 0.3 } })).toThrow(/larger/);
  });
});

describe('patch windows', () => {
  it('snap outward to base cell edges and cover the box plus margin', () => {
    const w = snapWindow({ cx: 1.234, cy: 2.345, w: 1, h: 1 }, 0.3, 0.02);
    expect(w.left / 0.02).toBeCloseTo(Math.round(w.left / 0.02), 6);
    expect(w.left).toBeLessThanOrEqual(1.234 - 0.5 - 0.3);
    expect(w.left + w.width).toBeGreaterThanOrEqual(1.234 + 0.5 + 0.3);
    expect(w.bottom + w.height).toBeGreaterThanOrEqual(2.345 + 0.5 + 0.3);
  });
  it('plans one patch per airport and city', () => {
    const specs = planPatches(placement, sf.grid);
    expect(specs.map((s) => `${s.kind}:${s.id}`)).toEqual(['airport:DCA', 'airport:PHL', 'airport:SBY', 'city:dc', 'city:phl-city']);
  });
});

describe('buildWithPatches', { timeout: 60000 }, () => {
  const land: PolygonGeo[] = [{ rings: [[[-80, 37], [-73, 37], [-73, 41], [-80, 41]]] }];
  const input = { placement, box: sf.box, land, lakes: [], rivers: [], elevationAt: () => 30 };

  it('builds a coarse base and finer patches that line up with it', () => {
    const { base, patches } = buildWithPatches(input, sf.grid);
    expect(base.grid.cellSize).toBe(20);
    expect(patches).toHaveLength(5);
    for (const p of patches) {
      expect(p.skeleton.grid.cellSize).toBe(10);
      const baseCells = (p.skeleton.originKm.x - base.originKm.x) / base.cellKm;
      expect(baseCells).toBeCloseTo(Math.round(baseCells), 6);
    }
  });
  it('honors 5 m patches', () => {
    const { patches } = buildWithPatches(input, { ...sf.grid, patchCellM: 5 });
    expect(patches[0]!.skeleton.grid.cellSize).toBe(5);
    const ten = buildWithPatches(input, sf.grid).patches[0]!;
    expect(patches[0]!.skeleton.grid.cols).toBe(ten.skeleton.grid.cols * 2);
  });
  it('levels the airport ground in the base and in the patch', () => {
    const { base, patches } = buildWithPatches(input, sf.grid);
    const f = base.flattened.find((x) => x.id === 'DCA')!;
    const g = patches[0]!.skeleton.flattened[0]!;
    expect(f.elevationM).toBe(5);
    expect(g.elevationM).toBe(5);
    for (const i of g.cells) expect(patches[0]!.skeleton.grid.elevation[i]).toBe(5);
  });
});
