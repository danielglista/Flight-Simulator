# E7 Implementation Plan: Polygon Airports

**Status:** E7.0 trial run, E7.1 to E7.4 built (§10); E7.4B airport layouts accepted (§11); E7.5 built and accepted (§10), E7.6 (docs) done, E7.7 (PHL runways) built, **not flown by hand**; E7.8 (taxiways, aprons, gates) and E7.9 (buildings) built, **not taxied by hand**. The land bends to the hull of the ground; `boundaryKm` is gone.
**Milestone:** the airports can be shaped by editing points, and sit in the land around them without a large rectangle pushing it out of the way.
**Starting state:** E6 landmarks, magnetic headings and approach aids committed. E4 (scale tuning) is not done.

All numbers are provisional. "World" means world meters or km, "real" means real ones. `E7` is a new step name; it is not yet in ARCHITECTURE.md §14.

## 1. The problem

An airport has two shapes in `data/map/places.json`:

| Shape | Now | Used for |
|---|---|---|
| `boundaryKm` | One axis-aligned box | The stamp that bends the land (`tools/map/stamp.ts`), the push away from the city, overlap checks, the fine patch window, keeping districts and highways out |
| `footprint` | Two turned rectangles | Level, dry ground; the airport ground the game uses |

The box is far bigger than the ground in it, and all of it displaces land:

| Airport | Box, real km² | Ground, real km² | Convex hull of the ground, real km² | Push from the city, world km | Stamp fade, world km |
|---|---|---|---|---|---|
| DCA | 3.60 | 1.09 (30%) | 1.38 (38%) | 0.55 | 2.00 |
| PHL | 4.76 | 1.76 (37%) | 2.15 (45%) | 0.20 | 2.00 |

The hull is the tightest convex shape around the ground, as a rubber band would take it. Using it cuts the wasted area. It does not remove the bending: airports are drawn at 1:2 on 1:25 geography, so the land still has to make room.

## 2. Scope

| In | Out (where it belongs) |
|---|---|
| Ground drawn as one or more polygons of any shape: the only shape authored | A visual shape editor (not planned) |
| A convex outline computed from the ground, replacing the box everywhere | A hand-drawn outline, or concave bending (§3) |
| Points as `[lon, lat]`, as in `districts.json` | New layouts in E7.0 to E7.6 (E7.7 on, §11) |
| Preview images that draw the ground and the outline | Airport scale changes (E4) |
| First tuned shapes for DCA and PHL | The small airport (E6, planned later), though it would use this format |
| | A margin setting around the outline (only if tuning needs it, §8) |

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Authored shapes | **One:** `ground`, the usable land (accepted) | One thing to tune |
| Outline | The convex hull of all ground points, computed by the generator and never stored | It bends the land and keeps things clear. It cannot fail to be convex or to contain the ground |
| Why the outline is convex | The stamp uses the nearest outline point | For a convex shape that point moves smoothly; at a notch it jumps from one side to the other and tears the map |
| Ground shape | Any simple polygon, one or more | Only tested point by point, so notches are harmless and water in them stays |
| Coordinates (proposed) | `[lon, lat]` | Can be traced from a real map, and survives scale changes in E4 |
| Airport position (proposed) | `lat`, `lon` stay the center the stamp and runway layout are measured from | `midAtlantic.ts` keeps working; the shape need not be centered on it |
| Old keys (proposed) | `boundaryKm` and `footprint` are removed once the new code works | One format, two airports to convert |

## 4. Behavior

### 4.1 Data

```json
{
  "id": "DCA",
  "lat": 38.8512,
  "lon": -77.0415,
  "ground": [[[-77.0364, 38.8598], "..."], ["..."]]
}
```

Validation, each error naming the airport:
- `ground`: at least one polygon of at least 3 points, no crossing edges, either winding.
- `stampAnchorKm` lies inside the outline.

### 4.2 Generator
- **Outline:** the convex hull of every ground point.
- **Stamp:** inside the outline the mapping is the same exact stamp as now. Outside, the offset comes from the nearest point on the outline. Fade lengths move from four corners to every vertex, interpolated along each edge. A vertex's fade uses the outward normals of its two edges; for a rectangle this gives the present formula.
- **Push and overlap:** convex polygon against the city core box and against other airports, with the present gaps.
- **Fine patch:** the bounding box of the outline plus the present margin.
- **Level ground:** a cell is leveled if it is inside a ground polygon or within the present shoulder (20 world m) of its edge. Corners come out rounded, unlike the rectangles' square ones. The 0.3 km blend is unchanged. Land inside the outline but outside the ground keeps its water and hills.
- **Districts:** none inside the outline.
- **Highways:** go around the outline grown by 20 world m, following its edges (`skirt` in `roads.ts`, now box-only).
- **Map file:** each airport's `ground` becomes lists of local real meter points.

### 4.3 Game
- `buildAirport` paints the ground mask by point-in-polygon. `Airport.minX` to `maxY` stay as the bounding box of the ground, so drawing, lookups, collision and the runway menu do not change.
- The old `.bin` and the new code do not match; they change in the same commit.
- Runways, taxiways and aprons are unchanged and must still fit the ground (the existing validator enforces this for runways).

## 5. Files

| File | Change |
|---|---|
| `src/sim/world/polygon.ts` (new) | Contains, nearest point, convex hull, self-crossing, convex overlap. In `sim/` so both the game and the tools can use it |
| `data/map/places.json` | `ground` replaces `boundaryKm` and `footprint` |
| `tools/map/types.ts`, `validate.ts` | New format and checks |
| `tools/map/stamp.ts` | Convex polygon stamp |
| `tools/map/place.ts`, `patches.ts` | Polygon overlap, bounding box |
| `tools/map/skeleton.ts` | Ground mask and district keep-out |
| `tools/map/roads.ts` | Skirt a convex polygon |
| `tools/map/render.ts`, `shade.ts` | Draw ground and outline |
| `tools/build-map.mjs` | Airport record, road keep-out |
| `src/sim/world/airport.ts`, `mapFile.ts`, `midAtlantic.ts` | Polygon ground |
| `public/maps/mid-atlantic.bin` | Rebuilt |
| `tests/polygon.test.ts` (new), `mapStamp`, `mapPlace`, `mapSkeleton`, `mapPatches`, `mapRoads`, `airport`, `placeAirports`, `midAtlantic`, `landmarks` tests | Updated or extended |

## 6. Steps

Each code step ends with `npm run typecheck`, `npm test` and a map build (`node tools/build-map.mjs 25`) with no guardrail failures.

| Step | Work | Done when |
|---|---|---|
| E7.0 | Trial, no code: shrink and shift the boxes in `places.json`, rebuild, compare the previews, then discard | You have seen how much the land relaxes and want to go on |
| E7.1 | `polygon.ts` and its tests | Tests pass |
| E7.2 | Ground polygons: data, validator, leveling, map file, `buildAirport`. Convert the present rectangles' corners. `boundaryKm` stays for now | Game flies as before; ground differs only at the rounded shoulder corners |
| E7.3 | The generator works on a convex polygon outline (stamp, push, patches, districts, highways, previews), **fed the present box** | The rebuilt map matches E7.2's, byte for byte if floating point allows; any difference is explained |
| E7.4 | Feed it the hull of the ground instead, and remove `boundaryKm` | Guardrails pass; both airports looked at in the previews and the browser |
| E7.4B | Agree where taxiways, aprons, gates and buildings go (§11). No code | You accept the layouts |
| E7.5 | Draw DCA's and PHL's ground to hold the §11 layouts, and move PHL (§11.4); tune by eye | You accept how both airports sit; no ground on water |
| E7.6 | Docs: `CURRENT.md`, `ARCHITECTURE.md` §14, `AGENTS.md`, results here | Docs match the game |
| E7.7 | PHL: the longer 9R/27L and the new 9L/27R | Both can be used for takeoff and landing |
| E7.8 | Taxiways, aprons, gates and their markings (§11) | Both airports can be taxied from runway to gate by hand |
| E7.9 | Terminals, towers, hangars, garages, parking and UPS (§11) | They stand in both views and are solid |

E7.3 changes the code but no shapes, E7.4 only the outline and E7.5 only the ground (and PHL's position), so a bad-looking map can be traced to one of them.

## 7. Verification
- **Stamp tests:** a rectangle outline reproduces today's values; a many-sided hull is exact inside, continuous across every edge and vertex, round trips through `toReal`, and never folds within 8 km (the present tests, run on both).
- **Hull tests:** it is convex and contains every ground point, including for notched and multi-piece ground.
- **Guardrails:** airport ground dry and flat on base and patch, approach corridors clear, `checks.json` places as expected.
- **Existing flight:** the scripted DCA to PHL flight in `midAtlantic.test.ts` still lands.
- **By eye:** both airports in the top and side views; the Potomac past DCA and the Delaware past PHL; highways around the outlines; districts up to the edges; every landmark still on its ground; console clean.

## 8. Risks

| Risk | Answer |
|---|---|
| A tighter outline moves water, highways and districts near the airports, and landmarks placed by eye (the Ben Franklin Bridge, the reflecting pool) no longer fit | Check each after E7.4 and E7.5; adjust `landmarks.json` and `water.json` |
| The land folds with a short or sharp edge | The present fold check lengthens the fade; add a ground point to blunt the corner |
| The hull still covers more than wanted, such as across water at DCA | Use `stampAnchorKm`; splitting an airport into several stamps is not planned |
| No extra room around the airport: water just past the outline is bent with the land instead of keeping the airport's 1:2 scale | Add an optional margin that grows the outline |
| Moving a ground point can also change how the land bends | Expected; the preview shows both shapes |
| Tuning is slow because points are typed by hand | Previews draw ground and outline; keep each polygon to about 6 to 10 points |
| Buildings, roads or ground move into an approach path | Not limited or flagged; judged by flying |

## 9. Done when
- Each airport is described by its ground polygons alone, and no code reads `boundaryKm` or `footprint`.
- Editing a point in `places.json` and rebuilding changes the airport's shape, and an invalid shape fails with the airport's name.
- DCA to PHL can be flown and landed, and you accept how both airports sit.

## 10. Results

### E7.0 (trial, discarded)

Two trials against the present map, at 1:25. The ground kept its real place; only the box (and so the center the stamp is measured from) changed.

| Trial | DCA box, real km | PHL box, real km | Stands for |
|---|---|---|---|
| Now | 1.2 x 3.0 | 3.4 x 1.4 | |
| A | 0.76 x 2.41 | 3.37 x 1.27 | The tightest box that holds all the ground |
| B | 0.66 x 2.10 | 2.39 x 0.90 | A box with the hull's area. Ground sticks out of it, so only the amount of bending means anything |

| Measure | DCA now / A / B | PHL now / A / B |
|---|---|---|
| Box, real km² | 3.60 / 1.83 / 1.39 | 4.76 / 4.28 / 2.15 |
| Push from the city, world m | 550 / 280 / 200 | 200 / 170 / 60 |
| Largest move from the plain city warp, world m | 1031 / 730 / 599 | 758 / 710 / 432 |
| Land moved more than 200 world m, real km² | 371 / 347 / 329 | 301 / 293 / 232 |

- All three builds passed every guardrail. The rebuild of the present data matched the committed `.bin` byte for byte.
- A smaller shape moves land **less**, but over nearly the **same area**: `stampFadeKm` (2 km) is the fade of the largest move, whatever its size. Shortening the reach would mean lowering it.
- DCA gains much even from a tight box. PHL does not: its ground is turned 10° from the box, so only the hull will help it.
- Previews (not committed): `tools/out/e7-trial/`, with `compare-DCA.png` and `compare-PHL.png` showing now, A and B in the same window.

### E7.1 (polygon geometry)

- `src/sim/world/polygon.ts`: `contains` (the outline counts as inside), `nearestOnOutline` (also gives the edge and how far along it, for E7.3's fade), `convexHull` (counterclockwise, no points along its sides), `selfCrossing` (touching, repeated points and doubling back count), `convexOverlap` with a gap.
- The gap of `convexOverlap` is measured across each side, so for two upright boxes it matches the present `overlaps` in `place.ts`.
- `tests/polygon.test.ts`: 19 tests. Typecheck and all 855 tests pass; the map build has no guardrail failures and leaves the `.bin` unchanged.

### E7.2 (ground polygons)

- `ground` replaces `footprint` in `places.json`: the corners of the former rectangles, `[lon, lat]` to 6 decimals. `boundaryKm` stays.
- `ground` is required. The validator rejects fewer than 3 points, crossing or touching edges and repeated points, naming the airport. `stampAnchorKm` is still checked against the box until E7.4.
- `groundLocalKm` in `tools/map/place.ts` gives the polygons in real km from the airport center; placed airports also carry them in world km. The map file stores local real m.
- Against the previous map: no water, road, building or landmark changed. Heights differ by up to 14 m real around the shoulder corners (DCA and PHL), with 9 terrain cells changed in all. The game's ground differs in 5 cells of 2 world m at DCA and 12 at PHL, from rounding the corners to 6 decimals.
- Typecheck and all tests pass; the map build has no guardrail failures. Seen in the browser at both airports, console clean. Not flown by hand; the scripted DCA to PHL flight passes.

### E7.3 (generator on a convex outline)

- The rebuilt map matches E7.2's byte for byte; no guardrail failures.
- A placed airport has `outline` (convex, counterclockwise, world km) and `scale` in place of the `boundary` box. The stamp, push, overlap checks, patch window, district keep-out, highway skirting and previews use the outline.
- `outlineLocalKm` in `tools/map/place.ts` still returns the `boundaryKm` box: it is the one place E7.4 changes the shape. The `stampAnchorKm` check in `validate.ts` also still reads the box.
- `growConvex` was added to `polygon.ts` for the highways' 20 world m margin. Its corners extend until the sides meet, so a very sharp corner would reach far out.
- Previews draw the outline and the ground polygons.
- Tests: a rectangle outline reproduces values recorded from the box stamp; DCA's ground hull is exact inside, continuous and fold-free. Typecheck and all 870 tests pass. The game was not looked at, since the map is identical.

### E7.4 (the hull of the ground)

- The outline is the convex hull of all ground points; `boundaryKm` is removed. `stampAnchorKm` must lie inside the hull (DCA's does). Ground shapes are unchanged.

| Measure, world | DCA before / after | PHL before / after |
|---|---|---|
| Outline's bounding box, km | 0.60 x 1.50 / 0.38 x 1.20 | 1.70 x 0.70 / 1.68 x 0.63 |
| Push from the city, m | 550 / 280 | 200 / 180 |

- DCA to PHL, airport to airport: 7.87 to 7.68 km. Fades stay 2 km (none lengthened). Highway pieces 238 to 253 (58 to 67 over water) and buildings 16,336 to 16,191, before the road fix below.
- No guardrail failures. Typecheck and all 869 tests pass after these test changes:
  - Trip length lower bound 7.7 to 7.6 km.
  - Crystal City moved north-east with DCA (still west of the Potomac), so the test's coordinates for it and for "east of the Potomac" were updated.
  - The patch seam test skips samples within 20 m of water: it failed on a river bank, where the committed map also had steps up to 1.1 m. Away from water the worst step is 0.23 world m.
  - The synthetic "water past a runway" airport now has two strips, so there is room inside its hull.
- Seen in the browser: both airports, the Mall, Pentagon and Jefferson Memorial, and the Ben Franklin Bridge; console clean. Not flown by hand.
- **Fixed:** I-76 (both carriageways), skirting PHL, ran about 600 world m out over the Delaware beside the runway and back. It crosses the east end of the outline, leaves on the river side and then heads east, so both ways round ended in the river. `skirt` in `roads.ts` now cuts such a hairpin: where the road comes back within 250 world m of the reroute, and going round is at least 3 times as far (never more than 2 km), the two are joined straight. About 1.3 km of highway went, all just south of PHL; no other road changed. The map now has 229 highway pieces (55 over water) and 16,198 buildings. Typecheck and all 875 tests pass; seen in the browser.

### E7.5 (ground for the layouts, PHL moved)

**Built and accepted**, with the highways near PHL left as they are.

- `places.json`: PHL moved to 39.925706, -75.201257. DCA has today's two pieces plus the two taxiway ends; PHL has the four pieces of §11.5 plus one under the control tower.
- Differences from §11.5:
  - **PHL tower piece** (s 1268 to 1500, t -800 to -638): the tower of §11.4 (and of drawing 3) stood about 120 real m off the four pieces. It lies inside the outline, so only leveled ground changed.
  - **DCA north taxiway end** starts at s 1028, not 1050: today's wider piece ends at s 1030, and the gap would have been off the ground.
  - Neighboring pieces overlap by 2 real m, so rounding leaves no gap.
- **Water**, against a build without leveling: no PHL ground over water; nearest water 49 real m (by UPS) and 77 (north piece). DCA's present ground already fills part of the river, as before; the new south taxiway end fills about 14 more cells of 10 world m (t -71 to -50, s -1112 to -892).

| Measure, world | PHL before / after |
|---|---|
| Outline's bounding box, km | 1.68 x 0.63 / 1.94 x 0.95 |
| Push from the city, m | 180 / 810 |
| Distance from the city center, km | 1.30 / 1.89 |

- DCA's outline and push are unchanged. DCA to PHL: 7.68 to 7.07 km. Both fades stay 2 km.
- Highway pieces 229 to 251 (55 to 56 over water); buildings 16,198 to 17,781.
- Highways near PHL: the one that crossed the field now goes round its north and east sides, then runs about 500 world m over the Delaware at a slant. Crossings south and west of the airport are longer over water than before. Not changed.
- No guardrail failures. Typecheck and all 875 tests pass; one test changed (trip length bounds 7.6 to 8.1 became 6.9 to 7.3). The scripted DCA to PHL flight still lands.
- Seen in the previews, and in the browser: both runway starts and Philadelphia, console clean. Not flown by hand; the side view was seen only from the runway starts.
- DCA's garages and parking (drawing 3) reach t -655, 5 real m past the ground's t -650, within the leveled shoulder. For E7.9.

### E7.6 (docs)

- `CURRENT.md`: state, building count (17,781), the route line example, and what is not built yet. Its airport description was updated in E7.5.
- `ARCHITECTURE.md`: §14 has rows for E7 and E8, and §16 says what is built and next. `AGENTS.md`: the same in its summary.
- Typecheck and all 875 tests pass. No code changed.
- §9 for E7.0 to E7.6: met, except that DCA to PHL has been flown only by the scripted test, not by hand.

### E7.7 (PHL runways)

**Built, not yet flown by hand.**

- `midAtlantic.ts`: a layout has a list of runways. PHL: 9R/27L at 3,658 m (1,829 world) and the new 9L/27R at 2,896 m (1,448 world), as §11.4.
- 9L/27R is 46 real m wide (not in §11; the real runway's 150 ft). 9R/27L stays 60.
- Starts and the route line stay on 9R/27L, as §11.10 proposed.
- The only single-runway assumption that needed a change was the map label (`airportLayer.ts`): each runway now has its own. The runway menu, approach guidance, takeoff strip, landing check and side view already took any number.
- PHL's placeholder taxiway and apron were redrawn clear of the new runway: a taxiway between the runways joined to their ends with square turns, and an apron north of both, reached across 9L/27R. E7.8 replaces them.
- Ground past the runway ends is about 25 world m (51 real), from the §11.5 pieces; the old runway had more than 40. The dry-and-flat test now asks 20 at PHL.
- Tests: takeoff from and scripted landing on all four ends, landing with flaps up (the scripted pilot trims for a clean wing). Typecheck and all 883 tests pass. No map rebuild.
- Seen in the browser: both runways and their labels, PHL's four ends in the menu, guidance to 09L on the HSI, console clean.

### E7.8 (taxiways, aprons, gates)

**Built, not yet taxied by hand, so its "done when" is not met.**

- `midAtlantic.ts` holds the taxiway and lane center lines, apron outlines and gate lead-ins in the runway frame, read off the two accepted drawings. The placeholders are gone.
- `Airport` has `taxiways`, `holdShort` and `gates` (name, stand, facing, lead-in), world m. `buildAirport` paints taxiways 36 real m wide, then the aprons over them.
- Hold-short bars are computed: 70 real m from a runway center line on every piece that joins it. The DCA drawing had them at 65 to 70; the PHL drawing had none.
- PHL gate numbers (the drawing had none): on each pier the side toward the lower `s` is 1 to 3, the other 4 to 6, from the terminal out; D is 1 to 2 and 3 to 4.
- Taxiways into a runway end pave 9 world m past it (half their width), so the grass test allows paving there.
- Not drawn: the terminals, piers and concourse (E7.9), so their places are bare apron or grass for now.
- Tests: gate counts, every center line and lead-in on pavement, no pavement off the airport ground, every gate joined to every runway end, hold-short bars. Typecheck passes; 887 of 888 tests passed in the full run, and the other (the 5 m patch test, untouched by this step) timed out on a busy machine and passed with a longer limit. No map rebuild.
- Seen in the browser: DCA's whole field and Terminal 2's gates, PHL's field, markings and numbers, console clean.

### E7.9 (buildings, parking, freighters)

**Built, not yet taxied by hand.**

- `midAtlanticBuildings.ts` (new) holds footprints, heights and paint in the runway frame, read off the accepted drawings. `buildAirport` turns them into `Airport.structures`, a `MapLandmark`, so collision, the terrain warning, shadows and both views work as for landmarks. The top view draws them after the airport pavement.
- Heights use the map's building height scale (`GameMap.buildingHeightScale`, 3). Chosen here: piers 12 m (links and the passage 12 and 10), UPS hall 15, docks 8; the tower is a low base, shaft, glass cab and red cap to 45 m.
- Landmark paint gained a `polygon` kind and a `detail` flag (cars and trailers).
- Differences from §11.3 and §11.4:
  - The DCA hangar link now starts at t -280, not -300: at -300 it ran into both hangar fronts.
  - The DCA parking lot ends at t -648, not -655, to stay on the ground.
  - Jet bridges in the DCA drawing are not drawn (not in §11).
- Tests: every building on its airport's ground and off the runways, kept 9 world m from taxiway center lines and 5 from lead-ins; every gate still joined to every runway end round the buildings; taxiing on from DCA B1 crashes into the pier. Typecheck passes; 892 of 893 tests passed in the full run, the other being the slow 5 m patch test, which timed out. No map rebuild.
- Seen in the browser: DCA's terminals, concourse, hangars and parking, PHL's terminal, piers, garages, UPS hall, freighters and trailers, console clean. The side view was seen only briefly at DCA.

## 11. Airport layouts (E7.4B)

**Accepted from drawings. Built so far: the ground and PHL's position (E7.5), PHL's runways (E7.7) the taxiways, aprons and gates (E7.8) and the buildings (E7.9).** E7.5 draws the ground and moves PHL to hold these; E7.7 to E7.9 build what stands on it. The shapes follow the real fields' character, simplified. All numbers are provisional.

Drawings (not committed, so this section is the record): `tools/out/e7-4b/dca-drawing-3.html` and `phl-drawing-3.html`. DCA drawing 3 was accepted by moving on to PHL without changes.

Positions are **real m in a runway frame**: `s` along the heading from the middle of the airport's present runway, `t` to the right of it. Negative `t` is west at DCA and north at PHL.

### 11.1 Scope

| In | Out (where it belongs) |
|---|---|
| Taxiways that join the runways in 45 degree steps | Following a taxi route, hold-short rules, taxi assist (G4) |
| Aprons, piers, numbered gates, lead-in lines, hold-short bars | Pushback, ground crew, ground control (G5) |
| Terminals, towers, hangars, garages, parking lots, UPS | Moving vehicles and aircraft, airport lights |
| Parked aircraft as scenery (UPS freighters) | The crossing runways at DCA and PHL |
| A second runway at PHL | A third runway anywhere |
| Gates and taxiways stored as positions, not only paint | |

### 11.2 Sizes and rules

- The plane is drawn about 10 world m across at the closest zoom, which is 20 real m at 1:2.
- It turns no tighter than 15 world m (30 real) on the ground (`STEER_RADIUS`).
- Taxiway width 36 real m (18 world). Today's 24 leaves about 1 world m each side.
- **No square turns between a runway and a taxiway:** ways on and off turn in 45 degree steps.
- **DCA:** nothing is added between the runway and the water to the east.
- **PHL:** no ground over either river.

### 11.3 DCA (runway 01/19, s -1092 to 1092)

| Item | Where |
|---|---|
| Parallel taxiway | t -180, s -992 to 992; at each end 45 degrees to t -80, then to the runway end |
| Angled exits, runway to taxiway | From s -640, -280, 250, 610, 760 to s -460, -460, 430, 430, 940 |
| **Terminal 2** | 560 long, 56 wide, **skewed 9 degrees** to the runway with its north end farther from it; centred at s 430, t -520 |
| Piers B and C | Square to Terminal 2, 40 wide, reaching 235 out from its centreline, at 130 south and north of its middle; 6 gates each, 3 a side |
| Apron lanes | At 250 south, 0 and 250 north of Terminal 2's middle, splaying 45 degrees into the parallel taxiway |
| **Terminal 1** hall | s 5 to 105, t -505 to -405, joined to Terminal 2 |
| Terminal 1 round concourse | Radius 34 at s -90, t -440, with a passage 28 wide from the hall; **5 gates** all round but the north |
| Garages | Two, behind Terminal 2 and parallel to it, 215 long, 48 deep |
| Hangars | Two, s -378 to -308 and -292 to -222, t -390 to -300, with their own apron and link |
| Parking lot | s -375 to -205, t -655 to -545 |
| Control tower | s 850, t -450 |

17 gates: A1 to A5 (Terminal 1), B1 to B6, C1 to C6.

### 11.4 PHL

**Position:** the airport center moves to **lat 39.925706, lon -75.201257** (from 39.9194, -75.1954), about 0.7 km north and 0.5 km west, real.

| Item | Where |
|---|---|
| Runway **9R/27L** (southern) | t 0, s -1829 to 1829 (3,658 m, 12,000 ft; today's is 3,200 m) |
| Runway **9L/27R** (new) | t -430, s -899 to 1997 (2,896 m, 9,500 ft; middle 550 east of the other's) |
| Taxiway between the runways | t -215, s -1729 to 1729, 45 degrees into both ends of 9R/27L |
| Taxiway along the terminal | t -610, s -799 to 1897, 45 degrees into both ends of 9L/27R |
| Exits from 9R/27L | From s -1100, -300, 600, 1400 to s -885, -515, 815, 1185 on the middle taxiway |
| Exits from 9L/27R | From s -150, 700, 1500 to s 30, 520, 1320 on the terminal taxiway |
| Crossings between the runways | (s -100, t -215) to (115, -430) to (295, -610), and (1500, -215) to (1285, -430) to (1105, -610) |
| Terminal | s 140 to 1240, t -1060 to -990 |
| Piers, toward the runways | **A** angled, (330, -990) to (270, -730); **B** s 560 and **C** s 820, to t -740; **D** s 1080 to t -760, ending in a T (s 990 to 1170, t -780 to -740). 44 wide |
| Gates | A, B, C 6 each (3 a side), D 4: **22** |
| Apron lanes | s 170, 430, 690, 950, 1210 |
| Garages | s 160 to 480, 530 to 850, 900 to 1220; t -1170 to -1085 |
| Cargo and hangars | Hangars 130 long at s -1450, -1290, -1130, t -640 to -545; apron s -1440 to -990, t -520 to -300; link at s -1215 |
| Control tower | s 1460, t -762 |
| **UPS** sorting hall | s -600 to 130, t 175 to 295, with docks to t 330; truck yard t 335 to 375 |
| UPS apron and freighters | Apron s -620 to 580, t 90 to 250; 4 parked freighters to the right (east) of the hall; taxiway at t 130, reached from 9R/27L at s -350 and 420 |

### 11.5 What E7.5 has to hold

**DCA:** today's two ground pieces, plus the taxiway ends: s -1120 to -380 and s 1050 to 1120, both t -220 to 0.

**PHL:** these four pieces replace today's.

| Piece | Corners (s, t) |
|---|---|
| South runway | s -1880 to 1880, t -260 to 60 |
| North runway and terminal | (-950, -260), (-950, -640), (110, -640), (110, -1200), (1270, -1200), (1270, -640), (2050, -640), (2050, -260) |
| West cargo | s -1480 to -950, t -660 to -260 |
| UPS | s -660 to 600, t 60 to 390 |

E7.5 added a fifth piece under the control tower (§10).

Trial build of PHL (nothing in the project changed):

| Measure | Today | With this |
|---|---|---|
| Outline, world m | 1,680 x 630 | 1,940 x 950 |
| Push from the city, world m | 180 | 810 |
| Distance from the city center, world km | 1.30 | 1.89 |
| Stamp fade, world km | 2.0 | 2.0 |

- Ground to water: about 50 real m to the Delaware (by UPS) and 70 to the Schuylkill (northeast corner). East of 9R/27L's east end the Schuylkill slants away, leaving about 500 m.
- The distance from the city is set by the clearance round the city core box, not by the rivers.
- DCA's added ground has not been trial built.

### 11.6 Behavior

- **Second runway:** 9L/27R has its own names, markings, labels, collision, landing check and approach aids, and can be picked in the runway menu. Starts stay on 9R/27L unless decided otherwise (§11.10).
- **Pavement** is painted into the airport's fine grid, so it counts as paved. Markings are drawn from the positions: yellow centerlines, hold-short bars, lead-in lines, gate numbers at close zoom.
- **Buildings** are solid boxes (the round concourse a drum) with real heights, terminal about 15 m, tower 45 m, hangars 20 m, garages 12 m, scaled like city buildings, drawn in both views. Hitting one is a crash.
- **Parking and parked aircraft** are ground paint: individual cars at close zoom, plain pavement farther out.

### 11.7 Files

| File | Change |
|---|---|
| `data/map/places.json` | Ground (E7.5), PHL position |
| `src/sim/world/midAtlantic.ts` | Layouts: runways, taxiways, aprons, gates, buildings |
| `src/sim/world/airport.ts` | Gates and buildings on `Airport` |
| `src/sim/world/startList.ts`, `views/route.ts`, `views/airportLayer.ts` | Today read `runways[0]` as the airport's only runway |
| `src/sim/world/obstacles.ts` | Airport buildings are solid |
| `src/views/`, `src/config/` | Markings, buildings, parking, colors |
| `tests/` | `midAtlantic`, `airport`, `mapPlace` and others; below |

### 11.8 Verification

- Every taxiway, stand and building lies on airport ground; no building touches pavement or a runway.
- Every gate connects to every runway end along pavement.
- PHL has no ground over water (guardrail "dry" does not catch this, because leveled ground is dry by definition: check against the map built without leveling, as the trial did).
- Both PHL runways: take off and land.
- By eye: both airports from above and the side; taxi by hand from a runway to a gate.
- The scripted DCA to PHL flight still lands. Trip length changes with PHL's position.

### 11.9 Risks

| Risk | Answer |
|---|---|
| PHL's larger outline moves districts, highways, water and landmarks | Check after E7.5, as in §8 |
| The longer runway and the move break the scripted flight and tests' fixed coordinates | Update them, saying which and why |
| A second runway reaches more code than the files above | Search for single-runway assumptions first |
| Gates are unreadable except at close zoom | Draw numbers only there |

### 11.10 Decisions

| Decision | Choice |
|---|---|
| Layouts | As §11.3 and §11.4 (accepted) |
| Taxiing into a building | A crash, as with city buildings (accepted) |
| Where layouts live | `midAtlantic.ts`, runway frame (accepted) |
| Airport scale (E4) | 1:2, unchanged (accepted after flying past both runways: about 15 s DCA, 22 s PHL at 140 kt) |
| PHL starts and route line | 9R/27L, built as proposed (E7.7); not separately confirmed |

### 11.11 Done when

- E7.4B: the layouts are accepted. **Done.**
- E7.7 to E7.9: both airports match §11.3 and §11.4, both PHL runways can be used, and you can taxi from a runway to a gate.
