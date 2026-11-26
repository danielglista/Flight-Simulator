# D5 Implementation Plan: Instruments for approach, takeoff and power

**Status:** PLAN, for review. Nothing built.
**Origin:** a brainstorming session on why landing is hard (mainly lining up on final), then on the panel. All mockups were throwaway inline sketches; none are in the project.
**Not yet in ARCHITECTURE.md §14.** E4 is listed there as next; whether D5 goes before or after it is open (§9, question 1). "D5" is a proposed ID.

All numbers are provisional.

## 1. Goal

1. A hand-flying player can find a runway and line up on it from the instruments.
2. Takeoff speeds and call-outs are hard to miss.
3. The power display looks and reads like an instrument.
4. There is a place for later instruments without crowding the flight instruments.

## 2. Steps

| Step | What | Done when |
|---|---|---|
| D5A | V-speed marks on the speed dial; call-outs in the instrument panel | A takeoff can be flown without looking at the top of the side view |
| D5B | N1-style power dial | Lever and engine, and the lag between them, read from one dial |
| D5C | Runway selection and the selected approach (data and map line) | Any runway end can be picked with the mouse and stays picked |
| D5D | HSI with course arrow, deviation bar, bearing needle, glide slope | The player can line up on a selected runway using the HSI |
| D5E | Second screen with tabs, starting with NAV | Selection lives in a place that can take more pages |

D5A and D5B are independent of each other and of the rest. D5D needs D5C. D5E can replace D5C's first selector, so decide question 2 before D5C.

| Out | Where it belongs |
|---|---|
| Localizer and glide slope radio behavior, approach autopilot | Its own later step; D5D's numbers should be reusable |
| Slow engine spool from idle, engine temperature, fuel, engine failure | §8, after approaches can be flown by hand |
| Flap and gear speed limits, overspeed | §8 |
| ATC selecting the runway, copilot messages in the terminal | F |
| Wind and runway choice by wind | G6 |
| Spoken call-outs | H3 |
| New key commands | None added. Selection is by mouse |

## 3. What exists now (see CURRENT.md)

- The panel is a fixed 4 x 2 grid of 80 px cells (320 x 160), all eight used. It has no pointer handling.
- The compass cell is a heading-up card with the heading bug.
- POWER is two bars: lever handle and engine fill, 0 to 100.
- V-speeds and `V1` / `ROTATE` / `POSITIVE RATE` / `V2` call-outs are at the top of the side view.
- Approach guidance appears only with gear down, under 150 world m above ground, within 4 km, and roughly aligned. On a 3 deg path that is about 2.7 km before the threshold.

## 4. D5A: takeoff speeds and call-outs

**Behavior**
- Marks `1`, `R`, `2` on the speed dial rim at V1, VR, V2, shown while takeoff mode is on. V1 is omitted off a runway, as now (`--`).
- Call-outs (`V1`, `ROTATE`, `POSITIVE RATE`, `V2`) show large in the instrument panel, next to the speed dial or horizon, for 2 s each, once per takeoff, as now. Not in the warning lamps, so they do not read as faults.
- `POSITIVE RATE` also prompts for gear up.
- Runway remaining stays in the side view.
- Remove the V-speed strip and call-outs from the side view once the panel versions work.
- The screen-reader line announces each call-out.

**Files:** `views/gauges/airspeed.ts`, `views/panelState.ts`, `views/instruments.ts`, `views/takeoffStrip.ts`, `views/sideView.ts`, `config/display.ts`, `main.ts`.

**Later:** the same place for landing height call-outs (500, 100, 50, minimums), the terminal as a written record (F), then voice (H3).

## 5. D5B: power dial

**Behavior**
- One 80 px dial in the POWER cell. White needle and green fill: engine. Yellow marker on the rim: lever. Amber band: the gap while the engine catches up. Boxed engine value, small `THR` value.
- Red arc at the top is decoration until there is a limit to enforce.
- Reads **20 at idle** to 100 at full: shown value = 20 + 80 x spool. Display only; thrust, takeoff distance, V1 and the autopilot do not change.
- Label `N1` (assumes the plane is a jet). `PWR` would be more literal, since the value is share of maximum thrust, not fan speed.

**Files:** `views/gauges/power.ts`, `views/panelState.ts`, `config/display.ts`, `config/palette.ts`, tests.

**Open:** whether `THR` and the screen-reader sentence use the same 20 to 100 scale (§9, question 6).

## 6. D5C and D5D: runway selection and HSI

### 6.1 Selection (D5C)
- The player picks an airport, then a runway end. No automatic switching. `CLEAR` returns to normal flight.
- Selection is view state, like the bugs. Available at any time, including on the ground.
- Decided: a **built-in selector unit** beside the instruments rather than a pop-up list: airport buttons (three at a time, with arrows), runway buttons, clear. Placement is open (§9, question 2).
- List order: destination first, then nearest, favoring those ahead. The order must not change while the player is clicking. Search is for when there are many airports; today there are two.
- Hovering or focusing a runway previews it.
- Controls are real HTML buttons (hover, keyboard focus, screen reader labels). Flight keys keep working while the pointer is on them.
- While selected: the runway center line is drawn on the top view from far out, with the end to land on marked, without the current gear, height and alignment conditions.

### 6.2 HSI (D5D)
Replaces the compass cell. With nothing selected it is today's heading indicator.

| Part | Behavior |
|---|---|
| Card | Heading-up, labels every 30 deg, heading boxed at the top |
| Heading bug | Stays on the rim, also during an approach |
| Course arrow | The selected runway's heading |
| Deviation bar and dots | Where the center line is. Bar to the right means the line is to the right |
| Bearing needle | Direction from the plane to the runway; thin, a different color from the course arrow |
| Glide slope diamond and scale | Where the 3 deg path to the aim point is; diamond high means the plane is low. Hidden when far out |
| Corner text | Source (`APP` until there is a real ILS) and runway; distance |

Not included: to/from flag, warning flags.

- Course is the runway's **geometry heading**, which the game's compass uses. Runway names are magnetic and differ by about 10 deg (E_PLAN, E3 details), so the arrow for DCA 01 points near 002, not 010.
- Proposed: deviation is an **angle**, as on a real ILS (full scale about 2.5 deg sideways, 0.7 deg vertically), pegged beyond. A fixed distance would be more forgiving close in (§9, question 4).
- If the cell stays 80 px, drop in this order when it is unreadable: bearing needle tail, bearing needle on final, glide slope out of the cell.

### 6.3 HSI knobs
Wanted: buttons on the instrument, as on a real HSI.

| Knob | Does |
|---|---|
| Heading, bottom right | Moves the heading bug 5 deg (click sides or scroll). Same as `[` `]` |
| Course, bottom left | Turns the course arrow. Selecting a runway sets it |

The knobs do not choose airports; the selector does. Corner knobs need the larger HSI: in an 80 px cell the corners hold text and are about 28 screen px at 2x. Whether the course knob is needed is open (§9, question 3).

**Files (D5C, D5D):** a new pure module for the selected-approach numbers (reuse `views/approach.ts`), new selector and HSI drawing (`views/gauges/compass.ts` or a new `hsi.ts`), `views/panelState.ts`, `views/topView.ts`, `main.ts`, `index.html`, `styles.css`, `config/display.ts`, tests.

### 6.4 Layout and window size

The panel scales by whole numbers, so spare space depends on the window:

| Browser window | Instrument pixels available | Spare around 320 x 160 |
|---|---|---|
| 1280 x 720 (minimum) | 320 x 160 | none |
| 1536 x 730 | about 480 x 203 | 160 x 43 |
| 1920 x 950 | about 480 x 211 | 160 x 51 |

(Worked from `app/panels.ts` and `styles.css`; the player's actual window has not been measured.)

Proposed large layout, 480 x 192:

```text
+------+------+------+-------------+------+
| SPD  | ATT  | ALT  |             |      |
+------+------+------+     HSI     | NAV  |
| V/S  | PWR  | CFG  |  160 x 160  | unit |
+------+------+------+-------------+      |
| LIGHTS strip                     |      |
+----------------------------------+------+
```

It does not fit at 320 x 160. Options: raise the minimum size; or keep today's grid there with a small HSI and the selector somewhere else, which is two layouts to maintain (§9, question 2).

## 7. D5E: a second screen with tabs

- Flight instruments stay fixed: speed, horizon, altitude, V/S, HSI, power, flaps and gear, warnings. Nothing needed within a second or two is behind a click.
- One other screen with visible tabs: `NAV` (the selector), later `ENG` and `CHK`. Preferred over drawers sliding in from the edges.
- A warning lights its tab; the screen does not switch by itself while the player may be clicking. It may open on a sensible page by phase.
- Suggested place: sharing the comms terminal quarter, which is readable at any window size. New radio messages must stay noticeable. This would replace the 80 px NAV unit in §6.4 and remove most of the size problem (not yet agreed; §9, question 2).
- Build it with `NAV` only. Add a tab when there is something real on it.

## 8. Later ideas (not part of D5's steps)

| Idea | Note |
|---|---|
| Slow spool from idle (about 3 s near idle, quicker above 40%) | A felt mechanic, not a gate. Mark at 40% and a `STABLE` call-out. Makes late go-arounds harder, changes takeoff distance, V1 and speed hold. Add a debug slider |
| Engine temperature gauge | Tied to time at high power; amber, red, then power loss. Gives the red arc a purpose |
| Fuel | Needs scaling or multi-leg flights; the DCA to PHL leg is too short for real burn |
| Engine failure | Tied to abuse, or an optional random emergency using seeded RNG |
| Flap and gear speed limits, overspeed | The cheapest reason not to hold full power |
| Reasons to use flaps | Short runways and heavier loads; show a target approach speed per flap setting |
| Checklists | `CHK` tab; fits with F3 |
| Reduced takeoff thrust | Only once there is something to gain |
| Knobs on altimeter and speed dial | Altitude bug and speed target by mouse |
| Wear or repair carried between flights | Career is outside the MVP (GAME_DESIGN) |

### Related aids outside the panel
Discussed for the same landing problem; they need their own plan or a later D5 step, and are listed so they are not lost.
- Runway pointer, final-course mark and "fly this" intercept cue on the top view's compass ring.
- On the turn line: a bar and straight stub showing where rolling out would put you (allowing for roll-out lag), and a "turn now" arc. The line would have to reach past the ring, which is about 750 m (11 s) at the default air zoom.
- Look-ahead camera with the plane low in the top view (about 1 km ahead is visible now), auto-framing, inset map.
- Target height and speed marks along the center line; PAPI lights.
- Stepped practice starts: offset final, 30 deg intercept, base, downwind.

## 9. Open questions

1. **Order:** D5 before or after E4? Landing is what blocks flying the trip, which E4 depends on.
2. **Where the selector goes:** the 80 px unit beside the instruments (chosen) or a `NAV` tab in the terminal quarter (suggested later)? And what happens at 1280 x 720?
3. **Knobs:** heading and course, or heading only with course set automatically?
4. **Deviation:** angle or distance?
5. **Distance on the HSI:** displayed NM is world distance x 25, which misleads near an airport (the route readout hides it within 2 km world, E_PLAN §4.6). Show NM, time to go, or something else on final? The mockups' small NM figures ignored this.
6. **Power scale:** does `THR` also read 20 to 100?
7. **Aids outside the panel (§8):** include any in D5? The panel alone does not fix how little of the map is visible ahead.

## 10. Verification

| Check | Expectation |
|---|---|
| Unit tests | Mark angles from V-speeds; call-out timing unchanged; power mapping (0 gives 20, 1 gives 100); selected-approach course, deviation sign and size, bearing, glide error, both runway ends; list order; panel state equality includes new fields |
| `npm run typecheck`, `npm test` | Pass |
| By eye | Each instrument at 1280 x 720 and a large window; no overlap or unreadable text; console clean |
| By hand | A takeoff using only panel cues; select PHL 09R from DCA, line up from an off-center position and land |

`sim/` is not expected to change in D5A to D5D.

## 11. Risks

| Risk | Response |
|---|---|
| The HSI is unreadable at 80 px | Larger cell (§6.4); drop parts in the order in §6.2 |
| Two layouts to maintain | Settle question 2 before drawing code |
| Numbers on the HSI disagree with runway names | State the true/magnetic difference; revisit E_PLAN open question 3 |
| Instruments alone do not make landing possible | Test D5D by hand early; add the aids in §8 |
| Scope growth | §8 stays out; one tab at first |

## 12. Done when

Each step's "done when" in §2 is met, the checks in §10 pass or are named as not done, and CURRENT.md describes the new behavior.

## 13. Results

None yet.
