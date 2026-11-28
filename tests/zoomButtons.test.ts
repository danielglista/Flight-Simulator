import { describe, expect, it } from 'vitest';
import { zoomEnds } from '../src/app/zoomButtons';
import { actionFor } from '../src/input/keyboard';

describe('zoomEnds', () => {
  it('stops at both ends of the levels', () => {
    expect(zoomEnds(0, 5)).toEqual({ canOut: false, canIn: true });
    expect(zoomEnds(2, 5)).toEqual({ canOut: true, canIn: true });
    expect(zoomEnds(4, 5)).toEqual({ canOut: true, canIn: false });
  });
});

describe('zoom keys', () => {
  it('1 to 4 are one-shot actions, ignored in text fields and with modifiers', () => {
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
      expect(actionFor({ code })).toBe(code);
      expect(actionFor({ code, repeat: true })).toBeNull();
      expect(actionFor({ code, editable: true })).toBeNull();
      expect(actionFor({ code, ctrlKey: true })).toBeNull();
    }
  });
});
