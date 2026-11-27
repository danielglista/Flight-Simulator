import { GEAR_UP_AT, TAKEOFF_HUD_AGL_M } from '../../config/display';
import { TERR_CLEAR_M, TERR_LOOK_S, TERR_OBSTACLE_STEP_M, TERR_STEP_M } from '../../config/flight';
import type { Craft } from '../state';
import type { ObstacleFn } from '../world/obstacles';

/**
 * True when flying straight along the current velocity would put the plane within TERR_CLEAR_M of the ground or a roof inside
 * TERR_LOOK_S. Straight on purpose: in a turn it can warn late or falsely. Off on the ground, after a crash, and
 * while configured for takeoff or landing (gear not up, under TAKEOFF_HUD_AGL_M above ground), where the ground is meant to be close.
 */
export function terrainAhead(craft: Pick<Craft, 'x' | 'y' | 'z' | 'heading' | 'speed' | 'pathAngle' | 'onGround' | 'gear'>, heightAt: (x: number, y: number) => number, crashed = false, obstacleAt?: ObstacleFn): boolean {
  if (crashed || craft.onGround) return false;
  if (craft.z - heightAt(craft.x, craft.y) < TAKEOFF_HUD_AGL_M && craft.gear > GEAR_UP_AT) return false;
  const ground = Math.cos(craft.pathAngle) * craft.speed;
  const climb = Math.sin(craft.pathAngle) * craft.speed;
  const steps = Math.max(1, Math.ceil((craft.speed * TERR_LOOK_S) / TERR_STEP_M));
  // Buildings are narrower than the terrain step, so they are looked for in between as well.
  const parts = obstacleAt ? Math.ceil(TERR_STEP_M / TERR_OBSTACLE_STEP_M) : 1;
  for (let i = 1; i <= steps * parts; i++) {
    const t = (TERR_LOOK_S * i) / (steps * parts);
    const x = craft.x + Math.sin(craft.heading) * ground * t;
    const y = craft.y + Math.cos(craft.heading) * ground * t;
    const z = craft.z + climb * t;
    const clear = z - TERR_CLEAR_M;
    if (i % parts === 0 && heightAt(x, y) >= clear) return true;
    if (obstacleAt && obstacleAt(x, y, z) >= clear) return true;
  }
  return false;
}
