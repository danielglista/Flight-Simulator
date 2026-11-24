/** Scale factors between real and world units. E1 adds the horizontal ones. */
export interface ScaleConfig {
  /** Real meters of altitude per world meter. */
  readonly altitude: number;
}

export const SCALES: ScaleConfig = { altitude: 10 };
