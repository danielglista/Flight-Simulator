import { describe, expect, it } from 'vitest';
import { createLoop } from '../src/app/loop';
import { WHEEL_FADE_PX, WHEEL_PX } from '../src/config/display';
import { PLANE_SIDE } from '../src/config/planeShape';
import { DEFAULT_TUNING } from '../src/config/motion';
import { stallState } from '../src/sim/flight/aero';
import { interpolate } from '../src/sim/interpolate';
import { runwayStart } from '../src/sim/world/starts';
import { wheelOffsetPx } from '../src/views/sideCamera';
import { craft, realWorld } from './helpers';

describe('wheelOffsetPx', () => {
  it('is full on the ground, none from the fade height, and falls as the plane rises', () => {
    expect(wheelOffsetPx(0)).toBe(WHEEL_PX);
    expect(wheelOffsetPx(WHEEL_FADE_PX)).toBe(0);
    expect(wheelOffsetPx(500)).toBe(0);
    expect(wheelOffsetPx(-3)).toBe(WHEEL_PX);
    let last = Infinity;
    for (let px = 0; px <= WHEEL_FADE_PX; px += 0.5) {
      const o = wheelOffsetPx(px);
      expect(o).toBeLessThanOrEqual(last);
      last = o;
    }
  });
  it('keeps the drawn height rising with the real one', () => {
    // Drawn height above the sea row is height minus the lift, so it must never fall as height grows.
    let last = -Infinity;
    for (let px = 0; px <= 80; px += 0.25) {
      const drawn = px + wheelOffsetPx(px);
      expect(drawn).toBeGreaterThanOrEqual(last);
      last = drawn;
    }
  });
});

describe('the side sprite wheels', () => {
  it('reach WHEEL_PX below the center and no further', () => {
    const lowest = Math.min(...PLANE_SIDE.flatMap((p) => p.points.map(([, y]) => y)));
    expect(lowest).toBe(-WHEEL_PX);
  });
});

describe('onGround in the views and the loop', () => {
  it('interpolation takes the newer step value', () => {
    expect(interpolate(craft({ onGround: true }), craft({ onGround: false }), 0.5).onGround).toBe(false);
    expect(interpolate(craft({ onGround: false }), craft({ onGround: true }), 0.1).onGround).toBe(true);
  });
  it('a stall is never shown on the ground', () => {
    expect(stallState({ pitch: 0.4, pathAngle: 0, onGround: true }, DEFAULT_TUNING)).toBe('none');
    expect(stallState({ pitch: 0.4, pathAngle: 0 }, DEFAULT_TUNING)).toBe('stalled');
  });
  it('the loop starts where it is told and restarts there', () => {
    const { world, runway } = realWorld();
    const start = runwayStart(runway, world.heightAt);
    const loop = createLoop({ world, draw: () => {}, requestDraw: () => {}, sampleKeys: () => [], clearKeys: () => {}, startPaused: true, start });
    expect(loop.state.craft.onGround).toBe(true);
    expect(loop.snapshot().x).toBe(start.x);
    expect(loop.state.start).toBe(start);
  });
});
