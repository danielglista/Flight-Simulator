import type { Size } from '../config/display';

export interface FitResult {
  /** Whole-number scale in device pixels (>= 1). */
  readonly scale: number;
  /** CSS size to give the canvas element. */
  readonly cssWidth: number;
  readonly cssHeight: number;
}

/**
 * Largest whole-number scale at which `internal` fits in `panelCss`.
 * The scale is worked out in device pixels so every canvas pixel covers the
 * same whole number of screen pixels, even at fractional DPR (125%, 150%).
 */
export function fitScale(panelCss: Size, internal: Size, devicePixelRatio: number): FitResult {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const fits = (panel: number, inner: number): number => {
    if (!Number.isFinite(panel) || !(inner > 0)) return 1;
    return Math.floor((panel * dpr) / inner);
  };
  const scale = Math.max(
    1,
    Math.min(fits(panelCss.width, internal.width), fits(panelCss.height, internal.height)),
  );
  return {
    scale,
    cssWidth: (internal.width * scale) / dpr,
    cssHeight: (internal.height * scale) / dpr,
  };
}
