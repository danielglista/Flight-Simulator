# Flight Simulator: Game Design Document

**Version:** 0.3 (basic / MVP draft)
**Status:** For review.

> **All numbers are provisional.** Every numeric value in this document (scales, speeds, times, counts, limits, multipliers, targets) is a starting point and will change during development. Values marked *(tune)* are the ones expected to change most.

**Scope:** What the game is and how it plays. Technology choices belong in the architecture document.

## 1. Overview

A 2D flight simulator with believable physics, real geography and real radio procedures, condensed into flights that take minutes. The player flies using a top-down view and a side view together, and talks to ATC and other characters through a text terminal.

**Core experience:** you are busy in the way a pilot is busy. You manage energy, altitude, heading and radio calls, in a short session with a retro pixel look.

### Design pillars

1. **Real principles, simplified workload.** Lift, drag, stalls and energy matter. Switch-by-switch procedures do not.
2. **Snappy.** Little dead time. Real flights of hours become flights of minutes; there is no fixed duration to hit.
3. **Two views, one airplane.** The top view answers "where am I going?" The side view answers "how high, how fast, how steep?" Both are needed to fly well.
4. **The radio is gameplay.** Clearances affect how you fly, and characters respond to what you do.

**Complexity target:** more than Grand Theft Auto, less than Microsoft Flight Simulator. A new player should complete a flight within their first few attempts.

## 2. Core loop

1. **Pick a flight:** origin, destination, aircraft.
2. **Get clearance and weather:** route, initial altitude, squawk code, conditions.
3. **Push back and taxi** to the assigned runway.
4. **Take off and climb,** following ATC instructions.
5. **Cruise:** navigate, handle weather, traffic and handoffs.
6. **Descend and approach:** speed, altitude and heading get tight.
7. **Land and taxi in,** then receive a debrief.
8. **Fly again,** from the new airport or another route.

**Debrief grades:** touchdown rate, centerline and touchdown point, ATC compliance, separation, flight time.

**Failure:** crash, overrun, or stall into terrain. Restart should be near-instant. ATC violations lower the grade but do not end the flight.

## 3. UI and screens

All panels are visible at once in the default layout.

```text
+-------------------------------+--------------------------------+
|                               |                                |
|   TOP-DOWN VIEW               |   SIDE VIEW                    |
|   map, airports, traffic,     |   terrain profile,             |
|   route                       |   aircraft attitude            |
|                               |                                |
+-------------------------------+--------------------------------+
|   INSTRUMENTS AND CONTROLS    |   COMMS TERMINAL               |
|   SPD ALT V/S HDG PITCH BANK  |   radio log                    |
|   THR FLAPS GEAR AP           |   quick replies [1]-[4]        |
|   flight checklist            |   > text input                 |
+-------------------------------+--------------------------------+
```

The two views sit side by side at equal size.

### Top-down view
- Aircraft centered; north-up by default, with heading-up as an option.
- Shows terrain, water, cities, roads, airports, runways, traffic and the assigned route.
- Zooms from airport scale to regional scale. Zoom adjusts automatically by phase, with manual override.

### Side view
- **Always shows a vertical slice of the world along the aircraft's current heading,** with the aircraft facing right. As the player turns, the slice ahead updates.
- Shows terrain, runway, glide path, clouds and aircraft pitch, flaps and gear.
- Shows traffic only when it is close to that slice.
- Zooms in on approach so the flare can be judged.

### Instruments
A **graphical 16-bit cockpit panel**: drawn gauges with moving needles, an artificial horizon, a rotating compass, flap and gear indicators, levers and warning lights. Numbers support the gauges rather than replace them. It shows: airspeed, altitude, vertical speed, heading, pitch, bank, throttle, flaps, gear, autopilot state and distance to the next waypoint. Warnings: stall, terrain, traffic, overspeed, gear.

### Comms terminal
- A text panel styled to match the pixel look.
- Scrolling log labelled by speaker: `TWR`, `DEP`, `CTR`, `APP`, `COPILOT`, `TRAFFIC`, `GROUND`.
- Number keys pick quick replies. `Tab` moves focus to typed input.
- The current clearance stays pinned at the top so the player need not remember it.

### Visual direction
**16-bit era** pixel art: rich but limited palettes, detailed sprites, layered parallax in the side view, and tile-based terrain in the top view. Nearest-neighbor scaling, with one palette across all panels. Internal resolution and exact palette are to be decided.

## 4. World

Real place names and recognizable geography, simplified. Elements: land, water, rivers, lakes, coastlines, mountains, cities, roads, buildings, airports and runways.

### 4.1 Scale model

One scale cannot serve everything. At a single 1:40 scale, a 7,000 ft runway would be 175 ft long. Each quantity therefore gets its own scale:

| Quantity | Starting scale *(tune)* | Reason |
|---|---|---|
| Distance between places | 1:40 | Turns hours into minutes |
| Airports and runways | 1:2 | Leaves room to take off and land at real speeds |
| Altitude and terrain height | 1:10 | Climbs fit in the time available at plausible angles |
| Airspeed | 1:1 | Familiar numbers; physics stays intact |
| Aircraft sprites | Not to scale | Readability |

As an illustration only, these values make a 1h30m flight such as DC to Chicago last a few minutes.

*World* units are what the physics uses. *Displayed* units are what the player and ATC see.

- **Distance:** displayed as real nautical miles (world x 40).
- **Altitude:** displayed as real feet (world x 10).
- **Vertical speed:** displayed in unscaled world ft/min so it reads normally. The altimeter will therefore move 10x faster than V/S suggests. Test whether this bothers players.

### 4.2 Weather
Weather affects flying, visibility and ATC, and is visible in both views.

| Element | Effect |
|---|---|
| Wind | Drifts the aircraft; sets the active runway; headwind, tailwind and crosswind on landing |
| Cloud and visibility | Hides terrain and runway; makes instruments matter |
| Rain | Lowers visibility; lengthens braking distance |
| Turbulence | Disturbs pitch, bank and altitude |
| Storm cells | Severe turbulence; the player requests a deviation around them |

MVP weather is chosen per flight from presets such as clear, windy, overcast and stormy. Conditions may differ between origin and destination. Live real-world weather can come later.

### 4.3 Consequences of scale
- **Close airports collide.** DCA and IAD, about 20 nm apart, would be only about 3,000 ft apart in world units, less than one enlarged runway. Use one airport per metro area at first.
- **Cities and roads are symbolic.** Show landmarks and major features rather than full street grids.
- **Slopes look about 4x steeper,** because height is compressed less than distance. This suits the side view.
- **Longer flights scale up.** Flight time grows with distance and varies with how the player flies. Optional time acceleration can come later.

## 5. Flight mechanics

### 5.1 Physics
A simplified force model:

- **Lift:** `L = 0.5 x air density x speed^2 x wing area x Cl`. Cl rises with angle of attack, then falls past the stall angle.
- **Drag:** `D = 0.5 x air density x speed^2 x wing area x Cd`, where Cd includes parasitic and induced drag plus gear and flaps.
- **Thrust:** throttle, with spool lag and loss at altitude.
- **Weight:** constant in the MVP.
- **Turns:** banked lift provides the turn, so steep turns need more lift and lose energy.
- **Wind:** aerodynamic forces use airspeed, so wind changes ground speed and track.
- **Ground:** rolling resistance, brakes, ground steering, taxiing and runway limits.

**Simplified:** coordinated turns with no independent yaw in flight, no spins, no center-of-gravity modeling. Fuel burn, ground effect and failures come later. Air density uses displayed altitude.

### 5.2 Arcade allowances
Real turns and acceleration feel slow in a condensed world, so these are explicit, tunable values:

| Allowance | Start *(tune)* |
|---|---|
| Turn rate multiplier | 2x |
| Ground acceleration multiplier | 1.5x |
| Pitch and roll damping | Pitch holds its attitude when keys are released; a bank under 10 deg settles to level, a steeper bank holds (it must not rescue itself) |
| Load limit on the pitch keys | Nose-up fades out near 4 g and in a stall, nose-down near -1 g; no structural failure |
| Turn help | Automatic nose-up in banks up to 30 deg, so shallow turns hold height |
| Touchdown limits | Forgiving |

### 5.3 Controls

Keyboard first; gamepad later. Keys are provisional.

| Action | Key |
|---|---|
| Pitch down / up | W / S |
| Bank left / right (steer on ground) | A / D |
| Throttle up / down | E / Q |
| Flaps extend / retract | F / R |
| Gear | G |
| Brakes | Space |
| Autopilot hold (heading and altitude) | Z |
| Quick replies | 1-4 |
| Focus terminal / return to flying | Tab / Esc |
| Map zoom | Mouse wheel |
| Pause / resume | P |
| Top-view follow again after free look | C |
| Restart after a crash (provisional, from B3) | Enter |
| Show / hide debug panel (developer, from B4) | Backquote (`) |

### 5.4 Co-pilot assist while typing
Typing sends flight keys to the terminal, so the co-pilot takes over **to an extent**. It is a steady pair of hands, not a rescue.

| Situation when typing starts | What the co-pilot does |
|---|---|
| Stable flight | Holds the current heading and the current altitude, climb or descent |
| Mild bank or pitch | Gently levels the wings, then holds |
| Stall, steep bank, dive, or terrain, traffic or overspeed warning | **No recovery help.** Controls go neutral and the aircraft keeps its momentum |
| Takeoff roll, flare, landing roll | No help; controls go neutral |
| Taxiing | Holds course and speed; does not steer or stop for obstacles |

- The co-pilot never adds throttle, avoids terrain or traffic, flies a clearance or lands.
- If a stable situation becomes dangerous while typing, the co-pilot calls it out and returns control to the player.
- `Esc` returns control at once. Quick replies never take the player off the controls.
- Toggling the terminal must not work as an escape: a dangerous state stays unassisted until the player restores stable flight.

The autopilot (`Z`) follows the same limits: it engages only in stable flight.

### 5.5 Aircraft
One fictional twin-engine regional jet for the MVP. Later: light prop, turboprop, airliner.

## 6. ATC and communication

### 6.1 Principle
**The game decides; language only expresses.** A rules-based ATC system tracks flights and issues every clearance. The text parser and LLM interpret the player and add voice. They cannot invent clearances or change game state directly.

### 6.2 ATC flow
Clearance -> Ground -> Tower -> Departure -> Center -> Approach -> Tower -> Ground.

Instructions: pushback and taxi, takeoff and landing clearance, heading, altitude, speed, frequency handoff, approach clearance, go-around, traffic advisory, weather advisory.

```text
TWR      Skylark 214, wind calm, runway 1, cleared for takeoff.
YOU      Cleared for takeoff runway 1, Skylark 214.
DEP      Skylark 214, radar contact. Turn left heading 290, climb FL240.
YOU      Left 290, climb FL240, Skylark 214.
CTR      Skylark 214, traffic two o'clock, opposite direction, FL250.
YOU      Looking for traffic, Skylark 214.
```

The callsign is a placeholder.

### 6.3 Flight checklist
Radio volume comes from a **checklist of required steps**, not a fixed number of calls. Every flight has the core items; longer, busier or stormier flights add more.

| Phase | Core items (every flight) | Added when relevant |
|---|---|---|
| Ground out | Route clearance, pushback, taxi clearance | Hold short, traffic crossing |
| Departure | Takeoff clearance, initial heading and altitude | Line up and wait |
| En route | Cruise altitude, heading to destination | Handoffs, altitude changes, traffic, weather deviation |
| Arrival | Descent, approach heading, approach clearance | Speed control, holding |
| Landing | Landing clearance | Go-around |
| Ground in | Taxi to gate | Hold short |

- Items are offered in order as their conditions are met. Short flights combine items into one call.
- The player can see the checklist, with done, current and upcoming items.
- A correct readback takes one key press.

**Deviation:** if the player strays from a clearance, ATC may comment.

- A **cooldown** applies across all deviation calls, so ATC never spams the player.
- Deviations that occur together merge into one call, most important first.
- Small deviations get a grace period. If the problem is corrected before the cooldown ends, no further call is made.
- Safety-critical calls (conflict, terrain, go-around, occupied runway) bypass the cooldown, but each has its own repeat limit.
- Deviations and missed required items affect the debrief grade.

**Timing:** traffic warnings trigger on **time to conflict**, not miles: two jets closing head-on cover about 10 displayed nm per second. Separation minimums need game-specific values for the same reason.

### 6.4 Understanding the player

| Layer | Role | When |
|---|---|---|
| 1. Quick replies | Context-sensitive choices | MVP |
| 2. Keyword parser | `request FL280`, `say again`, `unable`, `request vectors` | MVP |
| 3. LLM | Maps free text to a supported intent; gives characters personality | MVP |

The LLM is a core feature, but the game must stay playable without it. If it is slow, unavailable or unsure, the game falls back to layers 1 and 2. Routine ATC never waits on it. Build it first for the co-pilot and ground crew, whose dialogue is less time-critical, then for free-text ATC requests. The game calls a hosted LLM such as the Claude API; see the architecture document for how the key is handled.

### 6.5 Other traffic
AI aircraft follow simple routes using the same world and ATC rules, with simplified physics. MVP: 3-6 aircraft at once, taking part in occasional radio exchanges and at least one traffic advisory.

## 7. MVP

**Goal:** prove that flying with two linked views while handling the radio is fun for one complete, condensed gate-to-gate trip.

| In | Out (later) |
|---|---|
| DCA to ORD, and the return | More airports; national map |
| One regional jet | More aircraft |
| Top view, side view, instruments, terminal | Multiple windows or monitors |
| Physics in section 5, including stalls | Fuel, failures |
| Preset weather: wind, cloud, rain, turbulence, storm cells | Live real-world weather |
| Simplified terrain, water, mountains, cities, roads | Detailed cities, night, seasons |
| Gate to gate: simple pushback, taxi routes, basic ground crew dialogue | Detailed ground services, full taxiway networks |
| Rules-based ATC, checklist, quick replies, keyword parser | Voice input and output |
| LLM for co-pilot, ground crew and free-text requests, with fallback | LLM for every character; long-term memory |
| Limited co-pilot assist while typing | Co-pilot that flies procedures |
| 3-6 AI aircraft | Dense traffic |
| Basic autopilot hold | Full flight management |
| Landing grade and debrief | Career, progression, economy |
| Placeholder 16-bit-style art; basic engine and alert sounds | Final art, music, voice |

### Success criteria
- Testers describe flights as snappy, with little dead time.
- A new player lands successfully within 5 attempts.
- Stalls, climbs and turns behave in ways a player can predict.
- Players use both views, not just one.
- Radio adds tension without making players lose control.
- Testers choose to fly a second time.

### Build order
World -> movement -> flight physics -> cockpit -> a full route -> radio -> traffic, ground and weather -> art and polish. The small steps are listed in [ARCHITECTURE.md](ARCHITECTURE.md), section 14.
## 8. Risks

| Risk | Response |
|---|---|
| Two views split attention | Test early; emphasize the more useful view by phase |
| Mixed scales feel wrong | Keep every scale and multiplier configurable |
| Flying and typing overload the player | Quick replies, pinned clearance, co-pilot hold |
| Condensed flights leave little room for ATC | Combine or shorten calls; adjust scale by feel |
| LLM is slow, costly or unreliable | Never authoritative; always has a fallback |
| Taxiing drags in a snappy game | Short routes, enlarged aprons |
| MVP is larger with taxi, weather and LLM | Simple versions of each; runnable build after every small step |
| Scope growth | Use the MVP table as the boundary |

## 9. Open questions

1. **Screens:** panels in one window, or support for separate monitors? *Working assumption: one window.*
2. **Long-term mode:** free flight, missions, or an airline career?
3. **Multiplayer:** ever planned? This affects the architecture early. *Working assumption: no.*
4. **Title:** to be decided.

## 10. Decisions

- **Platform:** browser first, on desktop computers with a keyboard. A packaged desktop version can come later.
- **Layout:** top-down and side views are side by side.
- **Art:** 16-bit era.
- **Scale:** the separate-scale model in 4.1 is accepted for now.
- **MVP scope:** taxiing, weather and LLM communication are core.
- **Co-pilot:** limited help while typing, with no rescue from danger.
- **ATC:** checklist-driven calls; deviation comments limited by a cooldown.
- **Flight length:** no target duration. "DC to Chicago in about 3 minutes" only illustrates how much the world is condensed. Scale is tuned by feel.
