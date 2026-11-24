/** Provisional C1 flight constants. Slider-tuned values are in motion.ts (Tuning). */
export const GRAVITY = 9.81;
/** Wing area, m2. */
export const WING_AREA = 70;
/** Sea-level air density, kg/m3. */
export const RHO0 = 1.225;
/** Exponent on the density ratio for thrust. */
export const THRUST_LAPSE = 0.7;
/** Largest lift coefficient the drag model uses. */
export const CL_CAP = 1.5;
/** Slow-flight placeholder, deleted in C2: equivalent airspeed (m/s) where the path limit is fully lowered. */
export const SAG_FULL = 45;
/** Equivalent airspeed (m/s) at and above which the placeholder does nothing. */
export const SAG_START = 60;
/** How far the path limit drops at SAG_FULL, degrees below level. */
export const SAG_DEG = 15;
/** Safety clamps on speed, m/s. */
export const SPEED_FLOOR = 20;
export const SPEED_CAP = 300;
/** Smallest dynamic pressure used when dividing, Pa. */
export const Q_FLOOR = 1;
