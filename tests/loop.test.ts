import { describe, expect, it } from 'vitest';
import { createLoop } from '../src/app/loop';
import { createKeyState } from '../src/input/keyState';

const B = { width: 5120, height: 5120, heightAt: () => 0, altitudeScale: 10 };
const DT = 1000 / 60;

function make() {
  const keys = createKeyState();
  const loop = createLoop({
    world: B,
    draw: () => {},
    requestDraw: () => {},
    sampleKeys: () => keys.sample(),
    clearKeys: () => keys.clear(),
  });
  return { loop, keys };
}
type Loop = ReturnType<typeof make>['loop'];
const frames = (loop: Loop, from: number, n: number): number => {
  let t = from;
  for (let i = 0; i < n; i++) loop.frame((t += DT));
  return t;
};

describe('loop', () => {
  it('runs no steps while paused and does not jump on resume', () => {
    const { loop } = make();
    const t = frames(loop, 0, 10);
    const tick = loop.state.tick;
    loop.pause();
    frames(loop, t, 100);
    expect(loop.state.tick).toBe(tick);
    loop.resume();
    loop.frame(100000);
    expect(loop.state.tick).toBe(tick);
    loop.frame(100000 + DT);
    expect(loop.state.tick).toBe(tick + 1);
  });
  it('place while paused moves the dot, not the tick', () => {
    const { loop } = make();
    frames(loop, 0, 5);
    loop.pause();
    const tick = loop.state.tick;
    loop.send({ kind: 'place', x: 100, y: 200 });
    expect(loop.state.tick).toBe(tick);
    expect(loop.snapshot().x).toBe(100);
    expect(loop.snapshot().y).toBe(200);
  });
  it('a placed dot never appears between the old and new positions', () => {
    const { loop } = make();
    const t = frames(loop, 0, 3);
    loop.send({ kind: 'place', x: 100, y: 100 });
    let tt = t;
    for (let i = 0; i < 4; i++) {
      loop.frame((tt += DT));
      expect(Math.abs(loop.snapshot().x - 100)).toBeLessThan(5);
      expect(Math.abs(loop.snapshot().y - 100)).toBeLessThan(5);
    }
  });
  it('a tap shorter than one step still turns', () => {
    const { loop, keys } = make();
    loop.frame(0);
    const h = loop.state.craft.heading;
    keys.keyDown({ code: 'KeyD' });
    keys.keyUp({ code: 'KeyD' });
    loop.frame(DT + 0.1);
    expect(loop.state.craft.heading).toBeGreaterThan(h);
  });
  it('a key held through a pause stops turning the dot', () => {
    const { loop, keys } = make();
    let t = frames(loop, 0, 2);
    keys.keyDown({ code: 'KeyD' });
    t = frames(loop, t, 5);
    expect(loop.state.controls.turn).toBe(1);
    loop.pause();
    loop.resume();
    loop.frame(50000);
    t = frames(loop, 50000, 3);
    expect(loop.state.controls.turn).toBe(0);
    const h = loop.state.craft.heading;
    frames(loop, t, 10);
    expect(loop.state.craft.heading).toBeCloseTo(h, 9);
  });
});

describe('crash and restart in the loop', () => {
  let ground = 110; // above the start altitude, so the first step crashes
  const FLAT = { ...B, heightAt: () => ground };
  function crashing() {
    ground = 110;
    const keys = createKeyState();
    const loop = createLoop({
      world: FLAT,
      draw: () => {},
      requestDraw: () => {},
      sampleKeys: () => keys.sample(),
      clearKeys: () => keys.clear(),
    });
    return { loop, keys };
  }
  it('a key held through a restart keeps turning', () => {
    const { loop, keys } = crashing();
    loop.frame(0);
    keys.keyDown({ code: 'KeyD' });
    let t = frames(loop, 0, 90);
    expect(loop.state.crash).not.toBeNull();
    ground = 0;
    loop.send({ kind: 'restart' });
    t = frames(loop, t, 2);
    expect(loop.state.crash).toBeNull();
    const h = loop.state.craft.heading;
    frames(loop, t, 30);
    expect(loop.state.craft.heading).toBeGreaterThan(h);
  });
  it('restart while paused applies at once and never streaks', () => {
    const { loop } = crashing();
    const t = frames(loop, 0, 90);
    expect(loop.state.crash).not.toBeNull();
    ground = 0;
    loop.pause();
    const tick = loop.state.tick;
    loop.send({ kind: 'restart' });
    expect(loop.state.crash).toBeNull();
    expect(loop.state.tick).toBe(tick);
    expect(loop.snapshot()).toEqual(loop.state.craft);
    void t;
  });
});
