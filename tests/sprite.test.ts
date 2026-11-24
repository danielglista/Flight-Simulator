import { describe, expect, it } from 'vitest';
import {
  CANOPY,
  FIN,
  LIGHT_LEFT,
  LIGHT_RIGHT,
  PITCH_FRAMES,
  PLANE_SIDE,
  PLANE_TOP,
  SIDE_SPRITE_SIZE,
  TOP_FRAMES,
  TOP_SPRITE_SIZE,
  WRECK,
  WRECK_SIZE,
} from '../src/config/planeShape';
import type { Rgb } from '../src/config/palette';
import { frameAngle, frameIndex, pitchFrameAngle, pitchFrameIndex, rasterize } from '../src/views/sprite';

const DEG = Math.PI / 180;

/** Mean offset of pixels of this color from the center, in screen coordinates (right, up). */
function centroid(data: Uint8ClampedArray, size: number, color: Rgb): { x: number; y: number; n: number } {
  const c = (size - 1) / 2;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      if (data[o + 3] === 255 && data[o] === color[0] && data[o + 1] === color[1] && data[o + 2] === color[2]) {
        sx += px - c;
        sy += c - py;
        n++;
      }
    }
  }
  return { x: n ? sx / n : 0, y: n ? sy / n : 0, n };
}

describe('top sprite', () => {
  const S = TOP_SPRITE_SIZE;
  it('points the nose up, right, down and left at 0, 90, 180, 270', () => {
    const expected: [number, number, number][] = [
      [0, 0, 1],
      [90, 1, 0],
      [180, 0, -1],
      [270, -1, 0],
    ];
    for (const [deg, fx, fy] of expected) {
      const d = rasterize(PLANE_TOP, deg * DEG, S);
      const canopy = centroid(d, S, CANOPY);
      const fin = centroid(d, S, FIN);
      expect(canopy.n, `canopy at ${deg}`).toBeGreaterThan(0);
      expect(canopy.x * fx + canopy.y * fy, `canopy at ${deg}`).toBeGreaterThan(2);
      expect(fin.x * fx + fin.y * fy, `fin at ${deg}`).toBeLessThan(-2);
    }
  });
  it('keeps red on the left and green on the right at every quarter heading', () => {
    for (const deg of [0, 90, 180, 270]) {
      const d = rasterize(PLANE_TOP, deg * DEG, S);
      const fx = Math.sin(deg * DEG);
      const fy = Math.cos(deg * DEG);
      const leftX = -fy;
      const leftY = fx;
      const red = centroid(d, S, LIGHT_LEFT);
      const green = centroid(d, S, LIGHT_RIGHT);
      expect(red.n).toBeGreaterThan(0);
      expect(green.n).toBeGreaterThan(0);
      expect(red.x * leftX + red.y * leftY, `red at ${deg}`).toBeGreaterThan(5);
      expect(green.x * leftX + green.y * leftY, `green at ${deg}`).toBeLessThan(-5);
    }
  });
  it('fills the center pixel and leaves the frame edge clear in all frames', () => {
    const c = (S - 1) / 2;
    for (let i = 0; i < TOP_FRAMES; i++) {
      const d = rasterize(PLANE_TOP, frameAngle(i), S);
      expect(d[(c * S + c) * 4 + 3], `center of frame ${i}`).toBe(255);
      for (let k = 0; k < S; k++) {
        for (const [px, py] of [
          [k, 0],
          [k, S - 1],
          [0, k],
          [S - 1, k],
        ] as const) {
          expect(d[(py * S + px) * 4 + 3], `edge of frame ${i}`).toBe(0);
        }
      }
    }
  });
});

describe('side sprite', () => {
  const S = SIDE_SPRITE_SIZE;
  const d = rasterize(PLANE_SIDE, 0, S);
  it('has its nose on the right and its tail on the left', () => {
    expect(centroid(d, S, CANOPY).x).toBeGreaterThan(3);
    expect(centroid(d, S, FIN).x).toBeLessThan(-8);
    expect(centroid(d, S, FIN).y).toBeGreaterThan(0);
  });
  it('fills the center and leaves the edge clear', () => {
    const c = (S - 1) / 2;
    expect(d[(c * S + c) * 4 + 3]).toBe(255);
    for (let k = 0; k < S; k++) {
      expect(d[k * 4 + 3]).toBe(0);
      expect(d[((S - 1) * S + k) * 4 + 3]).toBe(0);
      expect(d[k * S * 4 + 3]).toBe(0);
      expect(d[(k * S + S - 1) * 4 + 3]).toBe(0);
    }
  });
});

describe('frameIndex', () => {
  it('wraps at north', () => {
    expect(frameIndex(0)).toBe(0);
    expect(frameIndex(2 * Math.PI)).toBe(0);
    expect(frameIndex(357.5 * DEG)).toBe(0);
    expect(frameIndex(357.4 * DEG)).toBe(71);
    expect(frameIndex(90 * DEG)).toBe(18);
  });
  it('is never more than 2.5 degrees off', () => {
    let worst = 0;
    for (let h = 0; h < 360; h += 0.05) {
      const err = Math.abs(((frameAngle(frameIndex(h * DEG)) / DEG - h + 540) % 360) - 180);
      worst = Math.max(worst, err);
    }
    expect(worst).toBeLessThanOrEqual(2.5 + 1e-9);
  });
});

describe('side pitch frames', () => {
  const S = SIDE_SPRITE_SIZE;
  const frame = (deg: number) => rasterize(PLANE_SIDE, pitchFrameAngle(pitchFrameIndex(deg * DEG)), S);
  it('has 13 frames from -15 to +15 degrees, with the middle frame level', () => {
    expect(pitchFrameIndex(0)).toBe(6);
    expect(pitchFrameIndex(15 * DEG)).toBe(12);
    expect(pitchFrameIndex(-15 * DEG)).toBe(0);
    expect(pitchFrameIndex(40 * DEG)).toBe(12);
    expect(pitchFrameAngle(6)).toBeCloseTo(0, 12);
  });
  it('puts the nose above the tail at +15 and below at -15', () => {
    const up = centroid(frame(15), S, FIN);
    const upNose = centroid(frame(15), S, CANOPY);
    expect(upNose.y).toBeGreaterThan(up.y);
    const down = centroid(frame(-15), S, FIN);
    const downNose = centroid(frame(-15), S, CANOPY);
    expect(downNose.y).toBeLessThan(down.y);
  });
  it('level frame is the unrotated sprite', () => {
    expect(Array.from(frame(0))).toEqual(Array.from(rasterize(PLANE_SIDE, 0, S)));
  });
  it('nothing touches the frame edge at any pitch', () => {
    for (let i = 0; i < PITCH_FRAMES; i++) {
      const d = rasterize(PLANE_SIDE, pitchFrameAngle(i), S);
      for (let k = 0; k < S; k++) {
        for (const [x, y] of [[k, 0], [k, S - 1], [0, k], [S - 1, k]] as const) {
          expect(d[(y * S + x) * 4 + 3]).toBe(0);
        }
      }
    }
  });
  it('the wreck is non-empty and fits its frame', () => {
    const d = rasterize(WRECK, 0, WRECK_SIZE);
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n++;
    expect(n).toBeGreaterThan(40);
    for (let k = 0; k < WRECK_SIZE; k++) {
      expect(d[(k * WRECK_SIZE) * 4 + 3]).toBe(0);
      expect(d[(k * WRECK_SIZE + WRECK_SIZE - 1) * 4 + 3]).toBe(0);
    }
  });
});
