import { createKeyState, type KeyState } from './keyState';

export interface Keyboard {
  readonly keys: KeyState;
  detach(): void;
}

const isEditable = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
  );
};

/** Window key listeners. `onPause` fires for P. */
export function attachKeyboard(onPause: () => void): Keyboard {
  const keys = createKeyState();
  const down = (e: KeyboardEvent): void => {
    const editable = isEditable(e.target);
    if (e.code === 'KeyP' && !e.repeat && !editable && !e.ctrlKey && !e.altKey && !e.metaKey) {
      onPause();
      return;
    }
    keys.keyDown({
      code: e.code,
      repeat: e.repeat,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      editable,
    });
  };
  const up = (e: KeyboardEvent): void => keys.keyUp({ code: e.code });
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return {
    keys,
    detach() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    },
  };
}
