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

const isButton = (t: EventTarget | null): boolean => t instanceof HTMLElement && t.tagName === 'BUTTON';

export interface KeyActions {
  readonly KeyP: () => void;
  readonly KeyC: () => void;
  readonly Enter: () => void;
}

export type ActionCode = keyof KeyActions;

export interface ActionEvent {
  readonly code: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly editable?: boolean;
  /** The event target is a button, which already uses Enter. */
  readonly button?: boolean;
}

/** Which one-shot action this key press runs, or null. Pure, so it can be tested. */
export function actionFor(e: ActionEvent): ActionCode | null {
  if (e.code !== 'KeyP' && e.code !== 'KeyC' && e.code !== 'Enter') return null;
  if (e.editable || e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.code === 'Enter' && e.button) return null;
  if (e.repeat) return null;
  return e.code;
}

/** Window key listeners. P, C and Enter run their action once per press. */
export function attachKeyboard(actions: KeyActions): Keyboard {
  const keys = createKeyState();
  const down = (e: KeyboardEvent): void => {
    const editable = isEditable(e.target);
    if (e.code === 'KeyP' || e.code === 'KeyC' || e.code === 'Enter') {
      // These keys never steer, whether or not the press ran an action.
      if (!editable && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const code = actionFor({
          code: e.code,
          repeat: e.repeat,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          editable,
          button: isButton(e.target),
        });
        if (code) actions[code]();
        return;
      }
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
