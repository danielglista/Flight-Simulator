/** Scale factors between real and world units. E1 adds the horizontal ones. */
export interface ScaleConfig {
  /** Real meters of altitude per world meter. */
  readonly altitude: number;
  /** Real meters per world meter for airport layouts (runways, taxiways). Never used for altitude. */
  readonly airport: number;
}

export const SCALES: ScaleConfig = { altitude: 10, airport: 2 };
