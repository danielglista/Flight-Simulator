# Current behavior

What the game does **right now**, and which file owns it. Plans in `docs/*_PLAN.md` are history; if one disagrees with this file or the code, this file and the code win.

**Update this file at the end of every step** (part of "done when"). Keep it short: behavior and ownership, not design reasons.

**State:** end of B4 (readouts, debug panel, live tuning). Last checked against code with 222 tests and typecheck passing. Next: C1 (thrust, drag, weight).

## What you can do

| Input | Effect | Owner |
|---|---|---|
| A / D | Turn left / right, 30 deg/s (tunable) | `input/keyState.ts`, `config/motion.ts` |
| Q / E | Throttle down / up, 40 m/s per s, speed 0 to 150 m/s | same |
| S / W | Climb / descend: flight path tilts toward +15 / -15 deg at 20 deg/s | same |
| Backquote (`) | Show / hide the debug panel (over the comms terminal), running or paused | `input/keyboard.ts`, `app/debugPanel.ts` |
| P | Pause / resume (also pauses on window blur or hidden tab, and stays paused on return) | `input/keyboard.ts`, `app/pause.ts` |
| C | Recenter the top-view camera on the plane | `main.ts`, `views/followCamera.ts` |
| Enter | After a crash, restart at the start position. Ignored otherwise, and ignored on a focused button | `input/keyboard.ts` (`actionFor`), `sim/step.ts` |
| Top-view click | Place the plane there, at least 20 m above ground | `input/mapPointer.ts` |
| Top-view drag / wheel | Pan (leaves follow mode) / zoom | `input/mapPointer.ts`, `views/followCamera.ts` |
| Side-view drag / wheel | Rotate heading / zoom | `input/sidePointer.ts`, `views/sideCamera.ts` |

Held keys steer; keys are physical positions (`event.code`). Text fields never steer; range sliders, buttons and checkboxes are not text fields (`isTextEntry`), so flight keys still work after touching a slider.

## Simulation (`src/sim/`, headless)

- **State** (`state.ts`): `tick`, `craft` {x, y, z, heading, speed, pathAngle}, `controls` {turn, throttle, pitch}, `crash`, `tuning`. All `readonly`. Start: map center (2560, 2560), z 100 m, heading 45 deg, 60 m/s. These are in `config/motion.ts`, which also holds all rates and limits.
- **Step** (`step.ts`): `applyCommands` then `advance`, one 1/60 s step each. Order inside `advance`: speed, heading, pathAngle, then x/y/z. Position is clamped to the map; z is capped at the 600 m ceiling.
- **Commands** (`commands.ts`) are the only way in: `turn`, `throttle`, `pitch`, `restart`, `tune`, and the pointer/test tools `place`, `rotate`. `place` and `rotate` are ignored while crashed.
- **Tuning** (`config/motion.ts`: `Tuning`, `DEFAULT_TUNING`, `TUNING_RANGES`): turn rate, throttle rate, top speed, climb limit, path rate. `tune` clamps to the range, ignores unknown keys and non-finite values, works while crashed, and survives restart. A page reload resets it.
- **Crash** (`contact.ts`): contact is `z <= heightAt(x, y)`, checked along the step in pieces of at most 0.5 m. On contact the craft stops on the ground, `crash` is set, and only `tick` advances. Every touch is a crash, runways included.
- **World** reaches the sim as `SimWorld` (`width`, `height`, `heightAt`). Real map code lives in `sim/world/`.
- **Simplifications, on purpose until phase C:** throttle sets speed directly; climbing does not change speed; no lift, drag, stall or weight.

## App loop (`src/app/`)

- `loop.ts`: fixed 60 Hz stepper (`stepper.ts`, at most 5 steps per frame, extra time dropped). Keys are sampled only on frames that step. The loop owns the only copy of `SimState`; views get an interpolated `snapshot()` between the last two steps.
- Pause drops queued commands and clears held keys. While paused, `send` applies commands immediately and redraws. `tune` is applied at once even while running. `onFrame(elapsedS)` reports real frame intervals (not the first frame or the first after a resume).
- `crashBanner.ts`: shows `CRASHED: <what>, <altitude> ft - Enter to restart`, the same feet as `ALT`.
- `debugPanel.ts`: sliders for each `Tuning` value (read back from `loop.state.tuning`), Reset, flight state, scales, and frame timing over the last 300 frames (`frameStats.ts`; interval, top, side and total draw). Timing records while the panel is hidden. Text refreshes at 4 Hz.

## Views (`src/views/`, read-only)

- **Top view**: terrain, airport overlay, plane marker, a mark showing what the side view covers, edge arrow when the plane is off screen. Camera follows the plane unless panned (`followCamera.ts`).
- **Side view**: terrain profile along the heading, plane sprite at true pitch (25 frames, -30 to +30 deg), wreck sprite after a crash. Scrolls vertically only when the plane climbs above about 40% of panel height (`sideCamera.ts`). At the closest zoom above about 400 m no ground is visible; zoom out.
- Sprites: `views/sprite.ts`, shapes in `config/planeShape.ts`. Colors in `config/palette.ts`.
- **Instruments panel** (`views/instruments.ts`, units in `sim/units.ts`, text in `views/format.ts`): `SPD` kt, `ALT` ft (displayed, nearest 10), `HDG`, `V/S` ft/min (nearest 50, unscaled, so it disagrees with how fast `ALT` changes; D2 decides). Redrawn only when a string changes. A hidden line gives screen readers the values at most 4 times a second. Map and scale ticks in the views stay in meters.

## The map

- Hand-made test map (`sim/world/testMap.ts`): 512 x 512 cells at 10 m (5.12 km square), a 181.6 m peak NE of the start (the start heading points at it, so doing nothing crashes in about 19 s), a lake, a river, a town, a level area holding one test airport with an angled runway (`testAirport.ts`, `placeAirports.ts`).
- Scales (`config/scales.ts`): altitude 10 (real m per world m), airport 2. Horizontal scale is not used yet (E1).

## Not built yet

Scale sliders (E1/E4), flight model and stall (C), landing and runway rules (C5), instruments (D), real map data (E), terminal, ATC and LLM (F), weather and traffic (G), audio (H).

## Checks still owed

Live, in a full-size visible window: real-time feel of climb and settle, both views agreeing on the crash point, banner stacking with pause, Enter on a focused Resume button, shimmer while scrolling, B2's real-frame timing (the debug panel now measures it), and B4's manual checks in `B4_PLAN.md` §13. Listed in `B2_PLAN.md` and `B3_PLAN.md` §14.
