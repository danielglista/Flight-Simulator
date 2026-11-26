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
/** Pitch rate follows the key with this time constant, seconds. A longer lag gives the nose weight. */
export const PITCH_LAG = 0.3;
/**
 * Pitch key ramp (altitude-scale fix): the commanded rate starts at PITCH_RAMP_MIN of the full rate and grows
 * with the square of the hold time, reaching full after PITCH_RAMP_S seconds. A tap is a small nudge; a hold is a full pull.
 */
export const PITCH_RAMP_S = 1.2;
export const PITCH_RAMP_MIN = 0.12;
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

/** C4. Ground roll. Rolling friction coefficients (paved, grass). */
export const ROLL_MU = 0.02;
export const GRASS_MU = 0.12;
/** Steering: turning radius when slow (m), fastest turn (deg/s), and the most sideways acceleration (m/s2) that sets the rate when fast. */
export const STEER_RADIUS = 15;
export const STEER_MAX_DEG = 20;
export const STEER_LATERAL = 3;
/** Nose authority on the ground: equivalent airspeed (m/s) with none and with full. */
export const GROUND_AUTH_ZERO = 35;
export const GROUND_AUTH_FULL = 55;
/** The nose comes down at up to NOSE_FALL_DEG per second as authority is lost; from above the tail limit it eases down at NOSE_FALL_MAX_DEG. */
export const NOSE_FALL_DEG = 6;
export const NOSE_FALL_MAX_DEG = 10;
/** Highest nose attitude while on the wheels: a stop, below the stall. */
export const TAIL_LIMIT_DEG = 11;
/** Bank eases to level on the ground with this time constant, seconds. */
export const GROUND_BANK_TAU = 0.3;
/** Liftoff when lift (plus thrust up) exceeds weight by this factor; the craft is then raised this many world m. */
export const LIFTOFF_MARGIN = 1.01;
export const LIFTOFF_CLEAR = 0.05;
/** C5. Touchdown limits: bank (deg) and pitch range (deg) at contact. The sink limit is the `touchdownSinkMs` slider. */
export const TD_BANK_DEG = 15;
export const TD_PITCH_MIN_DEG = -3;
export const TD_PITCH_MAX_DEG = 16;
/** A touchdown within this many seconds of a liftoff that followed an earlier touchdown keeps the larger sink. */
export const SKIP_S = 5;
/** Extra braking friction on grass (the paved value is the `brakePct` slider). */
export const GRASS_BRAKE_MU = 0.2;
/** Automatic ground spoilers: out while on the ground with the lever at or below SPOILER_LEVER. Lift is multiplied, drag gains SPOILER_CD. */
export const SPOILER_LEVER = 0.1;
export const SPOILER_LIFT = 0.3;
export const SPOILER_CD = 0.06;
/** Landed once stopped below this speed (m/s); the landing banner hides when the plane rolls above LANDED_HIDE_SPEED. */
export const LANDED_SPEED = 0.5;
export const LANDED_HIDE_SPEED = 2;

/** The engine fraction (0..1; N1 40 on the power dial) marked as stable: past the worst of the slow range. */
export const SPOOL_STABLE = 0.25;
/** Spool-up lag eases from `spoolIdleTauS` at idle to the normal `spoolTauS` at this engine fraction (N1 52). */
export const SPOOL_FULL_RESPONSE = 0.4;
/** C4B. Gear takes this long to travel fully up or down, seconds. */
export const GEAR_TIME_S = 3;
/** Rotation and initial-climb speeds as multiples of the (indicated) stall speed. Calibrated by flying, never by changing the formula. */
export const VR_MULT = 1.05;
export const V2_MULT = 1.2;

/** C6. Flaps: stall angle drops by FLAP_STALL_DEG at full flaps; the nose is compensated by FLAP_COMP of the lift change; full travel time (s). */
export const FLAP_STALL_DEG = 1.5;
export const FLAP_COMP = 0.8;
export const FLAP_TIME_S = 6;
/** Gear warning: below this height above ground (world m) and indicated speed (m/s), gear not down, descending. */
export const GEAR_WARN_AGL = 60;
export const GEAR_WARN_IAS = 85;

/** Terrain warning (D3): looks this far ahead along the velocity (s), in steps of this many world m, and warns when a point is within TERR_CLEAR_M of the ground. */
export const TERR_LOOK_S = 8;
export const TERR_STEP_M = 30;
export const TERR_CLEAR_M = 10;

/**
 * Autopilot (D4). Altitude: follows a path toward the target over ALT_TAU_S, limited to AP_UP_DEG up and AP_DOWN_DEG down;
 * the climb limit fades from 0 at AP_CLIMB_FADE[0] to full at [1] times the stall speed. The nose goes to path plus the angle of
 * attack the lift budget needs, at a gain of 1 per AP_PITCH_GAIN_DEG of error. Heading: bank AP_HDG_GAIN per radian of error, up to AP_BANK_DEG.
 * Speed: lever rate share of AP_SPD_GAIN per m/s of error minus AP_SPD_DAMP per m/s2 of acceleration; the target is never below AP_FLOOR_MULT times the stall speed.
 */
export const ALT_TAU_S = 6;
export const AP_UP_DEG = 5;
export const AP_DOWN_DEG = 4;
export const AP_PITCH_GAIN_DEG = 3;
export const AP_HDG_GAIN = 1.5;
export const AP_BANK_DEG = 25;
export const AP_ROLL_GAIN = 1.0;
export const AP_SPD_GAIN = 0.08;
export const AP_SPD_DAMP = 0.5;
export const AP_FLOOR_MULT = 1.25;
export const AP_CLIMB_FADE: readonly [number, number] = [1.1, 1.2];
/** Speed target range, indicated m/s. */
export const AP_IAS_MIN = 30;
export const AP_IAS_MAX = 150;

/**
 * Stability (D4): the autopilot refuses to engage past the `stable` limits and lets go past the `danger` ones, so it
 * cannot flicker at an edge. Heights are world m above ground, angles degrees, speeds multiples of the level stall speed.
 * With the gear not up it also needs GEAR_AGL_M of height; that equals TAKEOFF_HUD_AGL_M (tests keep them equal).
 */
export const STABLE_AGL_M = 45;
export const DANGER_AGL_M = 30;
export const GEAR_AGL_M = 150;
export const STABLE_BANK_DEG = 30;
export const DANGER_BANK_DEG = 45;
export const STABLE_PITCH_DEG = 15;
export const DANGER_PITCH_DEG = 25;
export const STABLE_SLOW_MULT = 1.15;
export const DANGER_SLOW_MULT = 1.05;
/** Steps of unbroken stability before it engages (0.5 s). */
export const STABLE_TICKS = 30;
