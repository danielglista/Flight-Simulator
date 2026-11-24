# D4A Implementation Plan: Altitude hold (autopilot and autothrottle)

**Status:** Plan only. Nothing built.
**Milestone (ARCHITECTURE.md §14):** pulls the altitude half of D4 ("Autopilot hold") forward, ahead of C4. The ID is provisional; rename it if you prefer another slot. Heading hold stays in D4 proper. D4's "only when stable" gate (`isStable`, ARCHITECTURE.md §6) is not built yet, so this step has its own small gate (§4.6).
**Starting state:** The altitude bug exists (view only): `-` / `=` set a target in displayed feet, the side view shows a line, a path-intercept bar and a magnified tape with a 10 s trend bar (`views/altitudeBug.ts`, `views/sideView.ts`, `main.ts`). Nothing in `sim/` knows about it. Pitch (S/W) and throttle (Q/E) are held keys that command a rate and stay where released (`sim/flight/attitude.ts`, `sim/step.ts`). `stepPitch` takes `key: Axis` (-1, 0, 1). The plane is level at the start with lever 32% and pitch 5.38 deg.

All numbers are provisional. "m" means world meters unless it says real (real = world x `SCALES.altitude`, 10). Displayed feet are what `ALT` shows.

## 1. Why

Altitude has two inputs, pitch and power, and they fight: raising the nose trades speed for height, and the speed change then asks for more throttle. Holding a steady altitude by hand means constant small corrections to both. That is the skill the manual controls teach, and it should stay (this is a simulator). But the game is meant to be played with the ATC radio, and a player reading and answering the radio cannot also hold altitude to 10 ft. The wish: **keep manual flight exactly as it is, and add an autopilot that holds the altitude bug and the speed, so attention can go elsewhere.** The bug is already the setpoint, so the autopilot needs no new targeting UI.

## 2. Scope

**In:**

1. **Altitude hold (ALT):** pitch is commanded to capture and hold the altitude bug, climbing or descending at a limited rate and easing out to level.
2. **Speed hold (SPD):** the throttle lever holds the indicated airspeed the plane had when SPD engaged. On by default whenever ALT engages, and switchable on its own.
3. **Protections:** stall margin, an energy guard for when the throttle cannot hold speed, and a small engage gate (§4.6).
4. **Override:** manual S/W drops ALT, manual Q/E drops SPD, so the player can always take over by using the controls.
5. **Status:** a text line in the side view, the bug line and tape changing look when engaged and when captured, and rows in the debug panel.
6. Tests for every pure function, a closed-loop headless scenario test, and a CURRENT.md update.

**Out:**

| Left out | Where it belongs |
|---|---|
| Heading hold, wings level hold, turn-to-bug | D4 proper; reuses the same pattern with a bank command |
| A speed bug the player can move; speed target other than "speed at engage" | Later in D4, once the instruments panel (D1 to D3) can show a target |
| Vertical-speed mode, approach or glideslope modes | C5 / later |
| Autopilot on the ground, takeoff and landing modes | C4 / C5; engage is refused on the ground once C4 exists |
| `isStable(state)` as the shared gate | D4; this step uses the smaller gate in §4.6 and says so |
| Autopilot warnings, chimes, disconnect sound | H |
| Saving the autopilot setting across a reload | Not planned; like the tuning values, a reload resets it |

## 3. Behavior

| Input | Effect |
|---|---|
| `Z` | Altitude hold on / off. On: holds the altitude bug as it is now, and turns SPD on too (`AP_SPEED_WITH_ALT`). Refused while crashed or stalled |
| `X` | Speed hold on / off (own switch). Speed target is the indicated airspeed at the moment it goes on |
| `-` / `=` while ALT is on | Move the target; the plane re-captures the new altitude (100 ft per press, Shift 10 ft) |
| S / W while ALT is on | ALT drops at once; SPD stays on. The nose stays where the player left it, as in manual flight |
| Q / E while SPD is on | SPD drops at once; ALT stays on, and the player now manages power |
| Stall (separation), crash, restart | ALT and SPD both drop |
| Pause | Unchanged: the sim does not step |

What you see with ALT on and the bug 400 ft above: the plane pitches up gently, climbs at most about 5 deg, eases out as it nears the target, and settles on it. The tape's trend bar shrinks to nothing and the cyan bar sits on the yellow pointer. Hands off, it stays within 10 ft (§7).

Display: the side view shows `AP ALT 3500  SPD 160 kt` (parts that are off are left out), amber `AP ALT` while not yet captured and green once captured (inside `AP_CAPTURE_FT`). The bug line and tape keep their look, with a solid (not dashed) bug line while ALT is engaged.

## 4. Model

### 4.1 State and commands

New in `SimState` (all `readonly`, in `sim/state.ts`):

```text
autopilot: {
  alt:      boolean     altitude hold engaged
  spd:      boolean     speed hold engaged
  targetZ:  number      altitude target, world m (valid while alt)
  targetIas: number     indicated airspeed target, m/s (valid while spd)
}
```

Start state: both off, targets 0. New commands (`sim/commands.ts`), the only way in:

| Command | Effect |
|---|---|
| `{ kind: 'autopilot', mode: 'alt' \| 'spd', on: boolean, targetZ?: number }` | `on` with `mode: 'alt'` needs a finite `targetZ`, and is ignored while crashed or stalled; it also turns `spd` on if `AP_SPEED_WITH_ALT`. `on` with `spd` records the current indicated speed. `off` clears that mode |
| `{ kind: 'apTarget', z: number }` | Updates `targetZ` only while `alt` is on; clamped to 0..`CEILING_Z`; ignored when not finite |

The bug stays view state in `main.ts`, as the heading bug does. `main.ts` sends `autopilot` with the bug converted by `bugWorldZ` when `Z` is pressed, and `apTarget` whenever the bug moves while ALT is on (including while paused, using the immediate path like `tune`). The sim never reads the view. The target is clamped to `CEILING_Z`, because the bug may go to 20,000 ft and the ceiling is about 19,700 ft displayed.

Disengage rules live in `applyCommands` and `advance`: a non-zero `pitch` command clears `alt`; a non-zero `throttle` command clears `spd`; `restart` and a crash clear both; stall clears `alt` and `spd` (§4.6).

### 4.2 Controller output

A pure function in `sim/flight/autopilot.ts`:

```text
autopilotOutput(craft, ap, tuning, altitudeScale) -> { pitchKey: number | null, throttle: number | null }
```

`null` means "not controlled, use the manual axis". `pitchKey` is continuous in [-1, 1]; `throttle` is a lever rate command, also in [-1, 1]. `advance` uses these in place of `controls.pitch` and `controls.throttle` for the step. `stepPitch`'s `key` changes from `Axis` to `number` (the fade and rate formulas already accept any value; only the type changes). The lever change `controls.throttle * leverRate` already accepts a number. No other part of the step changes, so the autopilot cannot give the plane anything the keys could not: it works through the same pitch rate, authority, load-factor and stall limits (§4.5), and energy stays conserved exactly as before.

### 4.3 Altitude hold (pitch)

Three nested pieces, outer to inner:

1. **Altitude error to a path angle.** `err = targetZ - z`. Wanted climb rate `vs = err / ALT_TAU_S` (exponential approach), and wanted path `pathCmd = asin(clamp(vs / speed, -1, 1))`, limited to +/- `AP_PATH_MAX_DEG` (climb) and `AP_PATH_MAX_DESC_DEG` (descent). The time constant is what makes it arrive softly: the last 100 ft are covered slowly.
2. **Path angle to nose angle.** The nose must sit the angle of attack above the path for the lift that holds that path: `pitchWanted = pathCmd + liftAngle(loadFactorWanted, speed, sigma, tuning)`, with `loadFactorWanted = cos(pathCmd) / cos(bank)` (1 g in the path frame, plus the extra for a bank). This uses the same `liftAngle` the forces use, so in level flight the wanted nose angle is exactly the trim angle and no integrator is needed. If tests show a steady offset (mass or density mismatch), add a slow integral of `err` limited to +/- `AP_INTEGRAL_MAX_DEG`; do not add it before it is needed.
3. **Nose angle to the pitch key.** `pitchKey = clamp((pitchWanted - pitch) / AP_PITCH_GAIN_DEG, -1, 1)`, so the nose rate is proportional to the error and full rate (`pitchRateDegS`, authority applied by `stepPitch`) only when 3 deg or more away. A deadband smaller than 0.05 deg writes 0, so the nose is not nibbled.

The path follows the nose through a lag of about 1 to 2 s (mass x speed / (q x S x lift slope)), well inside `ALT_TAU_S` (6 s), so the outer loop is slow enough not to oscillate. This margin is the thing to check first in the closed-loop test.

### 4.4 Speed hold (throttle)

Indicated airspeed is `indicatedSpeed(craft, scale)` (`sim/units.ts`), so the target holds at any altitude the way the airspeed gauge does. The lever is an integrator, so a plain proportional command on the lever rate is integral control; the engine lag (`spoolTauS`, 1.2 s) would make that ring, so a rate term damps it:

```text
speedErr = targetIas - ias
accel    = d(ias)/dt            (estimated from forcesOn: f.along - g sin(path), scaled by sqrt(sigma))
throttle = clamp(AP_SPD_GAIN * speedErr - AP_SPD_DAMP * accel, -1, 1)
```

with a deadband of `AP_SPD_DEADBAND_MS` (0.3 m/s) so a held speed does not make the lever hunt. The lever then moves at the usual `leverRatePctS`, no faster than a player could. Gains in `config/flight.ts` (they are physics-adjacent, like the other aero constants).

### 4.5 Protections

All inside `autopilotOutput`, as limits on `pathCmd`, so nothing is a special case in the step:

- **Stall margin (climb):** the allowed climb path shrinks linearly from `AP_PATH_MAX_DEG` to 0 as indicated speed falls from `AP_SLOW_IAS` to `AP_STALL_IAS`. Both are derived from the level stall speed at the current mass (the same figure the debug panel shows as "level stall speed"), as multiples `AP_SLOW_MULT` (1.35) and `AP_STALL_MULT` (1.2), not fixed numbers, so the mass slider keeps them honest. Below `AP_STALL_IAS` no climb is asked for, and a descent is allowed to trade height for speed.
- **Energy guard (throttle cannot hold speed):** when SPD is on and the lever is pinned (at 0 or 1) with `|speedErr| > AP_SPD_BAND_MS` (5 m/s) the limit tightens: slow with full power, climb path scaled toward 0; fast with idle, descent path scaled toward 0. Speed wins over altitude rate, as in a real autothrottle at its limit. ALT still captures, only later.
- **Load factor and nose limits:** unchanged, because the output goes through `stepPitch`: nose-up already fades near `LOAD_MAX` and stops in separation.
- **Ceiling and ground:** the target is clamped to `CEILING_Z`. Terrain is not avoided: the autopilot holds the bug through a mountain, which still crashes the plane (a crash drops the autopilot). Terrain avoidance is not planned; a warning that the bug is below the terrain ahead is a candidate later.

### 4.6 Engage gate and disengage

Engage is refused (command ignored, the status line flashes `AP REFUSED` for `AP_FLASH_S`) when: crashed; `stallState` is `stalled`; or `|bank|` is above `AP_ENGAGE_BANK_DEG` (45), since ALT hold assumes the lift budget in a turn is mostly left over. This stands in for D4's `isStable` and is replaced by it then. ALT drops on: S or W pressed, stall, crash, restart. SPD drops on: Q or E pressed, crash, restart. A stall drops both, since a stall is exactly when the player should be flying.

### 4.7 Status and display

- `sideView.draw` takes `autopilot` (the sim's) and a `captured` flag computed with a pure `isCaptured(z, targetZ)` (within `AP_CAPTURE_FT` of the target, in displayed feet, 20 ft) and draws the status text, the solid bug line, and a green bug marker when captured.
- The tape's trend bar and the intercept bar keep working: they are how the player judges whether the autopilot is doing what they expect.
- The debug panel adds rows: AP mode, target, error (ft), pitch key, throttle command, speed error, active limit (`stall`, `energy` or none).
- `docs/CURRENT.md` lists the keys, the command, the state and the guards.

### 4.8 Values

`config/flight.ts` (control law) and `config/display.ts` (display), none inline in logic:

| Constant | Start | Note |
|---|---|---|
| `ALT_TAU_S` | 6 s | Altitude error to climb rate; the main feel knob |
| `AP_PATH_MAX_DEG`, `AP_PATH_MAX_DESC_DEG` | 5, 4 | Steepest climb and descent the autopilot asks for |
| `AP_PITCH_GAIN_DEG` | 3 | Nose error at which the key saturates |
| `AP_PITCH_DEADBAND_DEG` | 0.05 | |
| `AP_SPD_GAIN`, `AP_SPD_DAMP`, `AP_SPD_DEADBAND_MS` | 0.08 per m/s, 0.5, 0.3 | Placeholders; set by the closed-loop test (§7) |
| `AP_SLOW_MULT`, `AP_STALL_MULT` | 1.35, 1.2 | Of the level stall speed at the current mass |
| `AP_SPD_BAND_MS` | 5 | Error at which a pinned lever tightens the limits |
| `AP_ENGAGE_BANK_DEG` | 45 | |
| `AP_CAPTURE_FT` | 20 | Display only |
| `AP_SPEED_WITH_ALT` | true | Z also turns SPD on |
| `AP_FLASH_S` | 1.5 | Refusal message |

## 5. Files

| File | Change |
|---|---|
| `src/config/flight.ts`, `display.ts`, `palette.ts` | constants (§4.8); status colors (amber, green) |
| `src/sim/state.ts` | `autopilot` in `SimState` and `initialState` |
| `src/sim/commands.ts` | `autopilot` and `apTarget` commands |
| `src/sim/flight/autopilot.ts` | new, pure: `autopilotOutput`, `isCaptured`, limits |
| `src/sim/flight/attitude.ts` | `PitchInput.key` becomes `number` |
| `src/sim/step.ts` | `applyCommands` (engage, target, disengage on manual input); `advance` uses the controller output; drop on stall |
| `src/input/keyboard.ts` | `KeyZ`, `KeyX` as one-shot actions (not repeating) |
| `src/main.ts` | send engage with `bugWorldZ`, send `apTarget` on bug moves, pass the autopilot to the side view; flash on refusal |
| `src/views/sideView.ts` | status text, solid line, captured color |
| `src/app/debugPanel.ts` | autopilot rows |
| `tests/autopilot.test.ts` (new), `tests/sim.test.ts`, `tests/keyboard.test.ts` | see §7 |
| `docs/CURRENT.md`, `docs/ARCHITECTURE.md` | present behavior; §14 D4 line (altitude half built early, heading later) |

## 6. Steps

1. **State, commands, constants.** `autopilot` in state, the two commands, `PitchInput.key` as a number, engage/disengage rules in `applyCommands` (no control law yet), with tests first. Behavior of the existing game does not change.
2. **Pitch law.** `autopilotOutput` for ALT only (§4.3), wired into `advance`, tests first including a closed-loop scenario. Tune `ALT_TAU_S`, `AP_PITCH_GAIN_DEG` until the capture is smooth with no overshoot.
3. **Speed hold.** The throttle law (§4.4) and its closed-loop test; tune the gains until a 300 ft climb holds speed within a few m/s.
4. **Protections.** Stall margin and energy guard (§4.5), with tests that drive them: a climb with the lever pinned low; a long descent with idle.
5. **Keys and view.** `Z` / `X`, the `main.ts` wiring, status text, captured color, debug rows. Fly it.
6. **Checkpoint.** Fly the cases in §7 by hand; keep, retune or drop each guard; record in Results.
7. **Write up.** CURRENT.md, ARCHITECTURE.md, this plan's Results.

## 7. Verification

**Tests** (headless, in `tests/autopilot.test.ts` and `tests/sim.test.ts`):

- `autopilotOutput`: `null` outputs while off; zero error at trim gives a pitch key of 0 (within the deadband); error above gives a positive key, below a negative one; the key saturates at +/-1; wanted path is limited to `AP_PATH_MAX_DEG` and `AP_PATH_MAX_DESC_DEG`; the stall margin removes the climb at low speed and scales between; the energy guard tightens the limit only when the lever is pinned and the error is beyond the band.
- `isCaptured`: inside, on the edge and outside `AP_CAPTURE_FT`, both directions.
- Commands: `autopilot` on with a non-finite target is ignored; engage is ignored while crashed, stalled and above `AP_ENGAGE_BANK_DEG`; `on` with `alt` also sets `spd` when `AP_SPEED_WITH_ALT`; `apTarget` is ignored when ALT is off, clamped to 0..`CEILING_Z`, and ignored when not finite; a non-zero `pitch` clears ALT but not SPD, a non-zero `throttle` clears SPD but not ALT; crash and restart clear both.
- **Closed loop** (step the real `advance` from the start state, no keys): from level flight with the bug +300 ft, then -300 ft, then +1,000 ft, the altitude settles within 10 ft and stays there within 60 s; it never overshoots by more than 20 ft; speed stays within 4 m/s of the target; the plane never reaches `warning`; `energy` is conserved to the same tolerance as the existing sim tests with the lever fixed. Repeat at 6 deg of bank and at the mass slider's two ends.
- **Determinism:** the same commands give identical states twice.
- Existing tests pass unchanged.

**By eye** (dev server, full-size window; type checks cannot tell you this works):

- Engage level at the start: nothing visibly changes; the plane holds 3,280 ft.
- A +500 ft step: a gentle climb, a smooth round-out on the tape, no nibbling of the nose sprite near the target.
- A -500 ft step and a +2,000 ft step: the limits and, on the long climb, the throttle coming up on its own (watch `THR` and `ENG`).
- Pressing S or W: ALT drops cleanly and the plane then flies as in manual. Q or E: SPD drops and the lever stays where the autopilot left it.
- Pushing the bug through the terrain ahead: the plane flies into it and crashes, as manually.
- Banked turns while ALT is on: altitude holds through a 30 deg turn.
- Moving the bug while engaged, including while paused.
- Frame time in the debug panel is unchanged (the controller is a few multiplications per step).

## 8. Decisions

| Decision | Choice | Why |
|---|---|---|
| Manual controls | Unchanged | The energy trade is the simulator; the autopilot is added on top |
| Where the autopilot lives | In `sim/`, as pure control laws feeding the same pitch and lever inputs the keys use | Deterministic and replayable; it cannot do what a player could not (same authority, load and stall limits); headless tests |
| Target ownership | The bug is view state; the sim holds a copy it is told about | Matches the heading bug; the sim never reads the view |
| Pitch law | Cascade: altitude error, path, nose, key | Slow outer loop and fast inner loop stay stable; uses `liftAngle` so trim needs no integrator |
| Speed hold | On with ALT by default, own switch | Climbing with a fixed throttle bleeds speed toward a stall; the pair is what removes the "two inputs" problem |
| Speed target | The indicated speed at engage | No speed bug to build yet; "set the throttle first, then press X" is natural |
| Override | Any manual pitch or throttle input drops its mode | Predictable; the player is never fighting the autopilot |
| At the limits | Speed wins over altitude rate | Same as a real autothrottle: do not trade away the stall margin |
| Terrain | Not avoided | Out of scope; the player owns the bug |
| Gate | Small gate here, `isStable` later | `isStable` is a D4 piece; this stays small and is replaced then |

## 9. Risks

- **Feel of the capture.** `ALT_TAU_S`, the path limits and the pitch gain decide whether it feels like an autopilot or a drunk pilot. Tune by flying; the closed-loop test keeps the numbers honest but cannot say if it feels good.
- **Oscillation (phugoid-like hunting).** Altitude, pitch and speed couple through the energy trade. If it rings, lengthen `ALT_TAU_S`, add the speed damping term, or add an altitude-rate term to the pitch law. The closed-loop test at both mass extremes is the early warning.
- **Lever hunting.** The engine lag (1.2 s) makes a lever law ring; the acceleration term and the deadband are there for that. Check the lever by eye over a minute of level flight: it should sit still.
- **Altitude scale confusion.** `ALT` moves 10x faster than the unscaled V/S shown on the panel (GAME_DESIGN.md 4.1). Limits here are in world path angle, so a 5 deg climb shows a large ALT rate and a small V/S figure. Mention it in CURRENT.md; D2 is where that is decided.
- **Fighting the existing helpers.** Turn help adds nose-up with bank and the soft ceiling lowers the nose near the top; both move the pitch under the autopilot. It corrects them each step, but check a 30 deg turn and a climb near 19,000 ft by eye.
- **Mass slider and trim.** Trim changes with mass, so the throttle needed changes too. The autopilot handles it; the stall margin is relative to the level stall speed to follow the slider.
- **Overlap with later milestones.** C4 (ground) must refuse engage on the ground; D4 adds heading hold and `isStable`; F (ATC) may want to read the autopilot state ("at your assigned altitude"). Keep the state in one object so they can.
- **Player trust.** An autopilot that flies into a mountain looks broken. The refusal flash and the status line are what make its limits legible; worth a look when playtesting.

## 10. Done when

- `npm run typecheck` and `npm test` pass, including the closed-loop test.
- In a manual flight: `Z` holds the bug within 10 ft hands off, captures a new bug smoothly, and `X` holds speed without the lever hunting; S/W and Q/E take over cleanly; the stall margin and energy guard keep the plane out of a stall on a long climb.
- Manual flight is unchanged when the autopilot is off.
- CURRENT.md describes the keys, the commands, the state, the guards and their constants.

## 11. Results

(Fill in as steps are built.)
