# Flight Simulator: Architecture Document

**Version:** 0.2 (draft for review)
**Companion to:** [GAME_DESIGN.md](GAME_DESIGN.md) v0.3

> **All numbers are provisional,** as in the design document. Nothing here has been prototyped yet.

## 1. Goals

1. **Headless simulation.** Physics, ATC, traffic and weather run without a screen, so they can be tested quickly.
2. **Tunable.** Scales and arcade allowances live in one config and can change while the game runs.
3. **Responsive.** Nothing in the flight loop waits on the network or the LLM.
4. **Small.** Few dependencies, and no structure before it is needed.

Assumptions: desktop browser, one window, single player.

## 2. Technology

| Area | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict | Typed data catches unit and state mistakes |
| Build | Vite | Fast reload and simple static output |
| World views | Canvas 2D at low internal resolution | Enough for two 16-bit views; no engine to learn |
| Instruments | Canvas 2D | Pixel-art gauges with moving needles |
| Terminal, menus | HTML and CSS, pixel styling | Text input and accessibility come free |
| State and UI | Plain TypeScript; no UI framework at first | Few panels; add one only if needed |
| Audio | Web Audio API | Engine pitch and alerts |
| Tests | Vitest; Playwright later | Headless tests first, then browser smoke tests |
| LLM | Claude API, added in step F7 | Free text and character dialogue; no separate server in development |
| Hosting | Static files | Game still runs if the LLM is unavailable |

**Alternatives:** Phaser or PixiJS would help if Canvas 2D misses its performance target. Drawing stays behind a renderer module, so switching would not affect the simulation. A full physics engine is not useful because the flight model is custom.

## 3. Overview

```text
 keyboard ---> INPUT ---> commands ---+
                                     v
 terminal ---> COMMS ---> intents --> SIMULATION (fixed step, headless)
                 |                    flight | weather | traffic | ATC
                 | free text                 |
                 v                           | snapshots + events
            CLAUDE API                       v
            (optional)          VIEWS: top | side | instruments
                                TERMINAL | AUDIO | DEBRIEF
```

- **Commands and intents are the only ways in.** For example: set elevator, toggle gear, request altitude.
- **Snapshots and events are the only ways out.** Views read them and never change the simulation.
- `sim/` imports nothing from the browser, views, input or network.

### Project layout

```text
src/
  app/        startup, main loop, screens
  config/     scales, tuning, aircraft definitions
  sim/        world state, step function
    flight/   forces, ground handling, autopilot, co-pilot assist
    world/    coordinates, terrain, airports
    weather/
    traffic/
    atc/      clearances, checklist, deviations, radio queue
  comms/      quick replies, parser, LLM client
  input/      key bindings, focus
  views/      top, side, instruments, terminal, debrief
  audio/
data/         processed map, airport and route files
tools/        map-processing scripts
tests/
```

## 4. Simulation loop

- **Fixed step of 60 Hz.** Rendering follows the display and interpolates between the last two states.
- **Catch-up limit:** at most 5 steps per frame; drop the remainder to avoid a freeze spiral.
- **Losing focus or hiding the tab pauses the game** and clears held keys.
- **Seeded random numbers** for weather and traffic, with a separate stream for each.
- **Replay:** seed, config version and timed commands reproduce a run in the same build and browser engine. Exact matches across browsers are not promised. LLM results are recorded as intents, so replay never calls it.

Order within each step: commands -> weather -> player flight -> traffic -> ATC -> grading -> events. ATC, traffic decisions and grading can run at 5-10 Hz.

## 5. Coordinates and scale

The physics uses one coordinate system: **world meters** (x east, y north, z up), SI units throughout, angles in radians. Conversion to knots, feet, nautical miles and degrees happens only at display and ATC boundaries.

```ts
interface ScaleConfig {
  geoDistance: number; // 40: real map distance / world distance
  airport: number;     // 2:  real airport size / world size
  altitude: number;    // 10: real height / world height
}
```

| Quantity | Conversion |
|---|---|
| Place position | Latitude/longitude -> map projection -> divide by `geoDistance` |
| Airport layout | Local meters -> divide by `airport` -> add airport anchor |
| Terrain height, altitude | Divide by `altitude` |
| Displayed altitude | World height x `altitude` |
| Displayed distance | World distance x `geoDistance` |
| Airspeed, wind, V/S | Unscaled |

**Rules**
- Use distinct types or names for real, world and displayed values. Mixed units are the likeliest source of bugs.
- Use one regional map projection centered on the map. A national map may need another.
- Airports sit on local patches that replace compressed terrain, flatten the ground, and blend at the edges. Nearby rivers and shorelines may need hand adjustment.
- Displayed distance applies between places. Runway length and taxi distances must use the airport scale; otherwise a runway would read as many miles long.
- Terrain height is stored in real meters and divided by `altitude` when read.
- Validate that airport patches do not overlap at load time.

## 6. Flight model

State: position, airspeed `V`, flight-path angle `g`, air heading `h`, pitch, bank `b`, throttle and engine spool, flaps, gear, ground contact.

```text
angle of attack a = pitch - g
q  = 0.5 * rho * V^2
L  = q * S * Cl(a, flaps)
D  = q * S * Cd(Cl, flaps, gear)

dV/dt = (T*cos(a) - D) / m - G*sin(g)
dg/dt = ((L*cos(b) + T*sin(a)) / m - G*cos(g)) / V
dh/dt = turnMult * L*sin(b) / (m * V * cos(g))
velocity = airVelocity(V, g, h) + wind
```

`G` is gravity, `rho` uses displayed altitude, and the heading convention is clockwise from north. Below a minimum speed, the ground model takes over or the divisors are clamped.

- **Cl** rises linearly, then falls past the stall angle. Smooth curves avoid sudden jumps.
- **Keys command pitch and bank rates** with damping, limited by low-speed control authority. Control strength fades near the stall.
- **Turn help:** optional automatic pitch compensation below a moderate bank.
- **Ground:** rolling friction, brakes (reduced by rain), speed-dependent steering, gear loads, and a touchdown check on vertical speed, bank and runway position.
- **Airspeed display:** indicated airspeed, derived from density. Ground speed is shown separately. Compressed altitude means climbs and descents exchange less energy than the altimeter suggests, so tune thrust and drag by feel.

### 6.1 Co-pilot assist

```text
MANUAL --terminal focus, stable--> ASSIST --danger--> MANUAL + callout
MANUAL --terminal focus, unstable--> NEUTRAL --Esc--> MANUAL
ASSIST --Esc--> MANUAL
```

- A shared `isStable(state)` test covers bank, pitch, angle of attack, speed, warnings and phase. It also gates the autopilot.
- Stable needs to hold briefly before assist engages, so toggling the terminal is not an escape.
- In a mild bank or pitch, assist levels gently with limited authority. It never touches throttle.
- When danger interrupts typing, focus returns to flying, held keys clear, and the draft text is kept.
- Taxi assist holds course and speed only.

## 7. World and map data

The world is a **2D grid of cells**. Each cell stores elevation and terrain type.

### 7.1 Base grid

| Property | Starting value |
|---|---|
| Cell size | 10 x 10 world meters (400 x 400 real meters at 1:40) |
| Elevation | 16-bit integer, real meters above sea level |
| Terrain | 8-bit code: water, grass, forest, farmland, desert, mountain, snow, urban, road, airport |
| Chunk | 256 x 256 cells; load only those nearby |

- The two layers are separate typed arrays, about 3 bytes per cell before compression. A DCA-ORD region of 25 x 15 km in world size is 3.75 million cells, or about 11 MB uncompressed.
- Files are compact binary chunks, compressed for download, not a JSON or text array.
- Elevation is interpolated between cells so the ground is smooth. Terrain type uses the nearest cell.
- The top view turns terrain codes into 16-bit tiles, choosing edge tiles from neighboring cells. One map cell need not equal one screen pixel.
- The two layers can be exported to and imported from images, so the map can be painted by hand.

### 7.2 Airports: fine grid plus objects
A 10 m cell is too coarse here. A 45 m wide runway is about 22 m at 1:2 scale, or two cells, and an angled runway would look like stairs. Each airport therefore has an **overlay** that replaces the base grid inside its boundary:

1. **Fine grid,** about 1-2 m per cell: grass, pavement, taxiway, water, plus elevation. A 2 x 2 km airport at 2 m is one million cells.
2. **Objects with exact coordinates:**
   - runways: two endpoints, width, heading, name
   - taxi graph: nodes, edges, hold-short points
   - gates and parking positions
   - buildings: footprint, height, sprite

The grid handles appearance and ground surface. The objects handle logic such as "is the aircraft on runway 1?", taxi routes, landing scores and ATC, where exact shapes matter. Runways are drawn from their objects at any angle, and paint over the grid.

Height blends at the boundary so the overlay meets the surrounding terrain. Lookup order: runway object -> airport fine grid -> base grid.

### 7.3 Other features
Rivers, coasts, cities and wide roads are painted into the grid. City names, waypoints, landmarks and thin roads are separate point or line objects, because they need labels or are thinner than a cell. Landmark buildings have a height so they appear in the side view.

### 7.4 Data sources

| Data | Candidate source | Use |
|---|---|---|
| Coast, rivers, lakes, cities, major roads | Natural Earth | Painted into the grid by script |
| Elevation | Public USGS or NOAA data | Sampled at each cell |
| Airport and runway positions | OurAirports | Starting point, checked by hand |
| Taxiways, gates, buildings | Hand-authored | Airport overlay |

`tools/` scripts build the files ahead of time; the game downloads nothing from map services. Confirm licenses and attribution before shipping. Data is for entertainment, not navigation.

**Runtime queries:** `heightAt(x, y)`, `surfaceAt(x, y)`, `sliceAlong(origin, heading, length, samples)`, and nearby airports. Views and collision use the same functions.
## 8. Views

Both views use the same interpolated snapshot.

**Top view:** tile terrain, then water, roads, cities, airport patch, weather, route, traffic, aircraft, labels. Cache terrain chunks to offscreen canvases.

**Side view:** samples terrain along the heading each frame, with the aircraft facing right. Parallax sky sits behind it.
- At close zoom, horizontal and vertical scale match so the flare reads correctly.
- At wide zoom, vertical exaggeration keeps altitude readable, and the aircraft sprite keeps its true pitch.
- Objects appear only within a corridor either side of the slice.
- Smooth fast heading changes so terrain does not flicker.

**Pixel handling:** draw at a fixed low resolution and scale by whole numbers where possible. Labels use a pixel font. Terminal text stays sharp and readable.

**Instruments:** a third canvas draws a layered 16-bit cockpit panel: a static panel image, then needles, artificial horizon, compass card, levers and warning lights. Needle angles come directly from the snapshot, and are drawn as pre-rendered rotation frames or at low resolution to keep the pixel look. Important values also exist as hidden HTML text for screen readers.

**Starting layout:** two equal canvases above instruments and terminal, with a supported minimum of 1280 x 720.

## 9. Weather and traffic

**Weather** exposes `weatherAt(position, time)`, returning wind, turbulence, visibility, cloud and rain. A preset defines origin, destination and en-route conditions, blended by position, plus moving storm cells. Physics, views and ATC all use this one query.

**Traffic** uses the same coordinates with a simplified path-following model: speed, climb and turn limits, with no stall physics. Aircraft follow a route and obey ATC clearances. On the ground they use the taxi graph and reserve runway or intersection segments.

**Conflict detection** predicts closest approach with relative position and velocity, then alerts on time and predicted separation. Vertical separation uses displayed feet; horizontal thresholds use tuned world distance.

## 10. ATC

ATC is rules-based and owns all clearances.

```ts
interface Clearance {
  id: string;
  heading?: number;
  altitudeFt?: number;        // displayed
  speedKt?: number;
  runway?: string;
  action?: 'pushback' | 'taxi' | 'takeoff' | 'approach' | 'land' | 'goAround';
  status: 'issued' | 'readBack' | 'active' | 'done' | 'cancelled';
}
```

| Part | Job |
|---|---|
| Flight controller | State machine per aircraft: gate -> taxi -> departure -> en route -> arrival -> landed |
| Checklist | Data-driven items with trigger, completion test and phase |
| Clearance manager | Validates, issues, replaces and tracks readbacks |
| Runway manager | Occupancy and takeoff/landing sequence |
| Deviation monitor | Grace period, merge, shared cooldown |
| Safety monitor | Conflict, terrain, occupied runway, go-around; separate repeat limits |
| Radio queue | One speaker at a time, by priority; drops messages that are out of date |
| Phrasebook | Turns structured messages into text templates |

A critical readback comes from structured data: the player's parsed values are compared with the issued clearance.

## 11. Communication and LLM

```text
quick reply ----------------------------> Intent --+
typed text -> parser -- match ----------> Intent --+-> validate -> simulation
                  \-- no match -> LLM --> Intent --+
                                  \-- fail/unsure -> "Say again" + suggestions
```

```ts
type Intent =
  | { kind: 'readback'; clearanceId: string; heading?: number; altitudeFt?: number }
  | { kind: 'request'; what: 'altitude' | 'vectors' | 'deviation' | 'landing'; value?: number }
  | { kind: 'sayAgain' }
  | { kind: 'unable' }
  | { kind: 'smallTalk'; to: 'copilot' | 'ground' };
```

**LLM roles**
1. **Interpret:** return one allowed intent as structured output, or `unknown`.
2. **Voice:** write a short co-pilot or ground crew line from supplied facts.

**Safeguards**
- The LLM cannot call simulation functions. Every result is schema-checked, then validated against current game rules.
- All clearances and safety calls use templates. LLM voice never carries operational numbers.
- Each request includes a context number. Late results for an old situation are discarded.
- Time out after about 2.5 s and show a fallback. The simulation keeps running.
- Player text is untrusted: limit its length, treat it as data, and render it as plain text, never HTML.
- Set a spending limit on the API account and disable automatic retries, so a slow call fails over quickly.

**API access and the key**

The Claude API is already the remote service; the game does not need to run an LLM server. The only question is where the API key lives, because anything shipped in a public web page can be read and used by anyone.

| Situation | Approach |
|---|---|
| Development | The Vite dev server forwards calls, with the key in a git-ignored `.env` file. No separate server |
| Personal or trusted use | The browser calls the API directly with the player's own key, using the SDK's `dangerouslyAllowBrowser` option. Keep the key in memory only |
| Public release, owner pays | A small serverless function holds the key and limits usage |

Start with development. A public release chooses one of the other two later. An adapter hides the difference from the rest of the game. Direct browser calls do not work for every organization (for example, those with zero data retention), and the SDK disables them by default because they expose the key.

**Model:** `claude-haiku-5-5` by default, at low effort with structured outputs. The model is a config setting. Test it on real player phrases, and consider a larger model only if it misreads them too often.

## 12. Saving and debugging

- Settings and best grades go in `localStorage`, versioned. No accounts in the MVP.
- **Debug panel:** live scale and tuning sliders, force vectors, stability state, ATC state, conflict predictions, frame timing, weather override, jump-to-phase, replay export.

The debug panel starts in step B4 and grows as systems are added.

## 13. Testing

| Type | Examples |
|---|---|
| Unit | Conversions, lift and stall curve, conflict detection, parser |
| Simulation | Level flight, stall and recovery, climb, landing, crosswind drift |
| Scenario | Scripted pilot flies DCA to ORD and lands without violating limits |
| ATC | Checklist completes; cooldown prevents spam; safety calls bypass it |
| Co-pilot | No rescue from each dangerous state; no toggle exploit |
| LLM | Recorded good, malformed, slow and hostile responses |
| Browser | Loads, accepts input, completes a smoke flight |

Invariants: no NaN values, no tunnelling through terrain, no ATC message without a current reason, and the game remains playable with the LLM disabled.

**Performance targets:** 60 frames per second on an ordinary laptop, simulation step under 2 ms, both views and instruments under 8 ms, initial download under 10 MB.

## 14. Milestones

Each step is small, ends with something to see or try, and leaves the game runnable. Steps can be reordered or split as we learn. Placeholder art is fine until phase H.

### A. See the world
| # | Step | Done when |
|---|---|---|
| A1 | Project setup and empty four-panel layout | Page opens with both views, instruments and terminal areas |
| A2 | Small hand-made grid, drawn in the top view | Land, water and mountains are visible; map pans and zooms |
| A3 | Side view of the same grid | Turning a test heading changes the terrain slice |
| A4 | One airport overlay with an angled runway | Runway is clean in the top view and correct in the side view |

### B. Move a plane
| # | Step | Done when |
|---|---|---|
| B1 | Fixed-step loop and keyboard input | A dot moves and turns; pausing works |
| B2 | Plane sprite in both views, with a follow camera | Both views agree on position and heading |
| B3 | Simple climb and descent, no physics yet | Plane can fly over a mountain and crash into it |
| B4 | Basic readouts and debug panel | Speed, altitude and heading show; tuning changes live |

### C. Make it fly
| # | Step | Done when |
|---|---|---|
| C1 | Thrust, drag and weight | Throttle and pitch trade speed for height |
| C2 | Lift, angle of attack and stall | Plane stalls and can recover |
| C3 | Banked turns | Steep turns cost energy |
| C4 | Takeoff and ground roll | Plane can leave the runway |
| C5 | Landing, crash and instant restart | A full circuit can be flown |
| C6 | Flaps, gear and brakes | They change how takeoff and landing feel |

### D. Cockpit
| # | Step | Done when |
|---|---|---|
| D1 | First graphical gauges: airspeed and altimeter | Needles follow the plane |
| D2 | Artificial horizon, compass, vertical speed | Plane can be flown mainly by instruments |
| D3 | Levers, indicators and warning lights | All controls are visible on the panel |
| D4 | Autopilot hold | Holds heading and altitude only when stable |

### E. Go somewhere
| # | Step | Done when |
|---|---|---|
| E1 | Scale config and real coordinates | Two places sit the right distance apart |
| E2 | Real terrain for the DCA-ORD region | Geography is recognizable |
| E3 | Second airport and a route line | Player can fly from DCA to ORD and land |
| E4 | Scale tuning | The trip feels snappy |

### F. Talk
| # | Step | Done when |
|---|---|---|
| F1 | Terminal with scripted messages | Messages appear as the flight progresses |
| F2 | Quick replies | Player can acknowledge a takeoff clearance |
| F3 | Clearance rules and core checklist | A full flight can be flown under ATC |
| F4 | Deviation comments with cooldown | Straying gets a response without spam |
| F5 | Typed keywords | `request FL280` works |
| F6 | Co-pilot assist while typing | Helps in stable flight, never rescues |
| F7 | Claude API for co-pilot small talk | Replies arrive; switching it off breaks nothing |
| F8 | Claude API for free-text requests | Plain English becomes a valid request |

### G. Bring it to life
| # | Step | Done when |
|---|---|---|
| G1 | One AI plane on a route | Visible in both views |
| G2 | More traffic and advisories | ATC warns about a conflict |
| G3 | Runway occupancy | Landing and departing planes take turns |
| G4 | Gates and taxi routes | Player can taxi to the runway |
| G5 | Ground control, pushback and ground crew | Gate-to-gate flight works |
| G6 | Wind | Crosswind affects track and landing |
| G7 | Cloud, visibility and rain | Conditions change how the player flies |
| G8 | Turbulence and storms | Player can ask to go around a storm |

### H. Finish
| # | Step | Done when |
|---|---|---|
| H1 | 16-bit art sample for one scene | The look is agreed |
| H2 | Art pass on terrain, aircraft and cockpit | Placeholders are gone |
| H3 | Sound | Engine and alerts work |
| H4 | Debrief and grades | Flight ends with a score |
| H5 | Menus, saving and playtest | MVP success criteria are tested |

H1 is independent and can be pulled forward at any time after A4.
## 15. Decisions and open questions

### Accepted
- TypeScript and Vite
- Canvas 2D for both views and the instruments; HTML for terminal and menus
- Headless, fixed-step simulation, separate from graphics
- One set of internal world coordinates
- Rules-based ATC; the Claude API only interprets language and adds voice
- Grid world with airport overlays
- `claude-haiku-5-5` as the default model, behind an adapter

### Working defaults, settled by building

| Question | Start with | Decide |
|---|---|---|
| Scales and arcade allowances | Current values | By feel in phases C and E |
| Base cell size | 10 m | E2 |
| Altitude vs. vertical speed scale | Vertical speed unscaled | D2 |
| Speed brake | Left out | C6 |
| Canvas performance | Assume sufficient | Measure in B2 and D3 |
| Internal resolution | Top view 640 x 360; others 320 x 200, scaled 2x | H1 |

### Later
- **API key:** development setup for now; choose a public approach before sharing the game.
- **Hosting:** none yet; a static host later.
- **Desktop version:** revisit once the browser version is fun.

Game-level questions are in [GAME_DESIGN.md](GAME_DESIGN.md), section 9.
## 16. Immediate next step

A1 is built (see [A1_PLAN.md](A1_PLAN.md) §11). Next: A2, a small hand-made grid drawn in the top view.
