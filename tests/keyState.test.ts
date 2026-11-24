import { describe, expect, it } from 'vitest';
import { createKeyState } from '../src/input/keyState';

describe('keyState', () => {
  it('opposites cancel and recover', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyA' });
    expect(k.sample()).toEqual([{ kind: 'turn', value: -1 }]);
    k.keyDown({ code: 'KeyD' });
    expect(k.sample()).toEqual([{ kind: 'turn', value: 0 }]);
    k.keyUp({ code: 'KeyA' });
    expect(k.sample()).toEqual([{ kind: 'turn', value: 1 }]);
    expect(k.sample()).toEqual([]);
  });
  it('latch lasts one sample', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyD' });
    k.keyUp({ code: 'KeyD' });
    expect(k.sample()).toEqual([{ kind: 'turn', value: 1 }]);
    expect(k.sample()).toEqual([{ kind: 'turn', value: 0 }]);
  });
  it('ignores repeat, modifiers and text fields', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyA', repeat: true });
    k.keyDown({ code: 'KeyA', ctrlKey: true });
    k.keyDown({ code: 'KeyA', altKey: true });
    k.keyDown({ code: 'KeyA', metaKey: true });
    k.keyDown({ code: 'KeyA', editable: true });
    k.keyDown({ code: 'KeyZ' });
    expect(k.sample()).toEqual([]);
  });
  it('honors keyup with a modifier', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyE' });
    k.sample();
    k.keyUp({ code: 'KeyE', ctrlKey: true });
    expect(k.sample()).toEqual([{ kind: 'throttle', value: 0 }]);
  });
  it('clear emits zeros', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyQ' });
    k.keyDown({ code: 'KeyA' });
    k.sample();
    k.clear();
    expect(k.sample()).toEqual([
      { kind: 'turn', value: 0 },
      { kind: 'throttle', value: 0 },
    ]);
  });
});

describe('pitch keys', () => {
  it('S climbs (+1), W descends (-1), and they cancel', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyS' });
    expect(k.sample()).toEqual([{ kind: 'pitch', value: 1 }]);
    k.keyDown({ code: 'KeyW' });
    expect(k.sample()).toEqual([{ kind: 'pitch', value: 0 }]);
    k.keyUp({ code: 'KeyS' });
    expect(k.sample()).toEqual([{ kind: 'pitch', value: -1 }]);
  });
  it('a tap shorter than a sample still latches', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyW' });
    k.keyUp({ code: 'KeyW' });
    expect(k.sample()).toEqual([{ kind: 'pitch', value: -1 }]);
    expect(k.sample()).toEqual([{ kind: 'pitch', value: 0 }]);
  });
  it('clear emits zero for pitch', () => {
    const k = createKeyState();
    k.keyDown({ code: 'KeyS' });
    k.sample();
    k.clear();
    expect(k.sample()).toEqual([{ kind: 'pitch', value: 0 }]);
  });
});

describe('wings-level key', () => {
  it('Space emits one level command per press, even for a tap shorter than a sample', () => {
    const k = createKeyState();
    k.keyDown({ code: 'Space' });
    k.keyUp({ code: 'Space' });
    expect(k.sample()).toEqual([{ kind: 'level' }]);
    expect(k.sample()).toEqual([]);
  });
  it('held Space does not repeat it, and ignores repeat events, modifiers and text fields', () => {
    const k = createKeyState();
    k.keyDown({ code: 'Space' });
    expect(k.sample()).toEqual([{ kind: 'level' }]);
    k.keyDown({ code: 'Space', repeat: true });
    expect(k.sample()).toEqual([]);
    k.keyDown({ code: 'Space', ctrlKey: true });
    k.keyDown({ code: 'Space', editable: true });
    expect(k.sample()).toEqual([]);
  });
  it('a second press gives a second command, and clear forgets a pending one', () => {
    const k = createKeyState();
    k.keyDown({ code: 'Space' });
    k.sample();
    k.keyUp({ code: 'Space' });
    k.keyDown({ code: 'Space' });
    expect(k.sample()).toEqual([{ kind: 'level' }]);
    k.keyDown({ code: 'Space' });
    k.clear();
    expect(k.sample()).toEqual([]);
  });
});
