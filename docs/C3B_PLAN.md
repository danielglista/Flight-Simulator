# C3B Implementation Plan: Turn handling (weight, wings-level key, heading bug)

**Status:** Built. Automated checks pass; by-eye flying (�7) is still owed.
**Milestone (ARCHITECTURE.md §14):** an addition to C3 ("Banked turns"). Not a new row; it makes C3 flyable by keyboard.
**Starting state:** C2 + C3 are committed (`a3ccf69`). The working tree also holds uncommitted top-view work: a heading-up rotating camera and a dashed turn line (`views/camera.ts`, `views/turnLine.ts`). 282 tests pass. Manual flights for C1 to C3 are still owed (CURRENT.md).

All numbers are provisional. "m" means world meters unless it says real.

## 1. Why

Three problems from flying C3 by hand:

1. **Heading capture is hard.** To turn to 045 you must watch the `HDG` readout, so you stare at the instruments instead of the map.
2. **Roll has no weight.** The roll rate is instant: a key gives the full `rollRateDegS` at once and stops at once (pitch already has a lag; roll does not).
3. **Self-leveling is a cliff.** Under `levelBelowDeg` (10 degrees) the bank settles to zero; at 11 degrees it holds. A shallow turn cannot be held, and the behavior is hard to predict.

## 2. Scope

**In:**

- **Roll with a lag.** The roll rate follows the key through a lag, so a tap gives a small, repeatable bank change and a hold gives a full roll.
- **Remove the automatic self-leveling.** A released bank stays where it is.
- **A wings-level key (Space).** One press rolls the bank back to zero and stops there. Any A/D press cancels it.
- **A heading bug and compass ring in the top view**, with keys to set the bug, and a mark on the turn line where the plane reaches the bug.
- Tests, tuning defaults, and a CURRENT.md update.

**Out:**

| Left out | Where it belongs |
|---|---|
| Heading-hold (autopilot that banks and rolls out for you) | With ATC commands, G-series; the bug state moves into `sim/` then |
| Click-to-set bug on the ring | Only if the keys feel bad |
| Heading shown on the instrument panel as a bug | D1 (instruments rewrite) |
| Yaw, rudder, adverse yaw, ground steering | C4 |
| Turn-rate lag beyond what the bank lag gives | Only if turns still feel light |

## 3. Behavior

| Input | Today | C3B |
|---|---|---|
| A / D held | Roll at `rollRateDegS` immediately | The roll rate builds toward `rollRateDegS` with lag `ROLL_LAG_S`, then eases off after release |
| A / D released | Bank under 10 degrees levels itself; above holds | Bank stays. No automatic leveling |
| Space | Nothing | Starts **wings level**: the bank rolls toward 0 at up to `rollRateDegS`, easing in as it arrives. Stops at exactly 0. A or D cancels it. One press is enough (latched, not hold) |
| `[` / `]` | Nothing | Heading bug left / right by 5 degrees. Shift: 1 degree. Held keys repeat |

**Top view, while following:** a compass ring around the plane. It rotates with the map (heading up), has ticks every 10 degrees and a label every 30. The bug is a marker on the ring, with a faint line from the plane to it. A short text line shows the bug and the turn needed (`BUG 270  L 45`). If the turn line's heading crosses the bug within its 10 s, a small bracket marks that point. In free look the ring is hidden.

## 4. Model

### 4.1 Roll

`Craft` gets `rollRate` (rad/s, positive right wing down), like `pitchRate`. It must be added to `interpolate.ts`.

```text
target   = key * rollRateDegS * authority(speed, sigma)           A/D held
         = clamp(-bank * LEVEL_GAIN, -r, +r)  (r = rollRateDegS * authority)   wings level on
         = 0                                                       otherwise
rollRate += (target - rollRate) * (1 - exp(-dt / ROLL_LAG_S))
bank     += rollRate * dt, clamped to +-BANK_MAX_DEG; rollRate = 0 when clamped
```

Wings level finishes when `|bank|` and `|rollRate|` are both under a small epsilon: set both to exactly 0 and clear the flag. `LEVEL_GAIN` is a proportional rate so the roll eases out instead of stopping dead.

Same form as the pitch lag: it cannot overshoot for any slider value.

### 4.2 State and commands

- `Controls` gets `level: boolean`. New command `{ kind: 'level' }` sets it; a `turn` command with a non-zero value clears it. `step.ts` also clears it when the bank reaches zero.
- `sim/` stays headless: the bug is **not** in sim state in this step (§4.3).
- Crash and reset zero `rollRate` and `level`.

### 4.3 Heading bug

The bug is a UI value held in `main.ts`, with its arithmetic in a new pure file `views/headingBug.ts`:

```text
stepBug(bug, deltaDeg)        wraps to [0, 360)
turnNeeded(heading, bug)      signed shortest turn, degrees, positive = right
```

It starts at the plane's heading. It is not saved with the sim, so replays do not include it. That is acceptable until heading-hold needs it in `sim/`.

`turnTrack` (`views/turnLine.ts`) also returns the heading at each point, so the top view can find where the track crosses the bug.

### 4.4 Values

| Constant / tuning | Today | New default | Note |
|---|---|---|---|
| `rollRateDegS` | 45 | 20 | Slower peak; with the lag, a tap is a few degrees. Slider range 5 to 90 |
| `ROLL_LAG_S` (`config/flight.ts`) | none | 0.5 s | Roll rate time constant |
| `LEVEL_GAIN` (`config/flight.ts`) | none | 1.0 per s (plan said 1.5) | Wings-level rate per radian of bank. 1.5 with the 0.5 s lag overshoots and ends at a rate of about 8 deg/s; 1.0 ends at under 4 deg/s |
| `turnMult` | 2 | 1.5 | Heavier turns: about 2.6 deg/s at 15 deg bank, 5.4 at 30, at 90 m/s |
| `levelBelowDeg` | 10 | removed | Tuning key and slider go; `LEVEL_RATE_DEG` goes |
| `BUG_STEP_DEG`, `BUG_FINE_DEG` (`config/display.ts`) | none | 5, 1 | |
| Ring radius, tick spacing, colors | none | `config/display.ts`, `config/palette.ts` | Ring radius is `min(view.height/2 - 24, 150)` px |

## 5. Files

| File | Change |
|---|---|
| `src/config/flight.ts` | `ROLL_LAG_S`, `LEVEL_GAIN`; remove `LEVEL_RATE_DEG` |
| `src/config/motion.ts` | `rollRateDegS` default and range; remove `levelBelowDeg`; `turnMult` default |
| `src/sim/state.ts` | `Craft.rollRate`, `Controls.level` |
| `src/sim/commands.ts`, `src/sim/step.ts` | `level` command, new `stepBank`, reset on crash |
| `src/sim/flight/attitude.ts` | `stepBank` rewritten (§4.1) |
| `src/sim/interpolate.ts` | interpolate `rollRate` |
| `src/input/keyState.ts`, `keyboard.ts` | Space as a latched `level` command; stop the page scrolling and a focused button reacting; `[` `]` bug actions |
| `src/views/headingBug.ts` | new, pure (§4.3) |
| `src/views/turnLine.ts` | also return headings |
| `src/views/topView.ts` | ring, bug, bug text, crossing bracket |
| `src/config/display.ts`, `palette.ts` | ring and bug constants |
| `src/main.ts` | bug state, key actions, pass bug to the top view |
| `src/app/debugPanel.ts` | show `rollRate`, `level` |
| `tests/attitude.test.ts`, `tests/step.test.ts`, `tests/keyState.test.ts`, `tests/headingBug.test.ts`, `tests/turnLine.test.ts` | see §7 |
| `docs/CURRENT.md` | controls table, top-view line, tuning |

## 6. Steps

1. **Roll feel.** Add `rollRate`, the lag, remove self-leveling, update `interpolate.ts` and tuning. Tests first for `stepBank`. Check by flying: taps and holds.
2. **Wings-level key.** `level` command, Space binding, page-scroll and button handling. Tests. Check by flying.
3. **Heading bug.** `headingBug.ts` with tests, `turnLine.ts` headings, ring and bug drawing, `[` `]` keys. Check by eye.
4. **Tune and write up.** Fly a few 45 and 90 degree turns; adjust defaults; update CURRENT.md and this plan's Results.

## 7. Verification

**Tests** (headless):

- `stepBank`: a held key never exceeds `rollRateDegS`; after release the rate falls toward zero and the bank does not drift back; clamps at `BANK_MAX_DEG` with the rate zeroed; wings level reaches exactly 0 from any bank, from either side, and never overshoots; an A or D press cancels it; low authority slows it.
- A short tap (0.15 s) gives a smaller bank than a long one, and the same tap twice gives the same bank.
- No self-leveling: a 5 degree bank with no key is still 5 degrees after 10 s.
- `step`: `level` clears at zero bank; crash zeroes `rollRate` and `level`.
- `keyState`: Space emits one `level` command per press, including a tap shorter than a sample; held Space does not repeat it.
- `headingBug`: wrapping, `turnNeeded` across 0/360 and for exactly 180.
- `turnTrack`: heading at each point matches the arc.

**By eye** (dev server, full-size window; type checks cannot tell you this feels right):

- Turn to 045 from 090, from 000 and from 270 using only the top view: how close do you land, and how often do you overshoot?
- Taps give fine bank; holds give a quick roll.
- Space levels smoothly and stops cleanly; A or D mid-level cancels it.
- Ring and labels read correctly while the map turns; no console errors; free look hides the ring.

## 8. Decisions

| Decision | Choice | Why |
|---|---|---|
| Wings-level key | Space, latched, prototype | Asked for as an experiment. See §9 |
| Self-leveling | Removed, not made a tuning option | The cliff made shallow turns unholdable; the key replaces the convenience on purpose |
| Roll model | Lagged roll rate, not detented bank steps | One key gives both fine and coarse control; detents would feel arbitrary |
| Bug state | UI state in `main.ts` for now | Nothing in `sim/` uses it until heading-hold |
| Bug keys | `[` `]`, Shift for 1 degree | Unused keys; the mouse is already used for pan, zoom and place |
| Ring when not following | Hidden | The plane is no longer at the ring's center |

## 9. Risks

- **The wings-level key may make flying too easy.** The worry is that one key removes the skill of rolling out. It is cheap to remove: one binding and one command. After the by-eye checks, decide whether to keep it, keep it with a condition (for example only under a bank limit), or drop it. Record the outcome in Results.
- **Slower roll and weaker turns make precision worse before the bug helps.** If turns feel sluggish, raise `turnMult` first, then the roll rate.
- **Space on a focused button.** The page's buttons (Resume) react to Space. The key handler must not let a flight Space press trigger one, and must stop the page from scrolling.
- **Ring clutter.** At small panel sizes the ring may cover too much terrain. Keep it thin and faint; make it a constant to switch off.
- **Old tests.** The existing `stepBank` and self-level tests change meaning; rewrite, do not just loosen them.

## 10. Done when

- `npm run typecheck` and `npm test` pass.
- In a manual flight, a 45 degree turn to a set bug can be flown mostly by watching the top view, and Space levels the wings and stops.
- No automatic leveling remains; `levelBelowDeg` and `LEVEL_RATE_DEG` are gone from code and docs.
- CURRENT.md describes the new controls and tuning.
- The keep or drop decision on Space is written under Results.

## 11. Results

**Built.** 304 tests and typecheck pass. All steps in �6 are done except the by-eye tuning flights.

- `stepBank` now returns `{ bank, rollRate, level }`. Wings level stops at the first step that would cross zero (or when bank and rate are both tiny), so it never overshoots; the lagged rate means it still arrives at up to about 4 deg/s, which is a clean but not a perfectly soft stop. `LEVEL_GAIN` went from 1.5 to 1.0 for that reason (0.75 stops at 1.5 deg/s but takes 3.5 s from 30 deg).
- Pressing A or D cancels wings level in `step.ts` (the roll step reports `level` false while a key is held) as well as in the `turn` command.
- `[` `]` are in the same action table as P, C, Enter; the table now passes `shiftKey` through, and the two bracket keys are the only ones that repeat. Space is `preventDefault`ed on keydown and keyup (outside text fields) so the page does not scroll and a focused Resume button does not react.
- Old tests rewritten: roll (lag, no self-level, wings level, crash reset), `rolledIn` helper (releases early so the lag coasts to the target bank), rolling-in-and-out pitch test, loop pause test, tuning roll test.
- Checked in the browser pane: ring, bug marker, bug text, a `D` tap giving `R 1`, Space returning the bank to 0, no console errors. Not checked: a 45 deg turn flown by eye, the crossing bar on a curved turn line in flight, and the keep-or-drop decision on Space (�9), which needs real flights.
