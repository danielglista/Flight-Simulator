export interface ZoomButtonsOptions {
  /** The view's canvas; the buttons sit in its panel. */
  readonly canvas: HTMLCanvasElement;
  /** Which view, for the labels: `Top view` or `Side view`. */
  readonly view: string;
  /** Key names shown in the tooltips. */
  readonly keys: { readonly out: string; readonly in: string };
  /** The zoom the wheel would edit now (an index into the view's levels, higher = closer). */
  zoom(): number;
  /** How many levels the view has. */
  readonly levels: number;
  /** One level: -1 farther, 1 closer. */
  onZoom(steps: -1 | 1): void;
}

export interface ZoomButtons {
  /** Greys out the button that has nowhere left to go. */
  sync(): void;
}

/** Which way a view with `levels` zoom levels can still go from `zoom`. Pure. */
export function zoomEnds(zoom: number, levels: number): { readonly canOut: boolean; readonly canIn: boolean } {
  return { canOut: zoom > 0, canIn: zoom < levels - 1 };
}

/** A pair of - and + buttons over a view, doing what one wheel notch does. */
export function createZoomButtons(o: ZoomButtonsOptions): ZoomButtons {
  const box = document.createElement('div');
  box.className = 'zoom-buttons';
  const make = (text: string, name: string, key: string, steps: -1 | 1): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.title = `${name} (${key})`;
    el.setAttribute('aria-label', `${o.view}: ${name.toLowerCase()}`);
    el.addEventListener('click', (e) => {
      o.onZoom(steps);
      // `detail` is 0 for a keyboard click; after a mouse click leave nothing focused, so the flight keys are untouched.
      if (e.detail !== 0) el.blur();
    });
    box.append(el);
    return el;
  };
  const out = make('-', 'Zoom out', o.keys.out, -1);
  const closer = make('+', 'Zoom in', o.keys.in, 1);
  o.canvas.parentElement?.append(box);

  const sync = (): void => {
    const { canOut, canIn } = zoomEnds(o.zoom(), o.levels);
    // `aria-disabled`, not `disabled`: a keyboard user's focus stays put at the end of the range.
    out.setAttribute('aria-disabled', String(!canOut));
    closer.setAttribute('aria-disabled', String(!canIn));
  };
  sync();
  return { sync };
}
