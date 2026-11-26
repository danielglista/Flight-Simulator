import { describe, expect, it } from 'vitest';
import { actionFor, isTextEntry } from '../src/input/keyboard';

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
  it('runs Backquote once per press, but not in a text field', () => {
    expect(actionFor({ code: 'Backquote' })).toBe('Backquote');
    expect(actionFor({ code: 'Backquote', repeat: true })).toBeNull();
    expect(actionFor({ code: 'Backquote', editable: true })).toBeNull();
    expect(actionFor({ code: 'constructor' })).toBeNull();
  });
});

describe('isTextEntry', () => {
  it('is false for range, button and checkbox inputs', () => {
    for (const type of ['range', 'button', 'checkbox']) expect(isTextEntry({ tagName: 'INPUT', type })).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry({ tagName: 'DIV' })).toBe(false);
  });
  it('is true for text-like inputs, a missing type, textarea, select and contenteditable', () => {
    for (const type of ['text', 'search', 'number', 'password']) expect(isTextEntry({ tagName: 'INPUT', type })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
});

describe('heading bug keys', () => {
  it('[ and ] are actions that repeat while held', () => {
    expect(actionFor({ code: 'BracketLeft' })).toBe('BracketLeft');
    expect(actionFor({ code: 'BracketRight', repeat: true })).toBe('BracketRight');
    expect(actionFor({ code: 'BracketRight', editable: true })).toBeNull();
    expect(actionFor({ code: 'BracketLeft', ctrlKey: true })).toBeNull();
  });
});

describe('autopilot keys (D4)', () => {
  it('Z, X, comma and period are one-shot actions; comma and period repeat', () => {
    expect(actionFor({ code: 'KeyZ' })).toBe('KeyZ');
    expect(actionFor({ code: 'KeyX' })).toBe('KeyX');
    expect(actionFor({ code: 'KeyZ', repeat: true })).toBeNull();
    expect(actionFor({ code: 'Comma', repeat: true })).toBe('Comma');
    expect(actionFor({ code: 'Period', repeat: true })).toBe('Period');
    expect(actionFor({ code: 'KeyZ', ctrlKey: true })).toBeNull();
    expect(actionFor({ code: 'KeyZ', editable: true })).toBeNull();
  });
});
