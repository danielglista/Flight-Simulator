import { describe, expect, it } from 'vitest';
import { ROAD_WIDTH_M } from '../src/config/map';
import { ROAD_ASPHALT_COLOR, ROAD_CENTER_LINE_COLOR, ROAD_MEDIAN_COLOR } from '../src/config/palette';
import { bridgeStrokes, roadShown, roadStrokes, roadWidthM, tileRoads, tilesFor } from '../src/views/roadLayer';

describe('road drawing', () => {
  it('cuts roads into tiles without losing a segment, and picks the tiles around a view', () => {
    const points = [10, 10, 90, 10, 130, 10, 190, 10, 60, 10];
    const tiles = tileRoads([{ kind: 'major', bridge: false, points }], 100);
    const segments = [...tiles.values()].flat().reduce((n, r) => n + r.points.length / 2 - 1, 0);
    expect(segments).toBe(4);
    expect(tiles.get('0,0')![0]!.points).toEqual([10, 10, 90, 10]);
    expect(tiles.get('1,0')![0]!.points[0]).toBe(90); // the next run starts where the last ended
    expect(tilesFor({ left: 150, bottom: 0, right: 250, top: 80 }, 100, 40)).toEqual({ i0: 1, i1: 2, j0: -1, j1: 1 });
  });
  it('drops minor roads when zoomed far out', () => {
    expect(roadShown('minor', 10)).toBe(true);
    expect(roadShown('minor', 20)).toBe(false);
    expect(roadShown('major', 40)).toBe(true);
  });
  it('is true to width close up and stays visible far out', () => {
    expect(roadWidthM('major', 0.5)).toBe(ROAD_WIDTH_M.major);
    expect(roadWidthM('major', 40)).toBeGreaterThanOrEqual(40);
  });
  it('is a marked, divided highway close up and plain asphalt far out', () => {
    const close = roadStrokes('major', 0.5);
    expect(close[0]!.color).toBe(ROAD_ASPHALT_COLOR);
    expect(close.some((s) => s.dash)).toBe(true);
    expect(close.some((s) => s.color === ROAD_CENTER_LINE_COLOR)).toBe(true);
    expect(close.at(-1)!.color).toBe(ROAD_MEDIAN_COLOR);
    expect(roadStrokes('minor', 0.5).some((s) => s.dash)).toBe(false);
    expect(roadStrokes('major', 2.5).some((s) => s.dash)).toBe(false);
    for (const mpp of [1.25, 2.5]) expect(roadStrokes('major', mpp).some((s) => s.color === ROAD_CENTER_LINE_COLOR)).toBe(false);
    expect(roadStrokes('major', 5)).toEqual([{ color: ROAD_ASPHALT_COLOR, width: 16 }]);
  });
  it('never draws a stroke with no width, and narrows each one inward', () => {
    for (const mpp of [0.5, 0.8, 1.25, 2, 2.5]) {
      for (const kind of ['major', 'minor'] as const) {
        for (const s of roadStrokes(kind, mpp)) {
          expect(s.width).toBeGreaterThan(0);
          expect(s.width).toBeLessThanOrEqual(roadWidthM(kind, mpp));
        }
      }
    }
  });
  it('gives a bridge a deck wider than its road, until zoomed far out', () => {
    expect(bridgeStrokes('major', 1.25).at(-1)!.width).toBeGreaterThan(roadWidthM('major', 1.25));
    expect(bridgeStrokes('major', 20)).toEqual([]);
  });
});
