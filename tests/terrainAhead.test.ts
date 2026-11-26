import { describe, expect, it } from 'vitest';
import { terrainAhead } from '../src/sim/flight/terrain';
import { AIR_START, initialState } from '../src/sim/state';
import { advance } from '../src/sim/step';
import { craft, realWorld } from './helpers';

// A cliff 700 m east of the origin: flat at 0, then 500 m high.
const cliff = (x: number): number => (x < 700 ? 0 : 500);
const heightAt = (x: number, _y: number): number => cliff(x);
const east = { heading: Math.PI / 2, speed: 100, z: 100, x: 0, y: 0, gear: 0 };

describe('terrainAhead', () => {
  it('level toward a cliff: quiet at 9 s, warns at 7 s', () => {
    expect(terrainAhead(craft({ ...east, x: -200 }), heightAt)).toBe(false); // 900 m away = 9 s
    expect(terrainAhead(craft({ ...east, x: 0 }), heightAt)).toBe(true); // 700 m = 7 s
  });

  it('climbing over it is quiet; diving at flat ground warns', () => {
    expect(terrainAhead(craft({ ...east, z: 400, pathAngle: 0.5 }), heightAt)).toBe(false);
    expect(terrainAhead(craft({ ...east, x: -2000, z: 100, pathAngle: -0.3 }), heightAt)).toBe(true);
  });

  it('level over water never warns', () => {
    expect(terrainAhead(craft({ ...east, z: 100 }), () => 0)).toBe(false);
  });

  it('is off with the gear down low, on the ground, and when crashed', () => {
    const low = { ...east, z: 8, gear: 1 };
    expect(terrainAhead(craft(low), () => 0)).toBe(false);
    expect(terrainAhead(craft({ ...low, gear: 0 }), () => 0)).toBe(true);
    expect(terrainAhead(craft({ ...east, x: 0, onGround: true }), heightAt)).toBe(false);
    expect(terrainAhead(craft({ ...east, x: 0 }), heightAt, true)).toBe(false);
  });

  it('the gear stops mattering above the takeoff height', () => {
    expect(terrainAhead(craft({ ...east, z: 200, gear: 1 }), (x) => (x < 300 ? 0 : 400))).toBe(true);
  });

  it('is cheap: at most about 80 height lookups at the speed cap', () => {
    let calls = 0;
    terrainAhead(craft({ ...east, speed: 300, z: 5000 }), () => (calls++, 0));
    expect(calls).toBeLessThanOrEqual(82);
  });

  it('air start, hands off: warns before the crash on the real map', () => {
    const { world } = realWorld();
    let s = initialState(AIR_START);
    let warnedAt = -1;
    for (let i = 0; i < 60 * 600 && !s.crash; i++) {
      if (warnedAt < 0 && terrainAhead(s.craft, world.heightAt)) warnedAt = i;
      s = advance(s, world);
    }
    if (s.crash) {
      expect(warnedAt).toBeGreaterThanOrEqual(0);
      expect(warnedAt).toBeLessThan(s.tick);
    }
  });
});
