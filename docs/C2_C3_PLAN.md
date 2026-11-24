# C2 + C3 Implementation Plan: Lift, stall and banked turns

**Status:** C2 and C3 built, one session, uncommitted. Manual flights by a person not done (see §13).
**Milestones (ARCHITECTURE.md §14):** C2 "Plane stalls and can recover." C3 "Steep turns cost energy."
**Starting state:** C1 is committed (`f794780`), 243 tests. C1's manual flights are still owed (C1_PLAN.md §13).

One plan because both use the same lift. They are still **two gates**: C2 must be finished and pass its tests (§8) before C3 starts, and C2 is playable alone.

All numbers are provisional. "m" means world meters unless it says real. Figures marked *(prototyped)* come from a throwaway script of §3 with §4's defaults, not from game code. Nobody has flown them, so feel is untested.

## 1. Scope

| In C2 | In C3 |
|---|---|
| Pitch separate from path; S/W command pitch rate | Bank; A/D command roll rate |
| Lift, angle of attack, `Cl` curve, separation drag | Heading change from banked lift, `turnMult` |
| Stall, nose drop, warning, recovery | Load factor, stall speed rising with bank |
| Load limiting on the pitch keys | Turn help (automatic nose-up in shallow banks) |
| Soft ceiling; `sagLimit` deleted | Small banks level themselves |
| `SPD` becomes indicated airspeed | `BNK` readout |
| `PIT` readout, stall warning, path mark in side view | Roll and turn sliders, debug lines |

**Out:**

| Left out | Where it belongs |
|---|---|
| Ground roll, rotation | C4 |
| Surviving contact; touchdown pitch and bank limits | C5 |
| Flaps (shift the `Cl` curve), gear, brakes | C6 |
| Artificial horizon, drawn warning lights | D2, D3 |
| Altitude and heading hold | D4 |
| `isStable` test | D4, F6 |
| Bank drawn on the plane sprites | H2; `BNK` text until D2 |
| Wind, turbulence | G6, G8 |
| Stall horn, buffet sound | H3 |
| Structural damage, overspeed, spins, ground effect | not planned; later |

## 2. Behavior

| Input | Today | After C2 | After C3 |
|---|---|---|---|
| S / W | Path angle moves; levels on release | Nose rises / falls at 10 deg/s and **stays where released** | Same |
| A / D | Flat turn, 30 deg/s | Unchanged | Roll at 45 deg/s to at most 60 deg; **bank stays where released**, except under 10 deg, where it levels |
| E / Q | Lever | Unchanged | Unchanged |

**The biggest change for the player:** releasing S no longer returns to level. The nose holds its attitude and the path settles toward it over about 2 s. Pitch chooses the attitude; speed and throttle decide whether the plane climbs.

Expected flights from the start (90 m/s, z 100) unless stated *(prototyped)*:

| Flight | Result |
|---|---|
| Hands off | 90.0 m/s and z 100.0 for 60 s |
| S 1 s, release | Nose 15.4 deg. Four seconds later: path +8.6 deg, 84 m/s, z 144. After 14 s: 73 m/s, z 239 |
| W 1 s, release | Four seconds later: path -8.7 deg, 95.6 m/s, z 52 |
| Full throttle, no pitch | Climbs by itself: path +3 deg, 117 m/s, z 144 after 15 s |
| Idle, no pitch, over deep ground | Settles near 64 m/s at path -6.4 deg, short of the stall |
| Hold S, throttle as at start | Brief warning in the pull; climbs; stalls at about 11 to 12 s, 59 m/s, z 310; nose and path fall; path reaches -21 deg at 20 s, z 256 |
| From z 400, idle 3 s, hold S 8 s | Mushes at 15 to 16 deg angle of attack, sinking |
| ...then W 1 s + full throttle, 2 s, S 1 s, 4 s | Flying level at 89 m/s, about 43 m below where recovery began |
| ...or instead just release | Comes out of the stall at 14 deg, still slow and sinking; needs power |
| Full throttle + S at the ceiling | Path settles to 0 at z 600, no snap larger than about 2 deg in the nose |

C3:

| Flight | Result |
|---|---|
| D to 30 deg, release, 10 s | z stays within 1 m (turn help); 7.2 deg/s; 89.0 m/s; energy height -9 m |
| D to 45 deg (1 s), release, 10 s | Sinks 25 m without S; 12.3 deg/s; energy height -26 m |
| D to 60 deg, release, 10 s | Sinks 75 m; 21 deg/s; about 2 g |
| Held level at 60 deg from 90 m/s | **Stalls.** Needs about 95 m/s indicated |
| Held level at 60 deg from 120 m/s, 10 s | 162 deg of turn; 120 to 115 m/s; energy height -60 m. Same at 45: -20 m, at 30: -7 m, at 0: 0 m |
| Tap D to 7 deg, release | Wings level again within 1 s |

Level stall, indicated: 60.6 m/s (118 kt) at 1 g; about 65 at 30 deg, 72 at 45, 86 at 60 (by `1/sqrt(cos b)`). Entered at a steady rate, the model departs a little after that.

## 3. The model

All in `sim/flight/`, pure. `sigma`, thrust and engine lag are unchanged from C1.

### 3.1 Aerodynamics (C2), new `aero.ts`

```text
a   = pitch - pathAngle
s   = smoothstep((a - (aStall - w/2)) / w)            separation 0..1; mirrored for a < 0 around aStallNeg
lin = CL0 + CL_ALPHA * a
Cl  = (1 - s) * lin          + s * CL_PLATE * sin(2a)
Cd  = (1 - s) * (cd0 + k*lin^2) + s * (cd0 + CD_PLATE * sin(a)^2)
```

- `lin` is C1's polar, so `cd0` and `k` keep their tuned meaning. Best glide is 8.9:1 at 66 m/s, as in C1.
- The peak is `Cl` 1.49 at 13.9 deg *(prototyped)*. `Cl` falls to about 1.1 at 16 deg, where drag has roughly doubled.
- One expression covers -180 to 180 deg without a jump, so no angle can give a NaN.
- Delete `CL_CAP`, `SAG_*`, `sagLimit` and the old `drag`. Nothing else may keep a stall substitute.

`liftAngle(n, speed, sigma, tuning)` is the angle of attack that gives `n` times weight, capped at `aStall - w/2` and using `Q_FLOOR`. The ceiling uses it.

### 3.2 Forces

`forcesOn(craft, tuning, altitudeScale)` returns `sigma, alpha, separation, thrust, lift, drag, loadFactor, weight, along, dVdt`:

```text
loadFactor = L / (m*G)
along      = (T*cos(a) - D) / m
dV/dt      = along - G*sin(g)
dg/dt      = ((L*cos(b) + T*sin(a)) / m - G*cos(g)) / max(V, SPEED_FLOOR)
dh/dt      = turnMult * L*sin(b) / (m * max(V, SPEED_FLOOR) * max(cos(g), COS_FLOOR))
```

In C2 there is no bank: `cos(b)` is 1, and heading keeps the old flat turn. `turnMult` touches heading only, never energy. The step and the debug panel both use this function.

### 3.3 Pitch keys (C2)

`pitchRate` is state, so the keys have a short ramp (`PITCH_LAG` 0.15 s) instead of a jolt:

```text
Ve        = V * sqrt(sigma)
authority = clamp((Ve - 30) / (55 - 30), 0.2, 1)
up   *= (1 - s) * clamp((4 - n) / 1.5, 0, 1)        nose-up fades near the stall and near 4 g
down *= clamp((n + 1) / 1, 0, 1)                    nose-down fades near -1 g
target     = key * pitchRateDegS * authority * fade
pitchRate += (target - pitchRate) * (1 - exp(-dt / PITCH_LAG))
pitch     += pitchRate*dt  -  sign(a) * s * stallDropDegS * dt
pitch      = clamp(pitch, -30 deg, +30 deg)
```

`a`, `s` and `n` are those at the start of the step. When `pitch` is clamped, set `pitchRate` to 0.

- **The stall** is this: past 13.5 deg lift falls, drag climbs, the nose drops, and nose-up stops working. It is not scripted, and no timer or random wing drop is involved. Held S keeps it stalled; easing off or pushing recovers; power and speed finish the job.
- **Without the g fade**, random inputs reached 6 g and -3.3 g at default tuning; with it, 3.8 and -0.8 *(prototyped)*. It is an arcade allowance, so add it to GAME_DESIGN.md §5.2.
- Nose held within +/-30 deg. The path may exceed that in a stall; clamp it to +/-80 deg as a net.

### 3.4 Bank keys and turn help (C3)

```text
key held:          bank += key * rollRateDegS * authority * dt, limited to +/-60 deg
no key, |b| < levelBelowDeg:  bank moves toward 0 at LEVEL_RATE (15 deg/s), exactly to 0
no key, otherwise: bank unchanged

help(b) = clamp( m*G/(q*S) * (1/cos(min(|b|, turnHelpDeg)) - 1) / CL_ALPHA, 0, 4 deg )
pitch  += help(bankNew) - help(bankOld)
```

- **Help is fed in as the bank changes,** so there is one pitch value and rolling out gives it back. If speed changed in the turn, rollout leaves a few tenths of a degree *(prototyped: -0.1 deg)*. Apply it before the pitch clamp.
- Past `turnHelpDeg` (30) help stops growing. Steeper turns need S, which is what makes them cost energy.
- **Banks hold when released.** GAME_DESIGN.md §5.4 says a steep bank with neutral controls must not rescue itself, so self-leveling must not apply there. Small banks settle, which honors §5.2's "tends to settle".

### 3.5 Ceiling

A hard stop would leave the nose high and stall the plane against an invisible wall. Instead:

```text
limit = (CEILING_Z - z) / 100 m      (radians)
if pathAngle > limit: pathAngle = max(limit, 0); pitch = min(pitch, pathAngle + liftAngle(1/cos b))
```

This only redirects the path, so it neither adds nor removes energy. Keep the final `z <= CEILING_Z` cap. It replaces C1's target rule.

### 3.6 Order inside `advance`

lever and spool -> bank and help (C3) -> pitch -> forces (new pitch and bank, old path) -> path -> ceiling -> heading -> speed (using the **new** path) -> position (average speed, as C1) -> contact.

With this order `V^2/2 + G*z` stays constant to 2e-12 with no engine and no drag, banked or not *(prototyped, 20 s)*. C1's 1e-9 test carries over, but must stay below the separation angle, where drag is always present.

## 4. Values

**Constants, `config/flight.ts`** (C2 unless marked)

| Constant | Value | | Constant | Value |
|---|---|---|---|---|
| `CL0` | 0.25 | | `PITCH_MAX_CMD_DEG` | 30 |
| `CL_ALPHA` | 5.2 /rad | | `PITCH_LAG` | 0.15 s |
| `STALL_WIDTH_DEG` (w) | 5 | | `AUTH_ZERO`, `AUTH_FULL`, `AUTH_MIN` | 30, 55 m/s, 0.2 |
| `STALL_NEG_DEG` | -13 | | `LOAD_MAX`, `LOAD_FADE` | 4, 1.5 |
| `CL_PLATE`, `CD_PLATE` | 1.1, 2.0 | | `LOAD_MIN` | -1 |
| `PATH_LIMIT_DEG` | 80 | | `CEILING_SOFT_M` | 100 |
| `WARN_MARGIN_DEG` | 3 | | `STALLED_AT` (s) | 0.25 |
| `COS_FLOOR` (C3) | 0.2 | | `BANK_MAX_DEG` (C3) | 60 |
| `LEVEL_RATE_DEG` (C3) | 15 | | `TURN_HELP_CAP_DEG` (C3) | 4 |

Sprite frames stay at `PITCH_MAX_DEG` 30 in `planeShape.ts`; a test asserts the two limits agree.

**Tuning sliders**

| Key | Step | Default | Range | Slider step |
|---|---|---|---|---|
| `pathMaxDeg`, `pathRateDegS` | C2 | removed | | |
| `pitchRateDegS` | C2 | 10 | 4 to 30 | 1 |
| `stallDeg` (aStall) | C2 | 16 | 10 to 20 | 1 |
| `stallDropDegS` | C2 | 14 | 2 to 40 | 1 |
| `turnRateDegS` | C3 | removed | | |
| `rollRateDegS` | C3 | 45 | 10 to 120 | 5 |
| `turnMult` | C3 | 2 | 1 to 4 | 0.25 |
| `turnHelpDeg` | C3 | 30 | 0 to 45 | 5 |
| `levelBelowDeg` | C3 | 10 | 0 to 60 | 5 |

`levelBelowDeg` 60 means "always self-level", so that alternative can be tried live. `stallDeg` is the center of the stall; the `Cl` peak is about 2 deg below it. In a 1,500-run sweep of slider corners: no NaN, speed 31.8 to 300 (cap reached only at extreme settings), path -51 to +32 deg *(prototyped)*. That sweep preceded the nose-down fade; the game's own invariant tests repeat it.

**Start:** `START_PITCH` 0.09388 rad (5.38 deg), lever and spool 0.3202 (was 0.321). Position, speed and heading unchanged. A test recomputes the trim so the literals cannot go stale.

## 5. State and interfaces

```ts
interface Craft { ...; pitch; pitchRate /* C2 */; bank /* C3, + = right */ }
```

- `pitch`, `pitchRate`, `bank` are in `Craft`, so interpolation (linear), restart and replay cover them. Do not store `alpha`; derive it.
- `Controls.turn` keeps its name; in C3 it means roll. The `turn` command and key bindings do not change (it also steers on the ground in C4).
- **Crash:** pitch and bank freeze at impact, `pitchRate` becomes 0. `Crash` gains nothing; C5 decides what a touchdown needs.
- `place` and `rotate` keep pitch, bank, speed. They are tools; `rotate` does not bank.
- `stallState(craft, tuning): 'none' | 'warning' | 'stalled'` in `aero.ts`: warning at `a >= stallDeg - 3`, stalled at `s >= 0.25` with `a > 0`. It is never `warning` or `stalled` on a crashed craft (the caller checks).

## 6. Views

- **Side view** draws the sprite at `pitch`, not path. Add a short dim line from the plane along the path angle (about 40 px, color in `palette.ts`), so the gap between nose and path, the angle of attack, can be seen. It uses the view's own vertical exaggeration so it points where the plane will go. Hidden when crashed.
- **Readouts** become 3 columns by 3 rows, value font 16 px: `SPD ALT V/S / HDG PIT BNK / THR ENG` and a warning cell. 320 px gives 106 px per cell; `-12,050` at 16 px plus its unit needs about 80. `BNK` is added in C3 (empty cell in C2). Formats: `PIT` whole degrees signed (`+5`, `0`, `-12`); `BNK` `L 30`, `0`, `R 30`.
- **Warning cell:** `STALL` in an amber warning color, red with a filled box when stalled. No blink (nothing here uses wall time). D3 replaces it. Pulled forward because a stall must be readable for "can recover". Also in the screen reader line.
- **`SPD` is indicated:** `V * sqrt(sigma)`, through `indicatedSpeed(craft, scale)` in `sim/units.ts`, which calls `densityRatio`. The start reads 167, not 175. Crashed reads 0.
- **Debug panel:** C2: pitch, angle of attack, separation, lift, load factor, true and indicated speed. C3: bank, turn rate, level stall speed at this bank. Energy height stays. Drawn force vectors remain a later option.

## 7. Files

| File | C2 | C3 |
|---|---|---|
| `src/sim/flight/aero.ts` | new: §3.1, `liftAngle`, `stallState` | |
| `src/sim/flight/forces.ts` | rewrite `forcesOn`; delete `sagLimit`, `drag` | `cos(b)`, `dh/dt` |
| `src/sim/flight/attitude.ts` | new: pitch keys, stall drop | bank keys, `turnHelp` |
| `src/sim/state.ts`, `interpolate.ts` | `pitch`, `pitchRate` | `bank` |
| `src/sim/step.ts` | new order, ceiling | bank, heading from lift |
| `src/sim/units.ts` | `indicatedSpeed` | |
| `src/config/flight.ts`, `motion.ts` | §4 | §4 |
| `src/views/instruments.ts`, `format.ts` | 3 x 3, `PIT`, warning | `BNK` |
| `src/views/sideView.ts`, `sprite.ts`, `config/palette.ts` | pitch, path line; rename `pathAngle` parameters in `sprite.ts` to `pitch` | |
| `src/app/debugPanel.ts` | lines | lines |
| `tests/aero.test.ts`, `tests/attitude.test.ts` | new | extended |
| other tests | §9 | §9 |

`main.ts` should need little or no change. No new dependencies, commands or keys.

## 8. Steps

Each step leaves the page working and tests passing.

**C2**
1. `aero.ts` and constants with unit tests. Nothing uses them yet.
2. `pitch` and `pitchRate` in state and interpolation, with the step setting `pitch = pathAngle`. Only craft literals in tests change.
3. Readout layout, `PIT`, `SPD` indicated, path line and sprite from `pitch`. Still flies like C1.
4. **Switch to lift:** `attitude.ts`, `forcesOn`, new step order, soft ceiling, start values, sliders; delete `sagLimit`. The one large step, with the test changes in §9.
5. Stall warning, debug lines.
6. Fly and tune the C2 rows of §2. **Gate: typecheck, tests, build pass, and the plane stalls and recovers by hand.** Update CURRENT.md. If commits are asked for, C2 is its own commit.

**C3**
7. `bank` in state, interpolation, `BNK`. The keys roll; heading still turns flat for this one step.
8. **Switch heading to banked lift:** `cos(b)`, `dh/dt`, remove `turnRateDegS`, add sliders.
9. Turn help and small-bank leveling.
10. Debug lines. Fly and tune the C3 rows of §2.
11. Documents: Results here; CURRENT.md; ARCHITECTURE.md §6 (pitch holds attitude, g fade, nose drop, bank rule) and §16; GAME_DESIGN.md §5.2 and §5.3 (g fade, "bank holds"); AGENTS.md phase line and the tuning row.

## 9. Verification

**New tests, C2**

| Area | Tests |
|---|---|
| Lift curve | Linear below 10 deg (hand-worked `Cl` 0.704 at 5 deg); peak between 1.4 and 1.55 at 12 to 15 deg; falls for the next 4 deg; continuous (no change over 0.02 per 0.1 deg) from -180 to 180; finite everywhere |
| Drag | Equals `cd0 + k*Cl^2` below separation; lowest level drag between 61 and 75 m/s; more than doubles from 10 to 18 deg |
| Trim | Recomputed trim equals `START_PITCH` and `START_LEVER` to 1e-3; hands off 60 s: within 0.5 m/s and 2 m |
| Stall speed | `sqrt(2mG / (rho*S*ClMax))` is within 60 to 62 m/s; a flat deceleration shows `warning` before `stalled` |
| **Stall** | Hold S at start throttle: stalls between 8 and 16 s, then path goes below -10 deg while S is held; lift there below weight |
| **Recovery** | From a held stall at z 400: W 1 s + full throttle, then 2 s, S 1 s, 4 s: `none`, path within 3 deg of level, lost under 80 m. Keeping S held with the engine idle does **not** recover in 8 s |
| Not scripted | Same stall at mass 12 and 40 occurs at a higher speed for the heavier plane |
| Attitude | Pitch holds exactly with no key below separation; path reaches within 1 deg of its settled angle in 3 s after S 1 s |
| Authority | Response is weaker at 35 m/s than 60; nose-up is 0 fully separated; nose-down is not |
| Load | Held S at 170 m/s peaks under 4.0 g, held W stays over -1.1 g |
| Energy | C1's conservation test rewritten, 1e-9 below separation |
| Trade | Raising the nose loses speed and gains height; the reverse; full throttle raises energy height; idle lowers it |
| Ceiling | Held S at full throttle from z 500: z never over 600, path settles at 0, not stalled 10 s later; nose moves under 3 deg in any step |
| Readout | `SPD` 167 at start; equals true speed at sea level; warning text for each state; crashed reads 0 and no warning |
| Path line | Pure end-point helper: level at 0, up for a positive path, respects exaggeration |

**New tests, C3**

| Area | Tests |
|---|---|
| Roll | 45 deg in 1 s; stops exactly at +/-60; holds exactly at 30 with no key; 7 deg levels to exactly 0 without overshoot; `levelBelowDeg` 0 never levels |
| Direction | D turns right, A left; mirrored runs mirror exactly |
| Turn rate | In a settled 30 deg level turn, `turnMult * G * tan(30) / V` to 5%; doubles with `turnMult` |
| **Energy** | Held level for 10 s from 120 m/s: energy loss at 60 > 45 > 30 > 0; `turnMult` changes heading but not energy (equal to 1e-9) |
| Stall speed | Held level and idle, higher bank stalls at a higher speed; 60 deg from 90 m/s stalls, 30 deg does not |
| Help | 30 deg for 10 s: z within 3 m; with `turnHelpDeg` 0 it sinks over 10 m; roll in and out restores pitch within 0.3 deg; 45 deg released sinks over 15 m |
| No rescue | 60 deg released at 90 m/s for 10 s: bank still 60, z falling |

**Both:** 10,000-step invariant runs (`tuning.test.ts`) with the new keys at all maximums, all minimums and mid-run changes: finite, above ground, at or below the ceiling, speed within floor and cap, `|pitch|` <= 30 deg, `|bank|` <= 60 deg, `|path|` <= 80 deg. Frame-rate determinism with pitch, stall, bank and restart. Interpolation end points and midpoints.

A small closed-loop helper in `tests/` (key value from path and height error) holds level flight for the turn and deceleration tests. It is a test tool, not a game autopilot, and must not go in `src/`.

**Existing tests that change, and how.** Never loosen one just to pass.

| Test | Change |
|---|---|
| `FREE` geometry tests (90 m in 60 steps, directions, edges, contact points) | Today they rely on a level path with no forces. Keep geometry exact by testing `sweepContact` directly for analytic contact points; keep step-level versions with a trimmed start and tolerances |
| `angle stops at exactly +/-15`, `takes 0.75 s`, `60 steps at full climb`, path limit and path rate in `tuning.test.ts` | Replaced by the attitude tests; the "rise equals sum of average speed x sin(path)" check is kept on a settled climb |
| `steeper angle gives lower climb speed` | Same claim, with held pitch attitudes |
| `level flight keeps z exactly`; trim test's exact z | Tolerances in §9, since lift is never exact |
| `sag limit` (all), `drag` unit tests | Deleted with the code; lift-curve and stall tests replace them |
| `idle hands-off settles` (45 to 70 m/s, no oscillation) | Kept; same limits |
| `ceiling` in both files | Rewritten for the soft ceiling |
| `12 s of turn returns to start`, turn rate slider | C3: replaced by the turn rate test. The C3 step that removes `turnRateDegS` updates every script that tunes it |
| Loop tests: a tap turns at once; key held through pause | C3: a tap rolls, so assert bank, then heading within 1 s; after a pause assert bank holds or levels instead of constant heading |
| Restart tests: held turn key | C3: assert after a few steps |
| `a scripted climb passes the peak` | S 1 s instead of 6 s. *(prototyped: z about 279 at the peak's distance; 6 s of S at start throttle climbs into a stall)* |
| `dive` helper (runway, lake, sea) | Same claims; W for 1 s or until contact, whichever works on the real map. The doing-nothing crash must still pass |
| `units.test` start readout | `175` -> `167`, plus `pit`, `bnk`, warning |
| Craft literals, `crashBanner.test` | Add the new fields; consider one shared `craft()` helper in `tests/` |

Anything else that breaks is a bug until shown otherwise.

**Manual, in the browser** (keys must be held by a person or a scripted key driver; C1 found the browser tool cannot hold keys):
- Every row of §2, watching `PIT`, `SPD`, the path line and energy height.
- Can you tell from the screen alone that it is stalling, and why? Does recovery feel learnable?
- Fly a level 30 deg turn, then a level 60 deg one; the second should visibly cost speed.
- Side view: nose and path line separate in a pull and in a stall; no jump at the ceiling.
- Clear the mountain from the start; crash into it doing nothing (the 20 s timing is unchanged).
- Pause, crash and restart in a bank and in a stall. Each slider in flight, and Reset.
- 3 x 3 readouts readable at 1280 x 720; no console errors.
- **Feel questions:** is holding attitude on release better than leveling? Is the stall too gentle (it mushes more than it breaks)? Is 10 deg/s of pitch too quick to fly level with taps? Try `levelBelowDeg` 60. Write preferred values into `config/`.

Anything not run is reported as **not checked**. C1's owed manual flights are superseded where behavior changed (§2); do its engine and idle rows in the same session, and B4's frame timing.

## 10. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Nose holds when S/W are released** (rate command, attitude hold). It makes "pitch plus power equals performance" learnable and gives no porpoising. The alternative, returning to level, would remove the link between throttle and climb. *Most visible change.*
2. **Bank holds, and only small banks level.** Required by the no-rescue rule; live-tunable to "always level".
3. **The stall is a smooth curve plus nose drop,** with no separate state machine and no randomness. Gentle by default, tunable by `stallDeg` and `stallDropDegS`.
4. **g fade on the pitch keys,** instead of structural limits.
5. **Pitch limited to +/-30 and bank to +/-60.** No loops or rolls; the sprites already cover it.
6. **Turn help to 30 deg,** by feeding pitch in with bank.
7. **`turnMult` 2,** from GAME_DESIGN.md. The test map's turns will be slower than today's 30 deg/s: 7 at 30 deg of bank, 12 at 45, 21 at 60.
8. **Soft ceiling.**
9. **Indicated airspeed now,** because stall speed is only constant in indicated terms.
10. **`PIT`, `BNK` and the stall warning as text now;** D2 and D3 replace them.

## 11. Risks

| Risk | Response |
|---|---|
| Keyboard pitch is fiddly: a tap is all-or-nothing | 0.15 s ramp and 10 deg/s give about 0.2 deg per shortest tap; `pitchRateDegS` is live; D4 adds hold |
| Player cannot hold altitude while turning and watching two views | Turn help; judge at the C3 gate before adding more |
| Stall too mild to notice | Warning text, path line, sliders. Raise `stallDropDegS` before adding mechanisms |
| Stall too punishing near the mountain or at low height: recovery loses about 40 m, 1,300 displayed ft | Forgiving defaults; start height 100 m. Judge with C5's landing in mind |
| Bank invisible in both views until D2 | `BNK` text; pull the horizon forward from D2 if it is not enough |
| Trim changes with mass, so `massT` slider makes the plane climb or sink | Expected; say so in CURRENT.md |
| Large test rewrite hides a regression | Two gates; §9 lists every intended change |
| Compressed height exaggerates every altitude error on `ALT` | Energy height in the panel; scale changes wait for E4 |
| Numbers redone by C4 and C6 | Flaps shift `CL0` and `stallDeg`; keep both as parameters of `aero`, not read globally |

## 12. Done when

**C2:** raising the nose trades speed for height, the plane stalls from excess angle of attack at a speed the player can learn, shows it, and recovers by lowering the nose and adding power; hands off it holds 90 m/s; no trace of `sagLimit` remains.

**C3:** the plane turns by banking, shallow turns hold height by themselves, steep turns cost measurable energy and raise the stall speed, and a steep bank does not rescue itself.

Both: sliders work live, documents are updated, typecheck, tests and build pass, and unrun manual checks are listed as such.

**Next:** C4, takeoff and ground roll.

## 13. Results

C2 and C3 are built as planned. Typecheck, 274 tests and the build pass.

**What was checked.** A scripted run of §3 in the real code reproduced the §2 rows: hands off 90.0 m/s and z 100.0; S 1 s then 4 s gives path +8.6, 84.0 m/s, z 144.5 (14 s: 73.2, z 239); W 1 s gives -8.7, 95.6, z 51.5; full throttle 116.9 m/s, z 144; hold S stalls at about 11 to 12 s, 58 m/s, z 318 then path -21 at 20 s, z 257. C3: 30 deg 7.2 deg/s, energy -9 m; 45 deg sinks 25 m, 12.3 deg/s; 60 deg sinks 75 m, 21 deg/s, 1.97 g; a 7 deg tap levels within 1 s. The page loads with the 3 x 3 readouts and no console errors (the browser tool cannot hold keys, so flights were not flown by hand).

**Differences from the plan.**
- `STALLED_AT` is 0.4, not 0.25: at 0.25 a normal pull showed a false `STALLED` about 3 s in. Warning still starts 3 deg before the stall center.
- The ceiling lowers the nose at most 20 deg/s (`CEILING_NOSE_RATE_DEG`); the plan's direct clamp snapped the nose 8.6 deg in one step when a pull reached the ceiling at 150 m/s.
- Nose-up fade by separation applies only to a positive angle of attack, and nose-down fade only to a negative one, so a negative-side separation does not block recovery.
- Test limits adjusted from the plan because the curve is slightly different: lift changes up to 0.026 per 0.1 deg (plan 0.02); drag more than doubles from 10 to 20 deg (plan 10 to 18: 2.00x, not over); lift below weight is checked at separation 0.5, not at the moment of the stall.
- The `levelBelowDeg` and turn-help tests roll in with the key, since setting a bank directly skips help. Idle level-hold stalls at any bank eventually, so "60 stalls, 30 does not" is tested at start power from 90 m/s, and the speed ordering at idle from 120 m/s.
- The `Craft` literal helper was not added; literals were updated in place.

**Not checked.** Everything in §9 "Manual": held-key flights of every §2 row, feel questions (attitude hold vs level, stall gentleness, 10 deg/s pitch, `levelBelowDeg` 60), the ceiling by eye, pausing/crashing/restarting in a bank or stall, 1280 x 720 readout legibility, and C1's owed flights and B4's frame timing.
