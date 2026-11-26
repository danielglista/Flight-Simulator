import { CEILING_NOSE_RATE_DEG, CL_ALPHA, FLAP_COMP, CEILING_SOFT_M, GRAVITY, PATH_LIMIT_DEG, SKIP_S, SPEED_CAP, SPEED_FLOOR, TD_PITCH_MAX_DEG } from '../../config/flight';
import { CEILING_Z, STEP_HZ, STEP_S } from '../../config/motion';
import { wrapHeading } from '../angles';
import { sweepContact } from '../contact';
import type { SimState } from '../state';
import type { SimWorld } from '../step';
import { liftAngle } from './aero';
import type { ApOutput } from './autopilot';
import { stepBank, stepPitch, turnHelp } from './attitude';
import { densityRatio, forcesOn, stepEngine } from './forces';
import { gearLocked, stepGear } from './gear';
import { stepFlaps } from './wing';
import { touchdownCheck } from './ground';

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Exactly one 1/60 s step in the air: lever and engine, bank and turn help, nose pitch, forces (new pitch, old
 * path), path angle, ceiling, heading, speed (using the new path), then position. `ap` (D4) replaces the keys on the axes it names. Contact with the ground runs the
 * touchdown check (C5): a landing puts the plane on its wheels, anything else is a crash with a cause.
 */
export function stepAir(state: SimState, world: SimWorld, ap: ApOutput | null = null): SimState {
  const { craft, controls, tuning } = state;
  const { lever, spool } = stepEngine(craft, ap?.throttle ?? controls.throttle, tuning, STEP_S);
  const gear = stepGear(craft.gear, craft.gearDown, STEP_S);
  const flaps = stepFlaps(craft.flaps, craft.flapLever, STEP_S);
  const sigma0 = densityRatio(craft.z, world.altitudeScale);
  const roll = stepBank(
    { bank: craft.bank, rollRate: craft.rollRate, key: ap?.roll ?? controls.turn, level: ap?.roll != null ? false : controls.level, speed: craft.speed, sigma: sigma0 },
    tuning,
    STEP_S,
  );
  const bank = roll.bank;
  const rollRate = roll.rollRate;
  const nextControls = roll.level === controls.level ? controls : { ...controls, level: roll.level };
  // Turn help is fed in as the bank changes, so there is one pitch value and rolling out gives it back.
  const help = turnHelp(bank, craft.speed, sigma0, tuning) - turnHelp(craft.bank, craft.speed, sigma0, tuning);

  // Flap nose compensation, fed in as the flaps move like turn help, so there is one pitch value and retracting gives it back.
  const flapComp = (FLAP_COMP * (flaps - craft.flaps) * (tuning.flapLiftPct / 100)) / CL_ALPHA;

  const before = forcesOn(craft, tuning, world.altitudeScale);
  const attitude = stepPitch(
    {
      pitch: craft.pitch + help - flapComp,
      pitchRate: craft.pitchRate,
      hold: craft.pitchHold,
      key: controls.pitch,
      direct: ap?.pitch ?? null,
      speed: craft.speed,
      sigma: before.sigma,
      alpha: before.alpha,
      separation: before.separation,
      loadFactor: before.loadFactor,
    },
    tuning,
    STEP_S,
  );
  let pitch = attitude.pitch;
  const pitchRate = attitude.pitchRate;
  const pitchHold = attitude.hold;

  const f = forcesOn({ ...craft, pitch, bank, lever, spool, gear, flaps }, tuning, world.altitudeScale);
  const pathLimit = PATH_LIMIT_DEG * DEG;
  let pathAngle = clamp(craft.pathAngle + f.dPathDt * STEP_S, -pathLimit, pathLimit);

  // Soft ceiling: near the top the path is turned level, so energy is redirected, never added or removed.
  const ceilingPath = (CEILING_Z - craft.z) / CEILING_SOFT_M;
  if (pathAngle > ceilingPath) {
    pathAngle = Math.max(ceilingPath, 0);
    const target = pathAngle + liftAngle(1 / Math.cos(bank), craft.speed, f.sigma, tuning, flaps);
    pitch = Math.min(pitch, Math.max(target, craft.pitch - CEILING_NOSE_RATE_DEG * DEG * STEP_S));
  }

  const heading = wrapHeading(craft.heading + f.dHeadingDt * STEP_S);
  const speed = clamp(craft.speed + (f.along - GRAVITY * Math.sin(pathAngle)) * STEP_S, SPEED_FLOOR, SPEED_CAP);
  const avg = (craft.speed + speed) / 2;

  const ground = avg * Math.cos(pathAngle) * STEP_S;
  const x = clamp(craft.x + Math.sin(heading) * ground, 0, world.width);
  const y = clamp(craft.y + Math.cos(heading) * ground, 0, world.height);
  let z = craft.z + avg * Math.sin(pathAngle) * STEP_S;
  if (z >= CEILING_Z) {
    z = CEILING_Z;
    if (pathAngle > 0) pathAngle = 0;
  }

  const tick = state.tick + 1;
  const contact = sweepContact(world.heightAt, craft, { x, y, z }, world.obstacleAt);
  if (contact) {
    const { building, ...hit } = contact;
    const kind = world.groundKind(hit.x, hit.y);
    let sink = Math.max(0, -speed * Math.sin(pathAngle));
    // A skip (touchdown, liftoff, touchdown within SKIP_S) keeps the larger sink, so it cannot hide a hard arrival.
    const prevTd = state.touchdown;
    if (
      prevTd &&
      state.liftoffTick !== null &&
      prevTd.tick <= state.liftoffTick &&
      state.liftoffTick - prevTd.tick <= SKIP_S * STEP_HZ &&
      tick - state.liftoffTick <= SKIP_S * STEP_HZ
    ) {
      sink = Math.max(sink, prevTd.sink);
    }
    // A building is never a landing, whatever the ground around it is.
    const cause = building ? 'building' : touchdownCheck({ rough: kind === 'rough', gearLocked: gearLocked({ gear }), sink, bank, pitch }, tuning);
    const clearedControls = nextControls.level ? { ...nextControls, level: false } : nextControls;
    if (cause === null && kind !== 'rough') {
      return {
        ...state,
        tick,
        craft: {
          ...craft,
          ...hit,
          heading,
          speed: speed * Math.cos(pathAngle),
          pathAngle: 0,
          pitch: clamp(pitch, 0, TD_PITCH_MAX_DEG * DEG),
          pitchRate: 0,
          pitchHold: 0,
          bank,
          rollRate: 0,
          lever,
          spool,
          onGround: true,
          gear,
          flaps,
        },
        controls: clearedControls,
        touchdown: { tick, x: hit.x, y: hit.y, heading, sink, speed, bank, pitch, kind },
      };
    }
    return {
      ...state,
      tick,
      craft: { ...craft, ...hit, heading, speed: 0, pathAngle, pitch, pitchRate: 0, bank, rollRate: 0, lever: 0, spool: 0, onGround: false, gear, flaps },
      controls: clearedControls,
      crash: { tick, speed, pathAngle, cause: cause ?? 'terrain', sink },
    };
  }
  return { ...state, tick, craft: { ...craft, x, y, z, heading, speed, pathAngle, pitch, pitchRate, pitchHold, bank, rollRate, lever, spool, onGround: false, gear, flaps }, controls: nextControls };
}
