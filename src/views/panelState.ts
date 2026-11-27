import { magneticDeg } from './magnetic';
import { AP_CAPTURE_DEG, AP_CAPTURE_FT, AP_CAPTURE_KT, ALT_BUG_RIM_FT, ALT_LONG_FT, ASI_AMBER_MULT, ASI_ARC_MIN_KT, ASI_TABLE, HSI_DEV_PX, HSI_GS_PX, VS_MODE, type VsMode } from '../config/display';
import type { Tuning } from '../config/motion';
import type { ScaleConfig } from '../config/scales';
import { AP_FLOOR_MULT } from '../config/flight';
import { apActive, type Autopilot } from '../sim/state';
import { powerPct } from './format';
import { turnNeeded } from './headingBug';
import type { StallState } from '../sim/flight/aero';
import { spoilersOut } from '../sim/flight/ground';
import { levelStallSpeed } from '../sim/flight/vspeeds';
import type { Craft } from '../sim/state';
import { altimeterVerticalSpeedFpm, displayedAltitudeFt, indicatedSpeed, metersPerSecondToKnots, verticalSpeedFpm } from '../sim/units';
import { altimeterHands, quantizeDeg, tableAngle } from './gauges/dial';
import { vsiAngle } from './gauges/vsi';
import type { SpeedMark } from './gauges/airspeed';
import type { HsiApproach } from './gauges/hsi';
import { hsiDistance, type HsiGuide } from './hsiData';
import type { Callout } from './takeoffStrip';
import type { ConfigState } from './gauges/gearFlaps';
import type { Lights } from './gauges/lights';
import { readoutText, sameReadout, type ReadoutText } from './instruments';

/** Everything the panel draws, already quantized: equal states draw the same picture, so a redraw can be skipped. */
export interface PanelState {
  readonly text: ReadoutText;
  readonly crashed: boolean;
  readonly spdDeg: number;
  /** Stall arc ends in whole knots; both 0 when the arc is hidden. */
  readonly stallRedKt: number;
  readonly stallAmberKt: number;
  readonly altLongDeg: number;
  readonly altShortDeg: number;
  /** Altitude bug on the altimeter rim, null when hidden or more than ALT_BUG_RIM_FT away. */
  readonly altBugDeg: number | null;
  readonly pitchDeg: number;
  readonly bankDeg: number;
  /** Pitch minus path angle (the flight-path marker), null on the ground or after a crash. */
  readonly fpmDeg: number | null;
  readonly headingDeg: number;
  /** Heading bug, whole degrees, null when hidden. */
  readonly headingBug: number | null;
  readonly vsDeg: number;
  readonly vsMode: VsMode;
  /** Throttle lever and engine as the power dial reads them: whole numbers, N1_IDLE_PCT to 100. */
  readonly leverPct: number;
  readonly enginePct: number;
  readonly config: ConfigState;
  readonly lights: Lights;
  /** Speed bug on the airspeed dial while speed hold is on. */
  readonly spdBugDeg: number | null;
  /** Takeoff speeds on the airspeed dial (D5A), empty outside takeoff mode. */
  readonly speedMarks: readonly SpeedMark[];
  /** The takeoff call-out on screen, and whether it asks for gear up. */
  readonly callout: Callout | null;
  readonly gearPrompt: boolean;
  /** The selected approach on the HSI (D5D), null with no runway picked. */
  readonly hsi: HsiApproach | null;
}

export interface PanelInput {
  readonly stall: StallState;
  readonly braking: boolean;
  readonly gearWarn: boolean;
  readonly crashed: boolean;
  /** Heading bug (degrees) and altitude bug (displayed ft), or null while the bugs are hidden. */
  readonly headingBugDeg?: number | null;
  readonly altBugFt?: number | null;
  readonly vsMode?: VsMode;
  /** The terrain warning (D3), already false after a crash. */
  readonly terr?: boolean;
  /** The autopilot (D4): its lamps and the speed bug. */
  readonly autopilot?: Autopilot;
  readonly speedMarks?: readonly SpeedMark[];
  readonly callout?: Callout | null;
  readonly gearPrompt?: boolean;
  readonly approach?: HsiGuide | null;
  /** Magnetic variation here, degrees: added to every heading shown. `headingBugDeg` is already magnetic. */
  readonly variationDeg?: number;
}

let cacheKey = '';
let cacheValue = 0;

/** `levelStallSpeed` scans the polar, so keep the last answer keyed on what it depends on. */
export function cachedStallSpeed(tuning: Tuning, bank: number, flaps: number): number {
  const key = `${tuning.massT}|${tuning.stallDeg}|${tuning.flapLiftPct}|${flaps}|${Math.round((bank * 180) / Math.PI)}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cacheValue = levelStallSpeed(tuning, Math.round((bank * 180) / Math.PI) * (Math.PI / 180), flaps);
  }
  return cacheValue;
}

const hsiPixels = (g: HsiGuide, variationDeg: number): HsiApproach => ({
  courseDeg: quantizeDeg(magneticDeg(g.courseDeg, variationDeg)),
  bearingDeg: quantizeDeg(magneticDeg(g.bearingDeg, variationDeg)),
  barPx: Math.round(g.deviation * HSI_DEV_PX),
  glidePx: g.glide === null ? null : Math.round(g.glide * HSI_GS_PX),
  ident: g.ident,
  name: g.name,
  distance: hsiDistance(g.distanceM),
});

const sameHsi = (a: HsiApproach | null, b: HsiApproach | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.courseDeg === b.courseDeg && a.bearingDeg === b.bearingDeg && a.barPx === b.barPx && a.glidePx === b.glidePx && a.ident === b.ident && a.name === b.name && a.distance === b.distance);

export function buildPanelState(craft: Craft, scale: ScaleConfig, tuning: Tuning, input: PanelInput): PanelState {
  const kt = metersPerSecondToKnots(indicatedSpeed(craft, scale));
  const hidden = input.crashed || (craft.onGround && kt < ASI_ARC_MIN_KT);
  const stallKt = hidden ? 0 : metersPerSecondToKnots(cachedStallSpeed(tuning, craft.bank, craft.flaps));
  const altFt = displayedAltitudeFt(craft.z, scale);
  const hands = altimeterHands(altFt);
  const vsMode = input.vsMode ?? VS_MODE.mode;
  const bugFt = input.altBugFt ?? null;
  const toDeg = 180 / Math.PI;
  const ap = input.autopilot;
  const headingDeg = (((craft.heading * toDeg) % 360) + 360) % 360;
  const stallNowKt = metersPerSecondToKnots(cachedStallSpeed(tuning, craft.bank, craft.flaps));
  const targetKt = ap ? metersPerSecondToKnots(ap.targetIas) : 0;
  const floorOverrides = AP_FLOOR_MULT * stallNowKt > targetKt;
  const lamp = (on: boolean, captured: boolean): 'off' | 'amber' | 'green' => (!on ? 'off' : captured ? 'green' : 'amber');
  return {
    text: readoutText(craft, scale, input.stall, input.braking, input.gearWarn, vsMode, input.terr ?? false, input.variationDeg ?? 0),
    crashed: input.crashed,
    spdDeg: quantizeDeg(tableAngle(ASI_TABLE, kt)),
    stallRedKt: Math.round(stallKt / 2) * 2,
    stallAmberKt: Math.round((stallKt * ASI_AMBER_MULT) / 2) * 2,
    altLongDeg: quantizeDeg(hands.longDeg),
    altShortDeg: quantizeDeg(hands.shortDeg),
    altBugDeg: bugFt !== null && Math.abs(bugFt - altFt) <= ALT_BUG_RIM_FT ? quantizeDeg((((bugFt % ALT_LONG_FT) + ALT_LONG_FT) % ALT_LONG_FT / ALT_LONG_FT) * 360) : null,
    pitchDeg: quantizeDeg(craft.pitch * toDeg),
    bankDeg: quantizeDeg(craft.bank * toDeg),
    fpmDeg: craft.onGround || input.crashed ? null : quantizeDeg((craft.pitch - craft.pathAngle) * toDeg),
    headingDeg: quantizeDeg(magneticDeg(headingDeg, input.variationDeg ?? 0)),
    headingBug: input.headingBugDeg ?? null,
    vsDeg: quantizeDeg(vsiAngle(vsMode === 'altimeter' ? altimeterVerticalSpeedFpm(craft, scale) : verticalSpeedFpm(craft), vsMode)),
    vsMode,
    leverPct: powerPct(craft.lever),
    enginePct: powerPct(craft.spool),
    config: {
      flapLever: craft.flapLever,
      flaps: Math.round(craft.flaps * 40) / 40,
      gear: Math.round(craft.gear * 10) / 10,
      gearLever: craft.gearDown,
      brake: craft.onGround && input.braking,
      spoilers: craft.onGround && spoilersOut(craft.lever) && craft.speed > 1,
    },
    lights: { stall: input.crashed || input.stall === 'none' ? 'off' : input.stall, gear: !input.crashed && input.gearWarn, terr: !input.crashed && (input.terr ?? false),
      ap: !input.crashed && ap !== undefined && apActive(ap),
      hdg: lamp(!input.crashed && (ap?.hdg ?? false), ap !== undefined && Math.abs(turnNeeded(headingDeg, ap.headingTarget * toDeg)) < AP_CAPTURE_DEG),
      alt: lamp(!input.crashed && (ap?.alt ?? false), ap !== undefined && Math.abs(altFt - displayedAltitudeFt(ap.targetZ, scale)) < AP_CAPTURE_FT),
      spd: lamp(!input.crashed && (ap?.spd ?? false), !floorOverrides && Math.abs(kt - targetKt) < AP_CAPTURE_KT),
    },
    spdBugDeg: ap?.spd && !input.crashed ? quantizeDeg(tableAngle(ASI_TABLE, targetKt)) : null,
    speedMarks: input.speedMarks ?? [],
    callout: input.callout ?? null,
    gearPrompt: input.gearPrompt ?? false,
    hsi: input.approach ? hsiPixels(input.approach, input.variationDeg ?? 0) : null,
  };
}

const sameMarks = (a: readonly SpeedMark[], b: readonly SpeedMark[]): boolean =>
  a.length === b.length && a.every((m, i) => m.label === b[i]?.label && m.deg === b[i]?.deg && m.labelDeg === b[i]?.labelDeg && m.next === b[i]?.next);

export const samePanelState = (a: PanelState, b: PanelState): boolean =>
  sameMarks(a.speedMarks, b.speedMarks) &&
  sameHsi(a.hsi, b.hsi) &&
  a.callout === b.callout &&
  a.gearPrompt === b.gearPrompt &&
  a.crashed === b.crashed &&
  a.spdDeg === b.spdDeg &&
  a.stallRedKt === b.stallRedKt &&
  a.stallAmberKt === b.stallAmberKt &&
  a.altLongDeg === b.altLongDeg &&
  a.altShortDeg === b.altShortDeg &&
  a.altBugDeg === b.altBugDeg &&
  a.pitchDeg === b.pitchDeg &&
  a.bankDeg === b.bankDeg &&
  a.fpmDeg === b.fpmDeg &&
  a.headingDeg === b.headingDeg &&
  a.headingBug === b.headingBug &&
  a.vsDeg === b.vsDeg &&
  a.vsMode === b.vsMode &&
  a.leverPct === b.leverPct &&
  a.enginePct === b.enginePct &&
  a.config.flapLever === b.config.flapLever &&
  a.config.flaps === b.config.flaps &&
  a.config.gear === b.config.gear &&
  a.config.gearLever === b.config.gearLever &&
  a.config.brake === b.config.brake &&
  a.config.spoilers === b.config.spoilers &&
  a.lights.stall === b.lights.stall &&
  a.lights.gear === b.lights.gear &&
  a.lights.terr === b.lights.terr &&
  a.lights.ap === b.lights.ap &&
  a.lights.hdg === b.lights.hdg &&
  a.lights.alt === b.lights.alt &&
  a.lights.spd === b.lights.spd &&
  a.spdBugDeg === b.spdBugDeg &&
  sameReadout(a.text, b.text);
