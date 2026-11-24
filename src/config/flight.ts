/** Provisional flight constants. Slider-tuned values are in motion.ts (Tuning). */
export const GRAVITY = 9.81;
/** Wing area, m2. */
export const WING_AREA = 70;
/** Sea-level air density, kg/m3. */
export const RHO0 = 1.225;
/** Exponent on the density ratio for thrust. */
export const THRUST_LAPSE = 0.7;
/** Safety clamps on speed, m/s. */
export const SPEED_FLOOR = 20;
export const SPEED_CAP = 300;
/** Smallest dynamic pressure used when dividing, Pa. */
export const Q_FLOOR = 1;

/** Lift coefficient at zero angle of attack, and its slope per radian (C2). */
export const CL0 = 0.25;
export const CL_ALPHA = 5.2;
/** Width of the stall (degrees from attached to separated), and the center of the negative stall. */
export const STALL_WIDTH_DEG = 5;
export const STALL_NEG_DEG = 13;
/** Fully separated flow: flat-plate lift and drag coefficients. */
export const CL_PLATE = 1.1;
export const CD_PLATE = 2.0;
/** Net on the path angle, degrees. The nose is held to PITCH_MAX_CMD_DEG. */
export const PATH_LIMIT_DEG = 80;
export const PITCH_MAX_CMD_DEG = 30;
/** Pitch rate follows the key with this time constant, seconds. */
export const PITCH_LAG = 0.15;
/** Pitch authority: equivalent airspeed (m/s) with none (floor), with full, and the floor value. */
export const AUTH_ZERO = 30;
export const AUTH_FULL = 55;
export const AUTH_MIN = 0.2;
/** Arcade allowance, not a structural limit: nose-up fades out between LOAD_MAX - LOAD_FADE and LOAD_MAX g; nose-down fades toward LOAD_MIN g. */
export const LOAD_MAX = 4;
export const LOAD_FADE = 1.5;
export const LOAD_MIN = -1;
/** Height range over which the soft ceiling turns the path level, world m per radian. */
export const CEILING_SOFT_M = 100;
/** Fastest the soft ceiling lowers the nose, degrees per second, so it never snaps. */
export const CEILING_NOSE_RATE_DEG = 20;
/** Warning starts this many degrees before the stall center; stalled once separation reaches STALLED_AT. */
export const WARN_MARGIN_DEG = 3;
export const STALLED_AT = 0.4;

/** C3. Cosine floor in the heading rate, bank limit, and cap on turn help (degrees). */
export const COS_FLOOR = 0.2;
export const BANK_MAX_DEG = 60;
/** C3B. Roll rate follows the key with this time constant, seconds. */
export const ROLL_LAG_S = 0.5;
/** C3B. Wings level asks for this roll rate per radian of bank, per second (capped at the roll rate). */
export const LEVEL_GAIN = 1.0;
export const TURN_HELP_CAP_DEG = 4;
