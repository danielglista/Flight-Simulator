import { describe, expect, it } from 'vitest';
import { project, unproject } from '../tools/map/project';

describe('project', () => {
  it('round trips within a meter', () => {
    for (const [lat, lon] of [[38.85, -77.04], [39.95, -75.17], [47.6, -122.3], [25.8, -80.2]] as const) {
      const p = project(lat, lon);
      const q = unproject(p.x, p.y);
      const back = project(q.lat, q.lon);
      expect(Math.hypot(back.x - p.x, back.y - p.y) * 1000).toBeLessThan(1);
      expect(q.lat).toBeCloseTo(lat, 9);
      expect(q.lon).toBeCloseTo(lon, 9);
    }
  });
  it('puts DC to Philadelphia about 200 km apart', () => {
    const a = project(38.8895, -77.0353);
    const b = project(39.9526, -75.1652);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(d).toBeGreaterThan(190);
    expect(d).toBeLessThan(210);
  });
  it('keeps due north as +y at every longitude', () => {
    for (const lon of [-120, -96, -75]) {
      const a = project(35, lon);
      const b = project(36, lon);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeGreaterThan(a.y);
    }
  });
  it('is centered on 96 W and 39 N', () => {
    const o = project(39, -96);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(0, 9);
  });
});
