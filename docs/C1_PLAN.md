# C1 Implementation Plan: Thrust, drag and weight

**Status:** Built, not committed. Manual flights not run (see §13).
**Milestone (ARCHITECTURE.md §14):** "Throttle and pitch trade speed for height."
**Starting state:** B4 is committed (`0de1f37`). 222 tests pass. B2 to B4's live checks in a full-size window are still owed (CURRENT.md).

All numbers are provisional. "m" means world meters unless it says real. Figures marked *(prototyped)* come from a throwaway script of §3's formulas using §4's defaults, not from game code.

## 1. Scope

**In:** an engine with a throttle lever and spool lag; drag; weight along the flight path; air density; a placeholder for slow flight; throttle readouts; new tuning sliders; debug text for forces; tests.

**Out:**

| Left out | Where it belongs |
|---|---|
| Lift as a force, angle of attack, stall, pitch separate from path | C2 |
| Indicated airspeed on `SPD` (§6) | C2 |
| Bank; turns costing energy | C3 |
| Ground roll, ground effect | C4; later |
| Surviving contact (every touch stays a crash) | C5 |
| Flap and gear drag, brakes, speed brake decision | C6 |
| Drawn lever | D3 |
| Wind | G6 |
| Engine sound | H3 |

S/W still command the **path angle** directly, exactly as in B3: 15 degree limit, 20 deg/s, level on release. C1 changes only what happens to speed. C2 replaces this with lift.

## 2. Behavior

| Input | Today | C1 |
|---|---|---|
| E / Q | Change speed directly | Move a **throttle lever** 0 to 100% at 50% per second; it stays where left |
| S | Climb at constant speed | Climb and lose speed, unless thrust covers it |
| W | Descend at constant speed | Descend and gain speed |
| A / D | Turn | Unchanged |

Expected flights, so the result can be recognized *(prototyped)*:

| Flight | Result |
|---|---|
| Start, hands off | Stays at 90 m/s and 100 m until the mountain |
| Start, hold W for 4 s | 90 to 99 m/s, 89 m lower |
| Start, hold S for 4 s | 90 to 81 m/s, 80 m higher |
| Full throttle, level | 90 to 103 m/s in 5 s, 114 in 10 s, 172 after 60 s |
| Full throttle, hold S | Near 600 m after 20 s, at 84 m/s |
| Idle, level | 90 to 79 m/s in 10 s; 68 to 69 in 20 s |
| Idle, hands off for a long time | Sinks at about 3.7 degrees and 64 m/s |
| Full throttle, hold W from 590 m | 162 m/s after 18 s, close to the ground |

Speeds 1:1 with height at 1:10 displayed means each trade moves `ALT` ten times more than the numbers above: the 4 s dive loses about 2,900 displayed ft. This is the energy mismatch in ARCHITECTURE.md §6. Judge it by feel; do not add a correction factor in C1.

## 3. The model

A new pure file, `sim/flight/forces.ts`. `z` is world m; `h` is real m, `z * altitudeScale`.

```text
sigma = (1 - 2.25577e-5 * max(0, h))^4.2559      density ratio, standard air, troposphere only
rho   = 1.225 * sigma
q     = 0.5 * rho * V^2

T  = spool * thrustMax * sigma^0.7
Cl = min(CL_CAP, m*G*cos(g) / (q*S))             lift needed to hold the path
Cd = cd0 + k * Cl^2
D  = q * S * Cd

dV/dt = (T - D)/m - G*sin(g)
```

- **`Cl` here is the lift the path would need**, since the path is commanded, not produced. It gives drag its real shape: lowest near 66 m/s at sea level, rising above and slightly below. Under about 60.5 m/s `CL_CAP` takes over and drag falls again, which is not physical; the sag limit (§3.1) covers that range until C2. C2 replaces only where `Cl` comes from; `Cd(Cl)` stays.
- `CL_CAP` and a floor on `q` keep the division finite at low speed.
- `T*cos(a)` is `T` until C2 adds angle of attack.
- Clamp `1 - 2.25577e-5*h` at 0 so no altitude can give a NaN.

**Engine.** `lever` moves with the keys. `spool` follows it: `spool += (lever - spool) * (1 - exp(-dt / spoolTau))`. This form cannot overshoot for any slider value.

**Order inside `advance`:** lever and spool, heading, **path angle, then speed**, then position. Today speed comes first; it must move after the path angle so both use the same angle.

**Position uses the average of the old and new speed.** With thrust and drag off, `V^2/2 + G*z` is then conserved exactly (prototyped error 1e-14 over 8 s), rather than drifting. It makes the main test sharp.

**Ceiling.** Today the path angle is zeroed at 600 m but creeps up again each step while S is held. With weight, that would cost a little speed every step. Instead, limit the target angle to 0 or below at the ceiling, and keep the existing z cap and zeroing for the step that arrives there.

### 3.1 Slow flight, a placeholder

With no lift, nothing would stop an idle plane from hanging in the air at zero speed. Until C2, the path angle's **upper limit sags as speed falls**:

```text
Ve = V * sqrt(sigma)                         equivalent airspeed
f  = clamp((Ve - 45) / (60 - 45), 0, 1)
target = min(pitchTarget, lerp(-15 deg, +pathMax, f))
```

At 60 and above it does nothing; below it, the nose drops and weight restores speed. It settles without oscillating *(prototyped)* and gives no free energy, unlike a minimum-speed clamp. It is one small function, `sagLimit`, **deleted in C2**. It is not a stall: no warning, no loss of control, and recovery is automatic.

Safety clamps remain at `SPEED_FLOOR` 20 and `SPEED_CAP` 300 m/s. In a sweep of slider corners, the lowest speed reached was 44.5, so the floor is only a net. The cap is reached only with extreme sliders.

## 4. Values

Constants and defaults go in a new `config/flight.ts`; `Tuning` stays in `config/motion.ts`.

| Constant | Value | Note |
|---|---|---|
| `GRAVITY` | 9.81 | |
| `WING_AREA` | 70 m2 | Regional jet size |
| `RHO0` | 1.225 | |
| `THRUST_LAPSE` | 0.7 | Exponent on sigma |
| `CL_CAP` | 1.5 | |
| `SAG_FULL`, `SAG_START`, `SAG_DEG` | 45, 60 m/s, 15 deg | |
| `SPEED_FLOOR`, `SPEED_CAP` | 20, 300 m/s | Replace `SPEED_MIN` |

**Tuning.** `speedRate` and `speedMax` go; speed is now a result, not a setting. `turnRateDegS`, `pathMaxDeg` and `pathRateDegS` stay.

| New key | Default | Range | Step |
|---|---|---|---|
| `leverRatePctS` | 50 %/s | 10 to 200 | 10 |
| `spoolTauS` | 1.2 s | 0.2 to 5 | 0.1 |
| `thrustMaxKn` | 100 kN | 40 to 200 | 5 |
| `massT` | 24 t | 12 to 40 | 1 |
| `cd0Counts` | 700 | 200 to 2000 | 50 |
| `inducedCounts` | 450 | 200 to 1200 | 50 |

Counts are 1/10,000, so `cd0` is 0.07 and `k` 0.045. Integer steps avoid floating-point error in the existing "default lands on a step" test; `spoolTauS` needs that test to compare with a tolerance. Sliders appear by themselves from `TUNING_RANGES`.

These are not airliner figures. `cd0` is about three times a real jet's, so speed settles near 170 m/s rather than 300 and bleeds off quickly enough for short flights. Best glide is 8.9:1.

**Start state**

| Value | Today | C1 | Why |
|---|---|---|---|
| Speed | 60 m/s | **90 m/s** (`SPD` 175) | 60 is the estimated clean stall speed (`Cl` 1.5), so C2 would start stalled |
| Position | (2560, 2560) | **(2000, 2000)** | At 90 m/s the mountain would be 12.9 s away. From here it is 1,951 m, 21.7 s, close to today's 19 s; the path is clear of terrain until then |
| Lever, spool | none | **0.321 each** | Level trim; holds 90.0 m/s for 60 s |
| z, heading | 100 m, 45 deg | unchanged | |

## 5. State and interfaces

```ts
interface Craft { ...; readonly lever: number; readonly spool: number }   // both 0..1
interface SimWorld { ...; readonly altitudeScale: number }                // real m per world m
```

- `Controls.throttle` stays the **key axis** (-1, 0, 1). The new field is called `lever` so the two cannot be confused.
- `lever` and `spool` belong to `Craft`, so `interpolate` blends them, restart resets them, and replay covers them.
- On a crash, `lever` and `spool` become 0 with speed. Restart gives the start values.
- Density needs real height, so the simulation is **handed** the altitude scale in `SimWorld`, not through a global import. That keeps E4 free to tune it. `main.ts` passes `SCALES.altitude`.
- `sim/flight/forces.ts` exports `densityRatio`, `thrust`, `drag`, `sagLimit` and `forcesOn(craft, tuning, altitudeScale)`, which returns thrust, drag, weight along the path (N), and `dV/dt`. The step and the debug panel both call `forcesOn`, so they cannot disagree.
- `place` and `rotate` keep speed, lever and spool. `place` can add height for free; it is a tool.

## 6. Readouts and debug panel

- **`THR` and `ENG`** (lever and spool, whole percent) become a third row of the instruments text block. B4 assigned throttle indication to D3, but a lever that stays put cannot be flown unseen. D3 replaces the text. Three 44 px rows are 132 px in the 160 px canvas. Add both to the hidden screen reader line.
- **`SPD` stays true airspeed.** ARCHITECTURE.md §6 wants indicated. At the start they differ by about 5%, and at the ceiling by about 27%. It matters once stall speed does, so C2 changes it. Record this in CURRENT.md.
- **Debug panel, FLIGHT group,** as text: lever and spool; thrust, drag and weight along the path in kN; `dV/dt`; density ratio; and energy height `z + V^2/(2G)` in world m. Energy height is the clearest check on this step: pitching should barely move it, throttle should. Drawn vectors wait for C2, when lift exists.

## 7. Files

| File | Change |
|---|---|
| `src/config/flight.ts` | new: §4 constants |
| `src/config/motion.ts` | edit: `Tuning`, ranges, start values; drop `SPEED_MIN` |
| `src/sim/flight/forces.ts` | new: §3 (pure) |
| `src/sim/state.ts`, `step.ts`, `interpolate.ts` | edit: §3, §5 |
| `src/main.ts` | edit: `altitudeScale`; world and panel wiring |
| `src/views/instruments.ts`, `format.ts` | edit: `THR`, `ENG`, percent text |
| `src/app/debugPanel.ts` | edit: §6 |
| `tests/forces.test.ts` | new |
| `tests/` sim, tuning, units, loop, followCamera, crashBanner | edit: §9 |

No input changes and no new dependencies. Commands are unchanged except for the tuning keys.

## 8. Steps

Each step leaves the page working and tests passing.

1. **`forces.ts` and constants,** with unit tests. Nothing uses them yet.
2. **`altitudeScale`, `lever` and `spool`** in state, interpolation and world, and the lever moved by the keys. Speed still works as before, so only literals in tests change.
3. **`THR` and `ENG`,** and the lever lines in the debug panel.
4. **Switch speed to forces:** new order, average-speed position, sag limit, ceiling rule, tuning keys, start state. Update the tests this breaks (§9). This is the one large step.
5. **Force lines in the debug panel.**
6. **Fly and tune,** then verify (§9).
7. **Documents:** results here; CURRENT.md; ARCHITECTURE.md §6 (`Cl` placeholder note), §16 (next is C2); GAME_DESIGN.md §5.2 only if an allowance was added; AGENTS.md phase line.

## 9. Verification

**New tests**

| Area | Tests |
|---|---|
| Density | 1 at sea level and below; 0.907 at 1,000 real m; falls with height; finite at absurd heights |
| Drag | Equals `q*S*(cd0 + k*Cl^2)` at a hand-worked point; lower at 66 m/s than at 61 or 75 (sea level, level flight); finite at V = 0 |
| Thrust | 0 at idle; full value at sea level; falls with height |
| Energy | Spool 0 and drag coefficients 0 (pass raw values to `forces`/a test-only tuning, outside slider limits): `V^2/2 + G*z` constant to 1e-9 in a climb, dive and reversal |
| Trim | Start, hands off, flat world: within 0.2 m/s of 90 after 60 s; z exact |
| **Trade** | Hold S: speed falls, z rises. Hold W: the reverse. Full throttle raises energy height; idle lowers it |
| Signs | Full throttle reaches a level speed limit; more lever gives a higher one; steeper angle gives lower climb speed |
| Engine | Lever stops at 0 and 1; spool lags, never overshoots, 63% after `spoolTau`; holds with no key |
| Sag | No effect at or above 60; continuous; idle hands-off settles within 45 to 70 m/s, descending, with no oscillation in the final 10 s |
| Ceiling | Held S at 600 m: angle stays 0; speed does not differ from level flight there |
| Crash and restart | Lever and spool 0 after a crash; start values after restart; impact speed is the last flying speed |
| Invariants | B4's 10,000-step runs with the new keys at every maximum, **every minimum**, and mid-run changes: finite, above ground, under the ceiling, speed within floor and cap |
| Determinism | Existing frame-rate tests, with lever input |

**Existing tests that change, and how.** Never loosen one just to pass.

| Test | Change |
|---|---|
| Moves 60 m in 60 steps; four directions; contact positions; clear paths | Keep the geometry; compare with integrated speed or use a trimmed start |
| `limits speed at both ends` | Replaced by the engine and level-limit tests |
| `climbing does not change speed` | Reversed: it is now the Trade test |
| Speed 0 does not climb | Replaced by the sag test |
| Full-climb rise of exactly `60 sin 15` | Rise equals the sum of average speed x sin 15 |
| Tuning `speedRate`, `speedMax`; loop's `speedMax` | Rewritten for new keys |
| `units.test` start readout `117` | `175`, plus `THR` and `ENG` |
| Real map: start above ground at (2560, 2560) | Use `START_X`, `START_Y` |
| Real map: scripted climb clears the peak | Must still pass; if the start lever cannot manage it, add throttle to the script and say so |
| Craft literals | Add `lever`, `spool`; `SimWorld` literals add `altitudeScale` |

Typecheck, all tests and build must pass.

**Manual, in the browser.** Check each row of §2's flights, watching `THR`, `ENG` and energy height. Then:
- Dive, then climb back with throttle untouched: ends lower or slower than it began.
- Full throttle and level speeds settle instead of running away; idle glide reaches the ground under control.
- Clear the mountain from the start by throttle and climb; fly into it by doing nothing.
- Pause, crash, restart: lever as §5 says. A lever held during pause does not move.
- Drag each new slider in flight; Reset restores all.
- The third readout row is readable at 1280 x 720; no console errors.
- Feel: is throttle response too slow, is 10 s at idle too slippery, does the ALT change per dive bother? Write preferred values into `config/`.

Anything not run is reported as **not checked**. B4's owed frame timing should be taken in the same session.

## 10. Decisions

**Recommended defaults; say so if you want any changed:**

1. **Path angle stays commanded** until C2. C1 is about energy only.
2. **Induced drag now,** from the required lift. Without it, slow flight costs nothing and there is no best glide.
3. **Density and thrust loss now.** GAME_DESIGN.md §5.1 asks for both, and `Cl` and `Cd` tuning would otherwise be redone in C2.
4. **Sag limit** as the slow-flight placeholder, not a minimum speed.
5. **Higher start speed, earlier start point.** This is the most visible change.
6. **`THR` and `ENG` text,** pulled forward from D3.
7. **Top speed near 170 m/s through high drag.** A realistic jet would cross the 5 km test map in under 20 s.
8. **No arcade acceleration multiplier.** GAME_DESIGN.md §5.2's 1.5x is for the ground (C4). Tune thrust and mass first.

## 11. Risks

| Risk | Response |
|---|---|
| Feels sluggish after B's instant throttle | Spool, thrust and mass are live sliders; tune in step 6 |
| Compressed height makes energy trades look wrong | Energy height in the panel separates a bug from a scale effect; scale changes wait for E4 |
| Sag limit mistaken for a stall and kept | Named and commented as a placeholder; C2's plan must remove it |
| Real and world height mixed up in density | One conversion, in `densityRatio`'s caller, with a test at scale 10 |
| Large test rewrite hides a regression | §9 lists every intended change; anything else that breaks is a bug |
| Tuned numbers redone in C2 | Drag polar, thrust, mass and spool carry over; only `Cl`'s source and the sag go |

## 12. Done when

Throttle and pitch trade speed for height as §2 describes, the plane holds speed hands off at the start and cannot hang in the air, the lever is readable, sliders tune the forces live, documents are updated, and typecheck, tests and build pass.

**Next:** C2, lift, angle of attack and stall.

## 13. Results

Built per §8. 243 tests, typecheck pass.

- **Differences from the plan:** `drag(speed, pathAngle, sigma, tuning)` and `thrust(spool, tuning, sigma)` take the tuning, and `Q_FLOOR` is in `config/flight.ts`. `sagLimit` returns the exact path limit once at full speed (a one-ulp error broke an exact-angle test). Geometry tests in `sim.test.ts` use a `FREE` tuning (no engine, no drag) at 90 m/s. The 10,000-step invariant test runs at all maximums, all minimums and with mid-run changes, with a 30 s timeout.
- **Existing tests changed** as §9 listed; the tuning default-on-a-step check now uses a tolerance. The real-map scripted climb passed unchanged.
- **Checked in the browser:** page loads, no console errors, `SPD` 175, `THR` and `ENG` 32, third row visible. Brief key taps moved the lever (32 to 33).
- **Not checked:** the §2 flights and §9 manual list with held keys (the browser tool cannot hold keys), feel and tuning (step 6), 1280 x 720 readability, B4's owed frame timing. Defaults are the plan's, untuned.
- `SPD` stays true airspeed; recorded in CURRENT.md.
