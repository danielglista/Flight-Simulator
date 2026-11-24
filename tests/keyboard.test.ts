import { describe, expect, it } from 'vitest';
import { actionFor } from '../src/input/keyboard';

describe('actionFor', () => {
  it('runs Enter once per press', () => {
    expect(actionFor({ code: 'Enter' })).toBe('Enter');
    expect(actionFor({ code: 'Enter', repeat: true })).toBeNull();
  });
  it('ignores Enter on a button and in a text field', () => {
    expect(actionFor({ code: 'Enter', button: true })).toBeNull();
    expect(actionFor({ code: 'Enter', editable: true })).toBeNull();
  });
  it('still runs P and C on a button, and ignores modifiers', () => {
    expect(actionFor({ code: 'KeyP', button: true })).toBe('KeyP');
    expect(actionFor({ code: 'KeyC' })).toBe('KeyC');
    expect(actionFor({ code: 'KeyP', ctrlKey: true })).toBeNull();
    expect(actionFor({ code: 'KeyW' })).toBeNull();
  });
});
