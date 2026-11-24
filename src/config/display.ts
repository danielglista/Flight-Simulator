export interface Size {
  readonly width: number;
  readonly height: number;
}

export type CanvasPanelId = 'top' | 'side' | 'instruments';

/** Internal (pre-scale) canvas sizes. Provisional: see A1_PLAN.md section 9. */
export const CANVAS_PANELS: Readonly<
  Record<CanvasPanelId, { readonly label: string; readonly internal: Size }>
> = {
  top: { label: 'TOP VIEW', internal: { width: 640, height: 360 } },
  side: { label: 'SIDE VIEW', internal: { width: 320, height: 200 } },
  instruments: { label: 'INSTRUMENTS', internal: { width: 320, height: 160 } },
};

/** Smallest supported window; below this the page scrolls instead of shrinking. */
export const MIN_WINDOW: Size = { width: 1280, height: 720 };
