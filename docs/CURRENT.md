# Current behavior

What the game does **right now**, and which file owns it. Plans in `docs/*_PLAN.md` are history; if one disagrees with this file or the code, this file and the code win.

**Update this file at the end of every step** (part of "done when"). Keep it short: behavior and ownership, not design reasons.

**State:** end of C3 plus C3B (turn handling). Last checked against code with 353 tests and typecheck passing. Next: C4 (takeoff and ground roll).

## What you can do

| Input | Effect | Owner |
|---|---|---|
| A / D | Roll left / right: the roll rate builds toward 20 deg/s (tunable) with a 0.5 s lag, so a tap is a small bank and a hold a full roll, to at most 60 deg. A released bank stays (no self-leveling) | `input/keyState.ts`, `sim/flight/attitude.ts`, `config/motion.ts` |
| Space | Wings level: one press rolls the bank to exactly 0 and stops (latched, not hold). A or D cancels it | `input/keyState.ts`, `sim/flight/attitude.ts` |
| `[` / `]` | Heading bug left / right 5 deg (Shift: 1 deg), repeats while held | `input/keyboard.ts`, `views/headingBug.ts` |
| `-` / `=` | Altitude bug down / up 100 ft (Shift: 10 ft), repeats while held | `input/keyboard.ts`, `views/altitudeBug.ts` |
| Q / E | Move the throttle lever down / up, 50% per s (tunable); it stays where left. The engine follows with a lag (1.2 s time constant) | same |
| S / W | Nose up / down at 10 deg/s (tunable); the nose stays where released. Raising it trades speed for height; too much angle of attack stalls | same |
| Backquote (`) | Show / hide the debug panel (over the comms terminal), running or paused | `input/keyboard.ts`, `app/debugPanel.ts` |
| P | Pause / resume (also pauses on window blur or hidden tab, and stays paused on return) | `input/keyboard.ts`, `app/pause.ts` |
| C | Recenter the top-view camera on the plane | `main.ts`, `views/followCamera.ts` |
| Enter | After a crash, restart at the start position. Ignored otherwise, and ignored on a focused button | `input/keyboard.ts` (`actionFor`), `sim/step.ts` |
| Top-view click | Place the plane there, at least 20 m above ground | `input/mapPointer.ts` |
| Top-view drag / wheel | Pan (leaves follow mode) / zoom | `input/mapPointer.ts`, `views/followCamera.ts` |
| Side-view drag / wheel | Rotate heading / zoom | `input/sidePointer.ts`, `views/sideCamera.ts` |

Held keys steer; keys are physical positions (`event.code`). Text fields never steer; range sliders, buttons and checkboxes are not text fields (`isTextEntry`), so flight keys still work after touching a slider.

## Simulation (`src/sim/`, headless)

- **State** (`state.ts`): `tick`, `craft` {x, y, z, heading, speed, pathAngle, pitch, pitchRate, bank, rollRate, lever, spool}, `controls` {turn, throttle, pitch, level}, `crash`, `tuning`. All `readonly`. `pitch` (nose) and `pathAngle` (direction of travel) are separate; angle of attack is `pitch - pathAngle`. Start: (2000, 2000), z 100 m, heading 45 deg, 90 m/s, pitch 5.38 deg, lever and engine 32% (level trim; a test recomputes it). These are in `config/motion.ts`.
- **Step** (`step.ts`): `applyCommands` then `advance`, one 1/60 s step each. Order inside `advance`: lever and engine, bank and turn help, pitch, forces (new pitch and bank, old path), path angle (clamped to +/-80 deg), soft ceiling, heading, speed (using the new path), then x/y/z (average speed, so energy is conserved exactly with no engine and no drag below separation). Position is clamped to the map; z is capped at the 600 m ceiling.
- **Commands** (`commands.ts`) are the only way in: `turn` (roll; a non-zero value cancels wings level), `level`, `throttle`, `pitch`, `restart`, `tune`, and the pointer/test tools `place`, `rotate`. `place` and `rotate` are ignored while crashed and keep pitch and bank.
- **Tuning** (`config/motion.ts`): roll rate, turn multiplier, turn help limit, pitch rate, stall angle, stall nose drop, lever rate, engine spool, max thrust, mass, parasite and induced drag. `tune` clamps to the range, ignores unknown keys and non-finite values, works while crashed, and survives restart. A page reload resets it.
- **Crash** (`contact.ts`): contact is `z <= heightAt(x, y)`, checked along the step in pieces of at most 0.5 m. On contact the craft stops on the ground, pitch and bank freeze, `pitchRate` and `rollRate` become 0, wings level is cleared, `crash` is set, and only `tick` advances. Every touch is a crash, runways included.
- **Aerodynamics** (`sim/flight/aero.ts`, constants in `config/flight.ts`): `Cl` and `Cd` from angle of attack, smoothly blending a linear polar into a flat plate across the stall (center `stallDeg`, 5 deg wide; negative stall at -13 deg). `stallState` gives `none` / `warning` (3 deg before the center) / `stalled` (separation 0.4). `liftAngle` gives the angle for a load factor.
- **Forces** (`sim/flight/forces.ts`): `forcesOn` gives thrust, lift, drag, load factor, dV/dt, dPath/dt and dHeading/dt; the step and the debug panel both use it. Density falls with real height (`altitudeScale`), thrust falls as density^0.7. Speed is clamped to 20..300 m/s as a safety net.
- **Attitude** (`sim/flight/attitude.ts`): S/W command a pitch rate (0.15 s ramp); the nose holds where released and the path settles toward it. Authority falls below about 55 m/s equivalent airspeed. While separated the nose drops by itself and nose-up stops working. A/D command a roll rate that follows through a 0.5 s lag (`ROLL_LAG_S`); a released bank holds at any size. Space (wings level) rolls toward zero bank at a rate of 1 per second per radian of bank (`LEVEL_GAIN`), capped at the roll rate, and stops at exactly 0 without crossing it. Turn help adds up to 4 deg of nose-up with the bank, to 30 deg of bank. Heading changes by `turnMult x lift x sin(bank)`; `turnMult` never changes energy.
- **Soft ceiling**: the path is turned level as z nears 600 m (nose lowered at most 20 deg/s); no energy added or removed.
- **World** reaches the sim as `SimWorld` (`width`, `height`, `heightAt`, `altitudeScale`). Real map code lives in `sim/world/`.
- **Simplifications, on purpose:** no ground roll or rotation (C4), no flaps, gear or brakes (C6), no wind, no spins or structural damage. Trim changes with mass, so the mass slider makes the plane climb or sink.

## App loop (`src/app/`)

- `loop.ts`: fixed 60 Hz stepper (`stepper.ts`, at most 5 steps per frame, extra time dropped). Keys are sampled only on frames that step. The loop owns the only copy of `SimState`; views get an interpolated `snapshot()` between the last two steps.
- Pause drops queued commands and clears held keys. While paused, `send` applies commands immediately and redraws. `tune` is applied at once even while running. `onFrame(elapsedS)` reports real frame intervals (not the first frame or the first after a resume).
- `crashBanner.ts`: shows `CRASHED: <what>, <altitude> ft - Enter to restart`, the same feet as `ALT`.
- `debugPanel.ts`: sliders for each `Tuning` value (read back from `loop.state.tuning`), Reset, flight state (pitch, path, angle of attack, bank, roll rate, turn rate, level stall speed at this bank, stall state and separation, lift and load factor, true and indicated speed, lever, engine, thrust, drag, weight, dV/dt, density, energy height), scales, and frame timing over the last 300 frames (`frameStats.ts`; interval, top, side and total draw). Timing records while the panel is hidden. Text refreshes at 4 Hz.

## Views (`src/views/`, read-only)

- **Top view**: terrain, airport overlay, plane marker, a dashed turn line (as long on screen as the compass ring's radius at any zoom, so it ends at the heading bug; at the current speed and turn rate, tick every 2 s of flight; `views/turnLine.ts`, tuned in `config/display.ts`), and, while following, a compass ring around the plane (turns with the map, ticks every 10 deg, labels every 30) with the heading bug on it, a faint line to the bug, a `BUG 270  L 45` text line, and a bar across the turn line where it reaches the bug. The bug is view state in `main.ts` (arithmetic in `views/headingBug.ts`), starts at the plane's heading, and is not saved with the sim. Hidden in free look. edge arrow when the plane is off screen. Camera follows the plane and rotates so its heading is always up (`followCamera.ts`, `camera.ts`); a north arrow in the corner shows where north is. Panning (free look) keeps the orientation it had.
- **Top view depth cues (C3D)**: a black plane shadow falls southeast in the world (turns with the map) and separates from the plane with height above ground (0.4 px per world m, cap 40 px), fading out between 100 and 250 m AGL, none after a crash; a pale haze veil over the terrain (not airports) rises to 35% alpha at the ceiling; the plane sprite steps through 4 sizes up to 1.4 times at the ceiling (`views/depth.ts`, size tiers in `views/sprite.ts`). All constants and the `DEPTH_FX` switches are in `config/display.ts`. Clouds (built but OFF: `DEPTH_FX.clouds` is false in `config/display.ts` until they are reworked): a static layer at 250 m (world) drawn over the terrain and airports from one seamless noise tile (`views/cloudTile.ts`, 3000 m per tile), scaled about the view center by their height so they slide past the ground as you climb; faint (alpha 0.25) while under the base so low flight stays clear, 0.6 above it, with soft southeast cloud shadows on the ground that fade the same way. Banded terrain parallax was tried and shelved (`docs/C3D_PLAN.md`).
- **Side view**: terrain profile along the heading, plane sprite at the nose pitch (25 frames, -30 to +30 deg), and a short dim line from the plane along its path angle (the gap is the angle of attack; hidden when crashed), wreck sprite after a crash. Scrolls vertically only when the plane climbs above about 40% of panel height (`sideCamera.ts`). At the closest zoom above about 400 m no ground is visible; zoom out.
  - **Altitude bug**: a cyan dashed line across the view at the bug altitude (displayed feet, same as `ALT`), a short bar on it where the current path line reaches it, and `^` / `v ALT BUG` text when it is off screen. On the right, an altitude tape magnified far past the main scale (0.4 px per ft, so 10 ft is 4 px; about +/-300 ft): ticks every 10 / 50 / 100 ft, the plane's altitude at the middle (yellow pointer), the bug as a cyan bar (clamped to the edge when far off), a yellow trend bar for where altitude will be in 10 s at the current climb rate, and the feet still to climb (`+400 ft`) underneath. The bug is view state in `main.ts`, starts at the plane's altitude to the nearest 100 ft, is kept to 10 ft steps within 0..20000 ft, and is hidden after a crash. Arithmetic in `views/altitudeBug.ts`, constants `ALT_*` in `config/display.ts`.
  - **Slope shading (C3E)**: terrain columns are lighter where the ground rises to the right and darker where it falls (light from the left), strongest on the skin and snow, weaker on the body; flat ground and water are unchanged. `views/sideLayers.ts` (`slopeShade`), constants `SLOPE_*` in `config/display.ts`, switch `SIDE_FX.slopeShade`.
  - **Background layers** come from `SIDE_LAYERS` (`config/display.ts`). Parallax (`sliceWindow` factor `k`, on) makes far layers scroll slower; an optional (off by default) dark, 85%-alpha foreground (`SIDE_FOREGROUND`, 250 to 120 m to the viewer's side, k = 1.3) is drawn over the plane and the plumb line, with a faint ghost of the plane and path line on top when the foreground rises over them (`SIDE_FX.foreground`, and the Side foreground checkbox in the debug panel); it is not part of the readout or collision. Lane bands (`envelope`, on) draw each layer as the highest point over a strip of 3 to 4 parallel lines, so ridges stop popping in and out. Layers are not at their true distance ahead once parallax is on; the cursor readout stays on the main profile.
- Sprites: `views/sprite.ts`, shapes in `config/planeShape.ts`. Colors in `config/palette.ts`.
- **Instruments panel** (`views/instruments.ts`, units in `sim/units.ts`, text in `views/format.ts`): 3 x 3 cells: `SPD` kt (indicated airspeed), `ALT`, `V/S`, `HDG`, `PIT` deg (signed), `BNK` (`L 30`, `0`, `R 30`), `THR` and `ENG` % (D3 replaces the text), and a warning cell: `STALL` amber (warning) or in a red box (stalled), none when crashed;  `ALT` ft (displayed, nearest 10), `HDG`, `V/S` ft/min (nearest 50, unscaled, so it disagrees with how fast `ALT` changes; D2 decides). Redrawn only when a string changes. A hidden line gives screen readers the values at most 4 times a second. Map and scale ticks in the views stay in meters.

## The map

- Hand-made test map (`sim/world/testMap.ts`): 512 x 512 cells at 10 m (5.12 km square), a 181.6 m peak NE of the start (the start heading points at it, so doing nothing crashes in about 20 s), a lake, a river, a town, a level area holding one test airport with an angled runway (`testAirport.ts`, `placeAirports.ts`).
- Scales (`config/scales.ts`): altitude 10 (real m per world m), airport 2. Horizontal scale is not used yet (E1).

## Not built yet

Scale sliders (E1/E4), takeoff and ground roll (C4), landing and runway rules (C5), instruments (D), real map data (E), terminal, ATC and LLM (F), weather and traffic (G), audio (H).

## Checks still owed

Live, in a full-size visible window: real-time feel of climb and settle, both views agreeing on the crash point, banner stacking with pause, Enter on a focused Resume button, shimmer while scrolling, B2's real-frame timing (the debug panel now measures it), and B4's manual checks in `B4_PLAN.md` §13, C1's manual flights (`C1_PLAN.md` §9, §13), and C2/C3's (`C2_C3_PLAN.md` §9): held-key flights of every row in §2 (stall and recovery, 30 and 60 deg turns), feel questions, pause/crash/restart in a bank and a stall. Listed in `B2_PLAN.md` and `B3_PLAN.md` §14.
