import { describe, expect, it } from 'vitest';
import { createFrameStats } from '../src/app/frameStats';

describe('frameStats', () => {
  it('empty and single sample', () => {
    const s = createFrameStats(5);
    expect(s.summary().n).toBe(0);
    s.push(7);
    expect(s.summary()).toEqual({ n: 1, median: 7, p95: 7, worst: 7 });
  });
  it('median, p95 and worst on known data', () => {
    const s = createFrameStats(100);
    for (let i = 1; i <= 100; i++) s.push(i);
    expect(s.summary()).toEqual({ n: 100, median: 50, p95: 95, worst: 100 });
  });
  it('keeps only the newest samples once full', () => {
    const s = createFrameStats(300);
    for (let i = 1; i <= 350; i++) s.push(i);
    const r = s.summary();
    expect(r.n).toBe(300);
    expect(r.worst).toBe(350);
    expect(r.median).toBe(200);
  });
  it('clear empties it', () => {
    const s = createFrameStats(3);
    s.push(1);
    s.clear();
    expect(s.summary().n).toBe(0);
  });
});
