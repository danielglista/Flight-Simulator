import { describe, expect, it } from 'vitest';
import { turnTrack } from '../src/views/turnLine';

const craft = { x: 100, y: 200, heading: 0, speed: 50 };

describe('turnTrack', () => {
  it('goes straight ahead with no turn', () => {
    const p = turnTrack(craft, 0, 10, 2);
    expect(p).toHaveLength(6);
    expect(p[5]?.x).toBeCloseTo(100);
    expect(p[5]?.y).toBeCloseTo(700);
  });

  it('curves to the right for a clockwise turn', () => {
    const p = turnTrack(craft, 0.2, 10, 1);
    const end = p[p.length - 1];
    expect(end?.x).toBeGreaterThan(100);
    expect(end?.y).toBeLessThan(700);
  });

  it('stays at the turn radius from the circle center', () => {
    const rate = 0.1;
    const p = turnTrack(craft, rate, 20, 1);
    const r = craft.speed / rate;
    // Heading north turning right: the center is due east.
    for (const q of p) expect(Math.hypot(q.x - (100 + r), q.y - 200)).toBeCloseTo(r, 0);
  });
});

describe('turnTrack with a duration that is not a whole number of steps', () => {
  it('ends exactly at the duration', () => {
    const p = turnTrack(craft, 0, 5.3, 2);
    expect(p).toHaveLength(4);
    expect(p[3]?.y).toBeCloseTo(200 + 50 * 5.3);
  });
  it('keeps the heading for the shorter last step', () => {
    const p = turnTrack(craft, 0.1, 5.3, 2);
    expect(p[p.length - 1]?.heading).toBeCloseTo(0.1 * 5.3, 9);
  });
});

describe('turnTrack headings', () => {
  it('starts at the craft heading and holds it when not turning', () => {
    const p = turnTrack({ ...craft, heading: 1 }, 0, 10, 2);
    for (const q of p) expect(q.heading).toBe(1);
  });
  it('heading at each point is the start plus rate times elapsed time', () => {
    const p = turnTrack(craft, 0.1, 10, 2);
    p.forEach((q, i) => expect(q.heading).toBeCloseTo(0.1 * 2 * i, 9));
  });
});
