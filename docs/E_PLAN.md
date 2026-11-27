# E Implementation Plan: Go Somewhere (E1 to E6)

**Status:** E1 to E3 built (§9). E3 is not yet flown by hand. E4 to E6 outlined.
**Milestone (ARCHITECTURE.md §14):** "Go somewhere", re-cut for a representative map built by a script (§2).
**Starting state:** end of D4, uncommitted in the working tree.

**E3 is built; E4 is next.** Each later step gets its details added here (or its own plan) when it starts, because E1's preview may change the numbers. One commit each, if commits are asked for.

All numbers are provisional. "World" means world meters, "real" means real meters or km. Figures marked *(computed)* come from a throwaway script, with rough coordinates and airport sizes. They are not from the game.

## 1. Goal

A **representative** USA: the geography makes sense and is recognizable, but it is neither random nor 1:1. The same inputs always produce the same map. First section: the Mid-Atlantic, with **DC and Philadelphia** and the airports **DCA and PHL**.

| Layer | What it holds | Source |
|---|---|---|
| Skeleton | Coast, large lakes and rivers, broad elevation, sea floor | Public data, coarse and smoothed |
| Authored | Cities, districts, landmarks, towns, airports, ridges, exaggeration, highways | Data files in lat/lon, edited by us |
| Detail | Ground patches, ridge texture, streets and ordinary buildings | Seeded noise, fixed seed |
| Overrides | Hand fixes, applied last | Data file; regenerating never erases it |

## 2. Steps

| # | Step | Done when |
|---|---|---|
| E1 | Scales, projection, city warp, airport placement, preview image | DC, Philly, DCA and PHL sit sensibly in a preview at 1:20, 1:25 and 1:30, and you have picked a scale |
| E2 | Real coast, water and elevation, mountain rules, guardrails | The preview is recognizably the Mid-Atlantic |
| E3 | Load the map in the game, DCA and PHL, route line | Player can fly from DCA to PHL and land |
| E4 | Scale tuning by flying | The trip feels right; scales are fixed for now |
| E5 | Highways, districts, buildings, obstacle collision | DC and Philly look like cities in both views, and a building can be hit |
| E6 | Landmarks, small towns, one small airport | DC and Philly are told apart at a glance |

Flying (E3, E4) comes before buildings (E5), because a scale change moves every city.

| Out | Where it belongs |
|---|---|
| Other cities (Baltimore, New York, Pittsburgh), Chicago, the rest of the USA | After E6: more data, same generator |
| Chunk streaming from disk | When the map outgrows memory. Full USA at 1:25 is about 210 million cells, roughly 850 MB raw |
| Gates, terminals, taxi graph, full taxiway networks | G4, G5. E3 only leaves room |
| ATC distance wording near airports (§4.6) | F3 |
| Runtime scale sliders | Dropped: scales are baked into the map. Rerun the generator instead |
| Final art for terrain and buildings | H |

## 3. Decisions so far

| Question | Decision |
|---|---|
| How is the map made? | A script driven by data files, not a one-shot generated map |
| Skeleton | Real coarse data |
| Distance between places | 1:25 to start; preview 1:20, 1:25 and 1:30 |
| Major airports | 1:2 (was 1:1.5; changed after the E2 preview: 1:2 lets the real shoreline and river approaches survive) |
| Small airports | 1:2 |
| City cores | 1:4 |
| Altitude and terrain | 1:5, unchanged |
| Building height | 1:3 (so a little tall against a 1:4 footprint) |
| Hitting a building | Is a crash |
| Rockies | About 10,000 ft peaks, over an unchanged plateau (§5.2). Not used in this section |
| First cities | DC and Philly only |

## 4. E1 in detail

**In:** pure coordinate code, data files for the four places, a preview tool, tests.
**Out:** any change to the game, any download, any terrain. E1 cannot break anything that flies today.

### 4.1 Projection

Cylindrical, true at 39 N, centered on 96 W:

```text
xReal = (lon + 96) * 111.32 km * cos(39 deg)
yReal = (lat - 39) * 111.0 km
```

- **North is up everywhere**, so grid headings equal compass headings. Conic projections look better on a wall map, but would tilt north by about 12 deg at DC, which would put runways and the compass at odds.
- Cost: east-west distances are stretched about 14% near Seattle and shrunk about 14% near Miami. Negligible in this section.
- One projection for the whole country, so sections join later. ARCHITECTURE §5 says "regional"; that changes in E1.
- The real curvature of the Earth is ignored.

### 4.2 Scale profile

```ts
interface MapScales {
  geoDistance: number;    // 25
  airportMajor: number;   // 1.5
  airportSmall: number;   // 2
  cityCore: number;       // 4
  altitude: number;       // 5, from SCALES, not repeated
  buildingHeight: number; // 3
}
```

A copy is written into each generated file, so a map always says what it was built at.

### 4.3 City warp

Around each city the real distance `r` from its center becomes a world distance `f(r)`:

| Real distance | Scale |
|---|---|
| 0 to 4 km | 1:4 (the core) |
| 4 to 8 km | ramps from 1:4 to the plateau |
| 8 to 80 km | a constant plateau, solved so the ring ends exactly where it should |
| 80 to 90 km | ramps to 1:25 |
| Beyond 90 km | unwarped: `f(r) = r / 25` |

Slope is linear across each ramp. The plateau `p` follows from the total length, so there is nothing to fit:

```text
0.5*4*(1/4 + p) + 72*p + 0.5*10*(p + 1/geo) = 90/geo - 4/4     (km)
```

At 1:25 the plateau is about **1:42**; at 1:20, about 1:29 *(computed)*. If `p` is not positive the ring is too small, and the tool must fail with a clear message.

- **Why not a smooth spline:** the obvious one (monotone rational) squeezed part of the ring to 1:140 or worse *(computed)*, because it spends too much distance easing. The plateau is the gentlest squeeze possible.
- **Why 90 km:** the larger the ring, the lower the squeeze. DC and Philly are about 200 km apart, so two 90 km rings (180 km) fit without touching. The tool fails if rings overlap; denser regions will need smaller rings or a combined warp.
- **Continuity:** coasts, rivers and highways pass through the same function, so they stay joined. Seams are also hidden because trees, fields and roads are drawn at one size everywhere; only the spacing of places changes.
- **Known cost:** inside the ring, directions are treated unequally. At 20 km out, the radial scale is about 1:42 but the sideways scale is about 1:11, so a round lake becomes an oval around the city. **This is the main thing the preview has to judge** (§8).
- The generator needs the inverse as well (world to real), by bisection.

### 4.4 Airport placement

Airports are **stamps**, not warped. Each has its own scale and an axis-aligned boundary, and starts at its warped position. If its boundary plus a 100 m gap overlaps its city's core box, it is pushed outward along the real bearing from the city until clear.

| Airport | Assumed real boundary | World size at 1:1.5 | Warped distance from city | After push |
|---|---|---|---|---|
| DCA | 2.0 x 2.5 km | 1.3 x 1.7 km | 1.0 km | 1.7 km south |
| PHL | 5.0 x 2.5 km | 3.3 x 1.7 km | about 1.6 km | 2.0 km southwest |

The DC core box is 2.0 x 1.5 km and Philly's is 2.0 x 1.25 km. The push is an explicit number in the preview, and a data file may override it by hand.

Resulting trip *(computed, straight line, 250 kt)*:

| geoDistance | City to city | Airport to airport | Time |
|---|---|---|---|
| 1:20 | 10.0 km | about 9.1 to 9.2 km | about 71 s |
| **1:25** | **8.0 km** | **about 7.2 km** | **about 56 s** |
| 1:30 | 6.7 km | about 5.9 km | about 46 s |

These replace the 6 to 6.5 km (about 50 s) estimated in chat. All are short for a whole flight: **choose the scale for how the map looks and how the two approaches fit, not for this trip's length.** A 4 km approach at PHL alone is over half the 1:25 trip.

### 4.5 Map box

38.2 to 40.7 N, 78.4 to 73.9 W. At 1:25: about 15.6 x 11.1 km, 1.7 million 10 m cells, about 7 MB raw. The test map is 1.05 million cells. (The box discussed earlier stopped at 74.6 W, which misses most of the Jersey shore and leaves a short final for PHL.)

The box is unwarped at its edge, and the preview draws an approach corridor (4 km each way) for each airport, to show it stays on the map.

### 4.6 Displayed distance

`geoDistance` applies between places. Near an airport it misleads: 10 displayed nm is only 740 world m, less than the runway. E3's distance readout and F's ATC wording must handle this. Candidates: named fixes, time to go, or a blended scale. Not decided here.

### 4.7 Preview

`node tools/preview.mjs` writes one PNG per scale to `tools/out/` (git-ignored). Each shows:

- map box, 1 world km grid, and a 10 real km grid **after warping** (so the squeeze is visible)
- city cores, ring edges, airport boundaries, approach corridors, real versus pushed positions
- distances and times as text in a JSON file beside it, and on the console

PNG is written with Node's built-in `zlib`; no new dependency. Text is not drawn in the image: colors have a key on the console.

### 4.8 How tools run

Pure code is TypeScript in `tools/map/`, with no Node imports, so it is type-checked and tested like the rest. File access is in `.mjs` entry points, which load the TypeScript with Vite's `runnerImport`. This was tried against `src/sim/world/grid.ts` and works; it avoids a new dependency and the extensionless-import problem in plain Node.

### 4.9 Files

| File | Change |
|---|---|
| `tools/map/project.ts` | Lat/lon to real km and back |
| `tools/map/warp.ts` | `f`, its inverse, plateau solve, multi-city warp, overlap check |
| `tools/map/place.ts` | Airport push, box overlap, corridor check |
| `tools/map/types.ts`, `tools/map/validate.ts` | Data shapes; messages name the bad entry |
| `tools/map/raster.ts` | Lines and boxes into an RGB buffer |
| `tools/preview.mjs`, `tools/png.mjs` | Entry point, PNG writer |
| `data/map/scales.json` | Scales and box |
| `data/map/places.json` | DC, Philly, DCA, PHL: lat/lon, core box, airport boundary |
| `tests/mapProject.test.ts`, `mapWarp.test.ts`, `mapPlace.test.ts` | §4.11 |
| `tsconfig.json` | Include `tools` |
| `.gitignore` | `tools/out`, `tools/raw` |

### 4.10 Steps

1. Projection and tests.
2. Warp, inverse and tests.
3. Data files, validation, placement, tests.
4. Raster, PNG, preview at 1:20, 1:25, 1:30.
5. **Stop and look together.** Adjust ring, core sizes, airport boundaries, scale.
6. Update ARCHITECTURE §5 (projection, scales), §7.1 (cell size note) and §14 (the table in §2), GAME_DESIGN §4.1 and §4.3 (scales; "about 4x steeper" is stale: it is 8x at 1:40 with altitude 1:5, and **5x** at 1:25), and this plan's Results. Values not yet used by the game are marked as such.

### 4.11 Verification

| Check | Expectation |
|---|---|
| Projection | Round trip under 1 m; DC to Philly about 200 km; due north is +y everywhere |
| Warp | Strictly increasing; continuous in value and slope at 4, 8, 80 and 90 km; exactly `r/geo` past 90 km |
| Scales | Core slope is 1/4; plateau is 1:42 within 1 at 1:25 |
| Inverse | Round trip under 1 m over the box |
| Failures | Overlapping rings, non-positive plateau, missing or bad data each give a named error |
| Placement | No airport overlaps a core or another airport; the push keeps its bearing; corridors stay in the box |
| Determinism | Two runs give identical PNG bytes |
| Project | `npm run typecheck`, `npm test`, and the game still loads |

By eye: the three previews.

### 4.12 Done when

The tests pass, the previews exist, and you have chosen a distance scale and accepted or adjusted the layout.

## 5. E2 to E6 in outline

### 5.1 E2: skeleton

**Sources** (confirm license, attribution and exact size, and **ask before downloading**):

| Need | Candidate |
|---|---|
| Elevation and sea floor | NOAA ETOPO 2022, 60 arc-second (about 1.8 km) |
| Coast, lakes, rivers, highways | Natural Earth 1:10m |
| Airports, runways | OurAirports |

Raw files stay in git-ignored `tools/raw/`. Only processed output is kept in the project. The game downloads nothing from map services.

**Pipeline:** project and warp vectors -> land mask -> smooth elevation -> mountain rules -> exaggerate water -> ground types -> airport flattening -> overrides -> guardrails -> write chunks and preview.

- Natural Earth's coast wins over ETOPO's: elevation is forced to match on each side of it.
- The output uses the existing cell layers (elevation, terrain, water depth).
- ETOPO cannot resolve individual Appalachian ridges, so ridges are authored lines.
- Minimum widths: named rivers 6 cells (60 m) and minor rivers 3 cells. Bays and islands: a per-feature enlargement.

**Guardrails (fail unless marked warn):**

- Airports do not overlap; nothing paved is wet; the field is flat.
- Approach corridors are clear of terrain.
- Slopes stay under a per-region limit (warn), and peaks stay below 900 m world (ceiling 1,200 m).
- Rivers never run uphill, and end in the sea, a lake or the map edge.
- Named places are on land; coastal ones touch water.
- Landmark checks, such as "the Blue Ridge lies northwest of DC".

### 5.2 Mountain rules

Real slopes are steepened by `geoDistance / altitude` (5x at 1:25). Two settings per range:

- **Relief compression:** shrink only the height *above* the smoothed surroundings, so plateaus such as Denver's keep their elevation.
- **Widening:** fewer, wider ridges.

| Case, average slope *(computed)* | Unmodified | With rules |
|---|---|---|
| Front Range (1:25, for later) | 23 deg | 9 deg: peaks near 10,000 ft, widened 1.5x |
| Appalachian ridge, 300 m relief over 2 km | 37 deg | 17 deg: same height, 200 m world half-width |

Snow and rock are chosen from the **real** elevation, so a compressed peak still looks high.

### 5.3 E3: playable

- `buildAirport` takes the scale from each airport's definition; `ScaleConfig.airport` goes. `geoDistance` joins `ScaleConfig`.
- **Water at DCA:** the validator rejects any water under an airport's boundary, and the real DCA is surrounded by the Potomac. The generator reroutes the river around the (trimmed) boundary.
- **Runway names:** the validator requires names to match grid heading, and allows no `L`, `R` or `C`. Real names are magnetic. Proposed: lay runways out at their **named** (magnetic) headings, rotating the layout by about 10 deg, and treat the game's compass as magnetic. Allow suffixes. The map itself is not rotated.
- Boundary sizes must be whole 2 m cells after scaling.
- Multiple and crossing runways: check `runwayAt` order, drawing, `groundKindAt` and approach guidance. `main.ts` uses only the first runway today; starts must name a runway.
- First layouts: the real main runways, one taxiway and apron each, with space reserved.
- The test island stays as a fixture: many tests depend on it. The map is chosen at startup.
- Loading: one binary file, with progress. Check warm-up time and memory, since all chunks are built at load.
- Route line from DCA to PHL in the top view, and distance to go (§4.6).

#### E3 details (as being built)

| Topic | Choice |
|---|---|
| Map file | The generator also writes `public/maps/mid-atlantic.bin` (kept in the project) when run at the scales in `scales.json`. Its meta lists each airport's position, field height and footprint |
| Patches | `WorldGrid.patches`; lookups use a patch where one covers the point, with ground blended to the base over 80 m at its edge |
| Airport ground | An airport may cover only its footprint ("masked"): outside it the map shows through, so a river inside the boundary stays. The footprint comes from the map file; runway and paving are authored in `sim/world/midAtlantic.ts` |
| Runway names (open question 3) | **Geometry and compass unchanged (true).** A name must match heading plus the airport's magnetic variation (DC 11, PHL 12 deg), so DCA is `01/19` on heading 002 and PHL `09R/27L` on 080. Not the §5.3 proposal: rotating the runways by about 10 deg would put them in the hand-drawn rivers |
| Layouts | One runway each (DCA 1/19, PHL 9R/27L), one taxiway, one apron. Footprints grow to give about 100 m real of grass past each runway end and ground between runway and apron |
| Which map | Mid-Atlantic by default; `?map=test` is the test island. `?airport=DCA|PHL` and `?start=runway|final|air` choose the start |
| Several runways | Approach guidance and the takeoff strip pick whichever runway the plane is on or lined up with |
| Route | Dashed line DCA to PHL in the top view (PHL to DCA after a PHL runway start) with bearing, distance and time to go |
| Distance wording (open question 4) | Nautical miles = world distance x `geoDistance`; within 2 km world of the destination only the time is shown. Provisional; F3 revisits |

Out: gates and taxi graph (G4, G5), cities and roads (E5), scale tuning (E4), chunk streaming.

### 5.4 E5: cities

Planned in detail in `E5_PLAN.md`, which replaces this outline.

- New ground codes after the existing ones, which are never renumbered: `downtown`, `residential`, `suburb`, `industrial`, `park`. `urban` stays for the test map.
- **Roads** are curves with a width class, drawn over the ground, with a bridge where they cross water. Highways: I-95, I-76, a simplified Beltway. Interchanges are plain crossings.
- **Districts** are authored polygons: type, density, height range, street angle. The generator fills them from the fixed seed with streets and buildings.
- **Buildings** are objects: footprint, height, style. Budget: about 400 per city, stored by chunk.
- Top view: roofs, and shadows to the southeast like the plane's, baked into chunks. Past 10 m/px only the ground color shows.
- Side view: buildings within a corridor of the slice, with skylines in the parallax layers.
- **Collision:** `obstacleAt(x, y)` is separate from `heightAt`, so ground handling, AGL and landing are unchanged. Included in crash checks and the terrain warning. Crash cause: `building`.
- Building height at 1:3 will not match the altimeter's 1:5: an object looks taller than its real figure. Accepted.
- Guardrail: no building on water.

### 5.5 E6: landmarks and towns

- DC: Washington Monument, Capitol, Lincoln Memorial, Pentagon; low, spread around the Mall.
- Philly: City Hall, art museum, Ben Franklin Bridge; a tall downtown cluster.
- A few real small towns, from a small kit (main street, church, silo, water tower), chosen for variety.
- One small airport at 1:2, near the mountains.

## 6. Decisions

| Decision | Choice | Why |
|---|---|---|
| Generator | Deterministic script in `tools/` | Tunable and reviewable; re-rolling never loses edits |
| Inputs in lat/lon | Yes | A scale change is a rerun |
| Projection | Cylindrical, true at 39 N | North stays up; one projection for the country |
| Cities | Warp | Keeps rivers and roads joined |
| Airports | Stamp and push | Too big to warp next to a city |
| Ring | 90 km with a plateau | Gentlest squeeze that leaves DC and Philly separate |
| Order | Fly before buildings | Scale changes move everything |
| Test island | Kept | Tests and a quick map for flight work |

## 7. Open questions

1. **Distance scale:** after E1's preview, confirmed in E4.
2. **PHL's size:** 3.3 km long beside a 2 km core. Trim empty land, or use 1:2? After E1's preview.
3. **Runway headings:** magnetic-rotated layouts (§5.3), or true headings with real names relaxed? At E3.
4. **Displayed distance near airports** (§4.6): at E3 and F3.

## 8. Risks

| Risk | Response |
|---|---|
| The warp visibly squashes land near cities | The preview draws the warped grid. Fallbacks: lower core scale (1:5), a smaller core, or a fully authored metro patch |
| DC to Philly is too short to judge a full trip | Judge length on a longer pair later, such as Pittsburgh (about 17 km from Philly at 1:25) |
| PHL dwarfs Philadelphia | Open question 2; building height carries the city |
| DCA and the Potomac conflict | Reroute in the generator; trim the boundary |
| Sources disagree at the coast | Vector coast wins |
| Real data is harder to clean than expected | E2 can be built on one tile first; overrides fix single places |
| Rings overlap in dense areas (Baltimore, New York) | Not in this section; combined warp or smaller rings when needed |
| Scope growth in cities | Building budget; landmarks are E6, not E5 |

## 9. Results

**E1 built.** `npm run typecheck` and `npm test` pass (610 tests, 3 new files: `mapProject`, `mapWarp`, `mapPlace`). `node tools/preview.mjs` writes `tools/out/preview-1-20|25|30.png` and `.json`; two runs give identical PNG bytes. No game code changed. Added `resolveJsonModule` and `tools` to `tsconfig.json`, and an extra `tools/map/render.ts` (preview drawing) beside the files in §4.9.

| geoDistance | Plateau | City to city | Airport to airport | Time at 250 kt | Cells |
|---|---|---|---|---|---|
| 1:20 | 1:28.7 | 10.0 km | 9.3 km | about 72 s | 2.7 M |
| **1:25** | 1:41.6 | 8.0 km | 7.3 km | about 57 s | 1.7 M |
| 1:30 | 1:59.3 | 6.7 km | 6.0 km | about 47 s | 1.2 M |

These match the estimates in §4.3 and §4.4. DCA sits 1.07 km from the city and is pushed to 1.7 km; PHL is pushed from about 1.6 km to 1.94 km (coordinates in `data/map/places.json` are my approximations).

**Found by the preview, needs a decision:**
- **DCA's 4 km approach corridor leaves the map box at all three scales.** The DC ring reaches past the south edge (38.2 N is only about 76 km from DC), so the box edge is squeezed to about 3.5 km south of the city. Fix: move the south edge to about 37.9 N, or shorten the corridor.
- Rings touching the box edge means the world rectangle is not strictly "unwarped at its edge" (§4.5); it holds whatever the inverse warp gives there.
- Runway headings (DCA 4, PHL 95 degrees true) are placeholders.

**Update:** the box's south edge moved to 37.3 N so the DCA corridor fits at all three scales (box 15.6 x 15.1 km at 1:25).

**Still to do:** you pick the distance scale and accept or adjust ring, core sizes, boundaries (open question 2 on PHL); then E2.

### E2 built (1:25)

`node tools/build-map.mjs 25` (about 3 s) writes to `tools/out/`: `terrain-1-25.png` (shaded relief, one pixel per 10 m cell), `mid-atlantic-1-25.bin` (header, JSON meta, then elevation int16, terrain u8, water u8 for 1557 x 1510 cells, 9.4 MB) and `guardrails-1-25.json`. Same inputs give an identical `.bin`. `npm run typecheck` and `npm test` pass (628 tests). Sources and licenses: `data/map/SOURCES.md`.

- **Inputs fetched:** Natural Earth land, lakes and North America rivers (about 24 MB), plus six ETOPO 2022 tiles (about 1.1 MB, by range request from the 466 MB global file).
- **Pipeline as built:** vector rings are subdivided (0.5 km) and warped, then scanline-filled for land and lakes; rivers are stroked 6 cells wide when named and 3 otherwise; elevation is sampled through the inverse warp; mountain rules; land forced to at least 2 m and sea to at most -3 m so the vector coast wins; water carved so the surface keeps the old ground height; airports flattened (blend 300 m); ground types from height plus fixed-seed noise.
- **Mountain rules:** compression is implemented but off (1.0). Widening is on, 6 cells. Without it 0.53% of land was steeper than 30 deg (steepest 48.7); with it, 0% (steepest 31 deg), highest ground 187 m world (936 m real). Under the 900 m limit.
- **Guardrails:** airports dry and flat, approach corridors clear, peak and slope, city centers on land, and 8 landmark checks in `data/map/checks.json` (Atlantic, Delaware Bay, Chesapeake, Potomac, Annapolis, Delmarva, Blue Ridge, Pennsylvania hills). All pass.
- **Seen in the preview:** Chesapeake and Delaware Bays, Delmarva, the Jersey shore, Appalachian ridges to the northwest, and the Potomac, Susquehanna and Delaware rivers all appear where expected. DCA and PHL sit on flat dry land.

**Not done, deferred or known:**
- Rivers-run-downhill and rivers-end-in-water guardrails (no check yet), and per-feature widening of bays and islands.
- Faint concentric banding around DC: ETOPO is quantized to whole meters and the warp stretches it. Visible in shading, not expected to matter in flight.
- Airport ground height now comes from the data file (`elevationM`: DCA 5 m, PHL 11 m real).
- Chunked output is not written; the `.bin` is one file, for E3 to load.
- Only 1:25 was built; other scales rerun with `node tools/build-map.mjs 20`.

### E2 follow-up: airport footprints

The first cut leveled and dried the whole boundary rectangle, which made flat square blobs and buried the Potomac at DCA. Now only the **footprint** (runways, apron, terminal; `footprint` in `data/map/places.json`, real km relative to the airport center) is leveled and forced dry, with a 50 m shoulder and a 300 m blend back into the natural ground. Water and hills inside the boundary but outside the footprint stay. The Potomac now runs past DCA's east side and the Delaware past PHL's. Footprint layouts are approximate: E3 defines the real runways, and its validator must test water against the footprint, not the whole boundary rectangle (§5.3 said "boundary"). Guardrails check the footprint cells.

**Size at full USA:** at 1:25 the whole country is about 210 million 10 m cells (130 million on land), 4 bytes each. The 9.4 MB Mid-Atlantic file gzips to about 1 MB, so disk is manageable (roughly 50 MB for the country), but one raw file in memory is not (about 520 MB land, 840 MB with sea). It needs chunks streamed around the player (§2, "Out"), omitted all-ocean chunks, and likely coarser cells outside metros.

### E2 follow-up 2: 1:2 airports, city hills, blending

- **Airports are 1:2** (`airportMajor` 2 in `data/map/scales.json`). DCA's boundary is 1.0 x 1.25 km world and PHL's 2.5 x 1.25 km. DCA now has one runway (1/19, 2.19 km real) and a small apron; it is pushed 0.42 km to 1.49 km from the DC center, and PHL needs almost no push. Trip at 1:25: city to city 8.0 km, airport to airport 7.4 km, about 58 s at 250 kt (1:20: 9.4 km, 73 s; 1:30: 6.1 km, 47 s). Boundary figures in §4.4 are now stale.
- **City hills:** a city can have `hills` (amplitude in real m, feature size in real km) in `places.json`. They are seeded 3-octave noise in real coordinates, full strength inside the 8 km ramp and fading out smoothly to the 90 km ring edge, so hills keep their real size through the warp. DC: 60 m, 2 km features (core land now spans 2 to 88 m real); Philadelphia: 20 m, 3 km (2 to 36 m).
- **Banding and flatness:** elevation is now sampled bicubically (it was bilinear, which showed creases when the core stretched the data), every land cell gets small seeded bumps (6 m real), and the whole-meter elevation steps are dithered. The concentric rings around the cities are gone from the preview.
- **Cell size is a parameter:** `node tools/build-map.mjs 25 20` builds 20 m cells (`mid-atlantic-1-25-20m.bin`). Compare `crop-dc-1-25.png` and `crop-dc-1-25-20m.png`.
- **Known:** in the core, a 1:4 horizontal scale with 1:5 height makes real hills about 1.4 degrees, which is faithful but gentle. Raise `amplitudeM` for more drama. Faint specks remain along some shorelines where the vector coast and elevation data disagree.

### E2 follow-up 3: 20 m base grid with fine patches

- **Layout:** the map is a 20 m base grid (779 x 755 cells at 1:25) plus a fine patch over each airport boundary and each city core, with a 0.3 km margin, snapped to base cell edges. Patch cell size is `patchCellM` in the `grid` block of `data/map/scales.json` (10 now; any whole divisor of `baseCellM`, so 5 works). Code: `tools/map/patches.ts`. Both come from the same functions of world position, so noise and detail agree between them; the patch is not yet blended into the base at its edge (E3 decides how the game joins them).
- **Output:** `node tools/build-map.mjs 25 [baseCellM] [patchCellM]` writes `mid-atlantic-1-25.bin` (format `FSMAP2`: JSON meta, then the base layers, then each patch's layers; 3.1 MB with 4 patches versus 9.4 MB for the 10 m single grid). Guardrails run on the base and again on each airport patch.
- **Footprint width:** the gray strips in the previews are the ground the generator levels (runway plus safety area, about 90 m world wide), not the runway. The runway the game draws will be its real width divided by the airport scale: 150 ft (46 m) is 23 m at 1:2.
- **Engine:** `WorldGrid` still has one cell size. E3 must teach lookups (`heightAt`, `groundAt`, `surfaceAt`) to prefer a patch over the base.

### E2 follow-up 4: DC and Philadelphia water, airport stamps that bend the land (1:25 only)

- **Authored water** (`data/map/water.json`): inside a region, Natural Earth's coast, lakes and rivers are replaced by land, then hand-drawn rivers are cut in. Each river is a centerline of `[lon, lat, real width m]`; banks are offset in real km and passed through the map, so a river is as wide as it really is at each place's scale (never under `minWidthM`, 40 m world). Tidal rivers are sea-level water; the others are carved like rivers. Regions: `dc`, `philadelphia`, `lower-delaware`.
- **DC:** Potomac from Chain Bridge, bending sharply at Georgetown, past the Mall and Gravelly Point, beside DCA to Alexandria; the Anacostia, Washington Channel and Tidal Basin; the upper Potomac (not tidal) up to Harpers Ferry. Widths are real (about 500 m at Memorial Bridge, 1.7 km beside DCA).
- **Airport stamps bend the land** (`tools/map/stamp.ts`, `stampFadeKm` and `stampAnchorKm` per airport). Inside its real boundary an airport is drawn exactly at its own scale; outside, land takes the stamp's offset at the nearest boundary point and fades back to the warp. The fade length is set per corner by how far that side moved (longer where the offset points away from the stamp, which is what can fold land) and lengthened automatically if the land would fold. The anchor is the point of the airport that stays where the warp puts it, so the stamp grows away from water that should not widen. `toReal` inverts this numerically (exact to under 0.1 mm near DCA).
- **DCA:** boundary trimmed to the airport's land (1.2 x 3.0 km real), runway 1/19 at its east edge on the water, heading 2 degrees true (placeholder still). The river runs along the runway; the Anacostia and Washington Channel meet it just northeast.
- **Per-city warp** (`warp` on a city in `places.json`): optional center and core/ramp radii; the ring stays shared. Built and tried for Philadelphia, now unused.
- **Width in world meters** (`widthIn: "world"` on a river): the third number of each point is the drawn width in world m, with banks offset square to the river as drawn. Used for Philadelphia, where the warp would otherwise make a river wide, then thin, then wide again.
- **Philadelphia is condensed, not real.** Center City keeps its real place; PHL is moved to about 4.5 km southwest of it (real is 11 km), so South Philadelphia is gone and the airport sits just below the city. PHL is a single runway (3.2 km real, 80 degrees true) along the river with the apron and terminals north of it; boundary 3.4 x 1.4 km real. The Delaware runs south past Center City and Camden, turns west along the runway, then curves south into the bay. The Schuylkill runs down the west side of Center City and joins the Delaware at the airport's northeast corner. Widths grow steadily downstream: 150 m world at Center City, 200 m beside PHL, 470 m where it meets the real bay at 39.22 N.
- **Lower Delaware is representative too.** The warp keeps bearings and crushes distance, so Chester, Wilmington and the head of the Chesapeake pile up together and the real channel hooked back toward the Chesapeake. The river is authored on a smooth curve from 224 to 186 degrees from Center City and replaces Natural Earth between Philadelphia and 39.22 N (region `lower-delaware`).
- **Trip at 1:25:** city to city 8.0 km, airport to airport 7.9 km, about 61 s at 250 kt. PHL sits 1.32 km from Center City (pushed 0.2 km).
- **Checks** added in `data/map/checks.json`: Potomac at Georgetown, Memorial Bridge and beside DCA; Anacostia; East Potomac Park, Arlington, the Mall; Delaware at Penn's Landing, beside PHL and on the way to the bay; Camden, Center City. All pass at 1:25.
- **Previews:** `crop-dc-1-25.png`, `crop-dc-wide-1-25.png`, `crop-phl-1-25.png`, `crop-phl-wide-1-25.png`.
- **Known:** only 1:25 was checked. Map tests were not kept up to date with these changes (some will fail; `tests/mapStamp.test.ts` is new and partly stale). Trip lengths in §4.4 and §9 are stale; the current ones are above.

### E3 built

- **Done as in §5.3 "E3 details".** New: `sim/world/mapFile.ts`, `midAtlantic.ts`, `startList.ts`, `views/route.ts`, `app/loadMap.ts`, `config/map.ts`, `public/maps/mid-atlantic.bin` (3.0 MB, keep it in the project; tests read it). `ScaleConfig.airport` is gone (`AirportDef.scale`), `geoDistance` joined it, `WorldGrid` has patches, airports can be masked, runway names allow L/C/R.
- **Footprints changed** in `places.json`: runway strips lengthened for grass past the ends (DCA 2.4 km, PHL 3.4 km real) and the apron rectangle widened to reach the runway. Map rebuilt; all guardrails pass and the rivers did not move.
- **Verified:** typecheck, build and 663 tests pass. A scripted pilot (keys only) takes off from DCA 01, lands on PHL 09R and stops on the runway: 126 s, touchdown 1.9 m/s, 255 m past the threshold. In the browser at 1280 x 720: DCA and PHL starts, both finals, the air start, whole-map zoom and route line, no console errors.
- **Load cost (browser, dev):** fetch 75 ms, parse 13 ms, airports and checks 0.3 s, top-view warm-up 3.5 s; JS heap about 54 MB.
- **Stale tests** from E2 follow-up 4 are updated, and the test timeout is 20 s (long simulation tests passed 5 s when all files ran together).
- **Not checked:** nobody has flown the leg by hand; the browser pane was hidden, so the loop barely ran and live frame times, zoom easing and patch edges in motion were not seen.
- **Open for you:** runway names against a true compass (open question 3, about 10 deg apart) and the distance wording (open question 4).
