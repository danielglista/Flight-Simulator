import { TEST_MAP_OFFSET_M as O } from '../src/sim/world/testMap';
import { describe, expect, it } from 'vitest';
import { blendWeight } from '../src/sim/world/airport';
import { groundKindAt } from '../src/sim/world/groundKind';
import { runwayStart } from '../src/sim/world/starts';
import { TEST_MAP_LANDMARKS } from '../src/sim/world/testMap';
import { realWorld } from './helpers';

describe('groundKindAt on the real map', () => {
  const { grid, world, runway } = realWorld();
  const airport = grid.airports[0]!;
  const mid = { x: (runway.a.x + runway.b.x) / 2, y: (runway.a.y + runway.b.y) / 2 };
  it('runway, taxiway and apron are paved', () => {
    expect(groundKindAt(grid, mid.x, mid.y)).toBe('paved');
    // Authoring is in local real meters from the anchor: a taxiway strip centre and the apron centre.
    const k = 2; // the test airport's layout scale
    const anchor = { x: 2560 + O, y: 955 + O };
    expect(groundKindAt(grid, anchor.x + -495 / k, anchor.y + -84 / k)).toBe('paved');
    expect(groundKindAt(grid, anchor.x, anchor.y + 330 / k)).toBe('paved');
  });
  it('other airport surface is grass', () => {
    expect(groundKindAt(grid, airport.minX + airport.blend + 20, airport.minY + airport.blend + 20)).toBe('grass');
  });
  it('the blend band, outside the airport, the lake and the sea are rough', () => {
    const midY = (airport.minY + airport.maxY) / 2;
    expect(blendWeight(airport, airport.minX + 5, midY)).toBeLessThan(1);
    expect(groundKindAt(grid, airport.minX + 5, midY)).toBe('rough');
    expect(groundKindAt(grid, airport.minX - 50, airport.minY - 50)).toBe('rough');
    const lc = TEST_MAP_LANDMARKS.lakeCenter;
    expect(groundKindAt(grid, (lc.col + 0.5) * grid.cellSize, (lc.row + 0.5) * grid.cellSize)).toBe('rough');
    expect(groundKindAt(grid, 1, 1)).toBe('rough');
  });
  it('the world exposes the same answers', () => {
    expect(world.groundKind(mid.x, mid.y)).toBe('paved');
  });
  it('past the end of runway 07 there is grass, then rough ground', () => {
    const ux = (runway.b.x - runway.a.x) / runway.length;
    const uy = (runway.b.y - runway.a.y) / runway.length;
    const at = (d: number) => groundKindAt(grid, runway.b.x + ux * d, runway.b.y + uy * d);
    expect(at(10)).toBe('grass');
    expect(at(300)).toBe('rough');
  });
  it('the runway start stands on paving, on the ground, 40 m past the threshold', () => {
    const s = runwayStart(runway, world.heightAt);
    expect(s.onGround).toBe(true);
    expect(world.groundKind(s.x, s.y)).toBe('paved');
    expect(Math.hypot(s.x - runway.a.x, s.y - runway.a.y)).toBeCloseTo(40, 6);
    expect(s.z).toBe(world.heightAt(s.x, s.y));
    expect(s.speed).toBe(0);
  });
});
