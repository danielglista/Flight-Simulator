import { createKeyState, type KeyState } from './keyState';

export interface Keyboard {
  readonly keys: KeyState;
  detach(): void;
}

/** Input types that take typed text. Range, button, checkbox and the like do not. */
const NON_TEXT_INPUT_TYPES = new Set([
  'range', 'button', 'checkbox', 'radio', 'submit', 'reset', 'color', 'file', 'image',
]);

export interface TextEntryTarget {
  readonly tagName: string;
  readonly type?: string | null;
  readonly isContentEditable?: boolean;
}

/** True for controls where typing should go to the control, not the flight keys. Pure. */
export function isTextEntry(t: TextEntryTarget): boolean {
  if (t.isContentEditable) return true;
  const tag = t.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((t.type ?? '').toLowerCase());
  return false;
}

const isEditable = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return isTextEntry({
    tagName: t.tagName,
    type: t instanceof HTMLInputElement ? t.type : null,
    isContentEditable: t.isContentEditable,
  });
};

const isButton = (t: EventTarget | null): boolean => t instanceof HTMLElement && t.tagName === 'BUTTON';

export interface KeyActions {
  readonly KeyP: () => void;
  readonly KeyC: () => void;
  readonly Enter: () => void;
  readonly Backquote: () => void;
}

export type ActionCode = keyof KeyActions;

const ACTION_CODES: Readonly<Record<ActionCode, true>> = { KeyP: true, KeyC: true, Enter: true, Backquote: true };

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
  if (!Object.hasOwn(ACTION_CODES, e.code)) return null;
  if (e.editable || e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.code === 'Enter' && e.button) return null;
  if (e.repeat) return null;
  return e.code as ActionCode;
}

/** Window key listeners. P, C and Enter run their action once per press. */
export function attachKeyboard(actions: KeyActions): Keyboard {
  const keys = createKeyState();
  const down = (e: KeyboardEvent): void => {
    const editable = isEditable(e.target);
    if (Object.hasOwn(ACTION_CODES, e.code)) {
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
