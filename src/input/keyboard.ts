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

/** `fine` is true while Shift is held (the heading bug keys step 1 degree instead of 5). */
export interface KeyActions {
  readonly KeyP: (fine: boolean) => void;
  readonly KeyC: (fine: boolean) => void;
  readonly Enter: (fine: boolean) => void;
  readonly Backquote: (fine: boolean) => void;
  readonly BracketLeft: (fine: boolean) => void;
  readonly BracketRight: (fine: boolean) => void;
  readonly Minus: (fine: boolean) => void;
  readonly Equal: (fine: boolean) => void;
  /** Autopilot on and off, speed hold alone, and the speed target down and up (D4). */
  readonly KeyZ: (fine: boolean) => void;
  readonly KeyX: (fine: boolean) => void;
  readonly Comma: (fine: boolean) => void;
  readonly Period: (fine: boolean) => void;
}

export type ActionCode = keyof KeyActions;

const ACTION_CODES: Readonly<Record<ActionCode, true>> = { KeyP: true, KeyC: true, Enter: true, Backquote: true, BracketLeft: true, BracketRight: true, Minus: true, Equal: true, KeyZ: true, KeyX: true, Comma: true, Period: true };

/** Actions that repeat while the key is held. */
const REPEATING: ReadonlySet<string> = new Set(['BracketLeft', 'BracketRight', 'Minus', 'Equal', 'Comma', 'Period']);

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
  if (e.repeat && !REPEATING.has(e.code)) return null;
  return e.code as ActionCode;
}

/** Window key listeners. P, C and Enter run their action once per press; the bracket, minus and equal keys repeat. */
export function attachKeyboard(actions: KeyActions): Keyboard {
  const keys = createKeyState();
  const down = (e: KeyboardEvent): void => {
    const editable = isEditable(e.target);
    // Space levels the wings: keep the page from scrolling and a focused button from reacting.
    if (e.code === 'Space' && !editable && !e.ctrlKey && !e.altKey && !e.metaKey) e.preventDefault();
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
        if (code) actions[code](e.shiftKey);
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
  const up = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !isEditable(e.target) && !e.ctrlKey && !e.altKey && !e.metaKey) e.preventDefault();
    keys.keyUp({ code: e.code });
  };
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
