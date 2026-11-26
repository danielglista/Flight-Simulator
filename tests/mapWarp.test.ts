import { describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE, makeProfile, makeWarp, WarpError } from '../tools/map/warp';

describe('city profile', () => {
  const p = makeProfile(25, 4);

  it('has the core slope inside the core', () => {
    expect(p.slope(0)).toBeCloseTo(1 / 4, 12);
    expect(p.slope(2)).toBeCloseTo(1 / 4, 12);
    expect(p.f(4)).toBeCloseTo(1, 12);
  });
  it('solves a plateau near 1:42 at 1:25 and 1:29 at 1:20', () => {
    expect(Math.abs(1 / p.plateau - 42)).toBeLessThan(1);
    expect(Math.abs(1 / makeProfile(20, 4).plateau - 29)).toBeLessThan(1);
  });
  it('is strictly increasing', () => {
    let prev = -1;
    for (let r = 0; r <= 150; r += 0.25) {
      const w = p.f(r);
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });
  it('is continuous in value and slope at 4, 8, 80 and 90 km', () => {
    for (const r of [4, 8, 80, 90]) {
      const e = 1e-7;
      expect(Math.abs(p.f(r + e) - p.f(r - e))).toBeLessThan(1e-6);
      expect(Math.abs(p.slope(r + e) - p.slope(r - e))).toBeLessThan(1e-6);
    }
  });
  it('is exactly r / geo beyond the ring', () => {
    for (const r of [90, 91, 120, 400]) expect(p.f(r)).toBeCloseTo(r / 25, 12);
  });
  it('has the plateau slope between 8 and 80 km', () => {
    expect(p.slope(8)).toBeCloseTo(p.plateau, 12);
    expect(p.slope(40)).toBeCloseTo(p.plateau, 12);
    expect(p.slope(80)).toBeCloseTo(p.plateau, 12);
  });
  it('inverts', () => {
    for (let r = 0; r <= 200; r += 0.7) expect(Math.abs(p.inverse(p.f(r)) - r) * 1000).toBeLessThan(1);
  });
  it('fails with a named error when the ring is too small', () => {
    const small = { ...DEFAULT_SHAPE, ringKm: 20, plateauEndKm: 15 };
    expect(() => makeProfile(25, 4, small)).toThrow(WarpError);
    expect(() => makeProfile(25, 4, small)).toThrow(/too small/);
  });
  it('rejects bad radii', () => {
    expect(() => makeProfile(25, 4, { ...DEFAULT_SHAPE, rampKm: 3 })).toThrow(WarpError);
  });
});

describe('multi-city warp', () => {
  const cities = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 200, y: 50 },
  ];
  const w = makeWarp(25, 4, cities);

  it('leaves points outside every ring at r / geo', () => {
    const p = w.toWorld(100, 300);
    expect(p.x).toBeCloseTo(4, 12);
    expect(p.y).toBeCloseTo(12, 12);
  });
  it('maps city centers to center / geo', () => {
    const p = w.toWorld(200, 50);
    expect(p.x).toBeCloseTo(8, 12);
    expect(p.y).toBeCloseTo(2, 12);
  });
  it('round trips under a meter over a region', () => {
    for (let x = -120; x <= 320; x += 13.7) {
      for (let y = -120; y <= 170; y += 11.3) {
        const q = w.toWorld(x, y);
        const back = w.toReal(q.x, q.y);
        expect(Math.hypot(back.x - x, back.y - y) * 1000).toBeLessThan(1);
      }
    }
  });
  it('keeps the bearing from a city', () => {
    const p = w.toWorld(30, 40);
    expect(p.x / p.y).toBeCloseTo(30 / 40, 9);
  });
  it('names the cities when rings overlap', () => {
    expect(() => makeWarp(25, 4, [{ id: 'dc', x: 0, y: 0 }, { id: 'bal', x: 60, y: 0 }])).toThrow(/dc and bal/);
  });
});
