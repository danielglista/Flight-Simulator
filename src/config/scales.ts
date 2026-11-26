/** Scale factors between real and world units. Airport layouts carry their own scale (`AirportDef.scale`). */
export interface ScaleConfig {
  /** Real meters of altitude per world meter. */
  readonly altitude: number;
  /** Real meters per world meter between places. Used only for displayed distances; a map is built at it. */
  readonly geoDistance: number;
}

export const SCALES: ScaleConfig = { altitude: 5, geoDistance: 25 };
