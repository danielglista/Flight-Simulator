# E6B Implementation Plan: Towns and a Small Airport

**Status:** E6B.1 to E6B.4 built. E6B.4 is waiting for the user to look; nothing at SBY has been flown by hand.
**Milestone (ARCHITECTURE.md §14):** the rest of E6: small towns and one small airport.
**Starting state:** commit `a9130e9`.

All numbers are provisional. "World" means world meters, "real" means real meters. Replaces the town and small airport lines of E_PLAN §5.5. That section put the airport "near the mountains"; it now goes on the Delmarva peninsula, so the map has somewhere to fly to there.

## 1. Scope

| In | Out (where it belongs) |
|---|---|
| Two towns: Salisbury and Frederick | More towns, waterfront towns, pier and lighthouse (more data later) |
| A kit of town buildings and sites, 16 pieces (§4.2) | New building styles for DC and Philadelphia |
| One small airport: Salisbury (SBY) | Airliner gates, jet bridges, taxi routes (G4) |
| SBY runway and final starts, and SBY in the approach menu | Choosing a destination for the route readout; it stays DCA to PHL |
| | Town names on screen, ATC for SBY (F) |
| Town size classes and kit piece rules (§4.1B) | Small cities such as Richmond, and the new city pieces (§4.5, a later step) |

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Which towns | One per large city: Salisbury (southeast), Frederick (northwest) | Both pull the player off the direct DCA to PHL path |
| Town size | Fixed world size by size class (§4.1B); until E6B.2E, about 300 x 300 m for both | Land outside the cities is about 1:25 to 1:42, so a true-scale town would nearly vanish |
| Size classes | A few named classes, not a population formula | Each can be tuned by eye. Frederick is about 2.5 to 3 times Salisbury, but should look only 30 to 50% wider |
| Choosing pieces | Layouts stay hand-authored, one per type and size; the piece rules check them | Keeps placement predictable and the same between builds |
| Town character | Generic houses plus kit pieces; one oversized signature per town | Reusable across the whole country |
| Kit pieces | Authored like landmark solids and written into the map's `landmarks` | Top view, side view and collision already work for them |
| Town data | Its own file, not `districts.json` | District outlines are in latitude and longitude and need a city |
| Airport's city | `cityId` becomes optional; without one there is no push | Salisbury belongs to no large city |
| SBY runway | One runway, 05/23, 1524 x 30 real (5,000 ft; 1950 until after E6B.3) | A runway toward 14/32 would run through the town (§3) |

## 3. Sites

Measured on the built map (`public/maps/mid-atlantic.bin`) at the real coordinates, with a throwaway script. Ground heights are real meters.

| Site | World position (x, y) | Found |
|---|---|---|
| Salisbury town (38.366 N, 75.601 W) | 9690, 4730 | All farmland, no water, 2 to 21 m within 600 world. A minor highway about 170 world away |
| SBY airport (38.3405 N, 75.5103 W) | 10000, 4620 | The same flat farmland. A minor highway about 120 world from its center |
| Frederick (39.414 N, 77.41 W) | 3280, 9640 | **Not usable as is:** water on 21% of the ground within 150 world, heights 89 to 262, a major highway about 60 away |

- **Frederick moves** about 380 world, to the nearest dry spot with 60 real (12 world) of relief or less: offset +120 east, -360 north. Set as an offset in the town data and checked by eye.
- **Town to airport:** the airport center is 314 world east and 113 south of the town center. Runway 05/23 (762 world long, true heading about 39) passes about 310 world from the town center, leaving roughly 150 between town edge and runway line. No push is needed.
- **Highways** (US 50 and US 13 at Salisbury) stay. Buildings already keep clear of them. Whether a highway crosses the airport ground must be checked when the ground is drawn.

## 4. Behavior

### 4.1 Towns
- `data/map/towns.json`: `id`, `name`, `lat`, `lon`, `offsetM` (world), `size` (§4.1B), `type` (`farm` or `hill`), `streetDeg`, `density` (1 to 5), `signature` (a kit piece and its enlargement).
- Only the center goes through the warp. The outline is an octagon of the size's radius (§4.1B) in world space.
- The ground inside is painted `suburb` (or `residential` from density 4), on dry land only. No new ground codes.
- Order: kit pieces first, then houses from the existing generator, kept off the pieces and highways.
- Same seed and inputs give the same town. Editing one town does not reshuffle another or either city.

### 4.1B Sizes and piece rules (E6B.2E)

| Size | Radius (world) | Town | Pieces, roughly |
|---|---|---|---|
| `town` | 160 | Salisbury | As now |
| `largeTown` | 220 | Frederick | More houses, room for the large pieces |
| `smallCity` | about 400 | None in E6B | §4.5 |

- In `towns.json`, `size` replaces `radiusM`. The radius for each size is one table.
- 220 is about 40% wider than 160 and nearly twice the area. Densities stay.
- Each type and size in use has its own layout in `kit.json`.
- Each piece says which types and sizes may use it and how many a town may have. A layout that breaks this fails validation.
- "Place" guides the authoring of layouts and is not checked.

| Piece | Type | Sizes | Place | Limit |
|---|---|---|---|---|
| Church | Any | Town to small city | Any | 3 |
| Water tower | Any | Town to small city | Any | 1 |
| Main street | Any | Town to small city | Center | 1 |
| School, cemetery | Any | Town to small city | Any | 1 each |
| Manor house, radio mast | Any | Town to small city | Edge | 1 each |
| Courthouse | Any | Large town to small city | Center | 1 |
| Greenhouses, fairground | Farm | Town to large town | Edge | 1 each |
| Grain elevator, oil tanks | Farm | Town to small city | Edge | 1 each |
| Mill | Hill | Town to small city | Edge | 1 |
| Rail depot, coal tipple, stone fort | Hill | Large town to small city | Edge | 1 each |

Limits for small cities are to be set with that work.

### 4.2 Kit
`data/map/kit.json`: each piece is a list of solids in real meters, in the landmark format, with a clear radius.

All pieces are part of E6B. Priority is the order they are built in (§6).

**After the showcase:** every piece was placed once, to be seen and verified. Each town now has six kinds (Frederick's three churches count as one), so the "Used by" column says where a piece may go, not where it is:

| Town | Pieces |
|---|---|
| Salisbury | Water tower (signature), church, main street, greenhouses, grain elevator, fairground |
| Frederick | Churches (3, one the signature), courthouse, main street, mill, rail depot, bastion fort |

| Priority | Piece | Rough real size | Used by |
|---|---|---|---|
| P1 | Church with steeple | 20 x 35, steeple 45 | Both |
| P1 | Water tower | tank 14 across, top 40 | Both; **Salisbury's signature** (enlarged) |
| P1 | Main street: two rows of old-town shops facing across a street | 100 x 64, up to 16 high | Both |
| P1 | Courthouse with clock tower | 40 x 25, tower 40 | Hill |
| P1 | Mill with chimney | 40 x 20, chimney 40 | Hill |
| P2 | Manor house: central block, two wings, end chimneys, columned front, drive | 50 x 20 overall, 14 high | Both; town edge, open ground round it |
| P2 | School (U with wings, clock tower, gym) with sports field and bleachers | school 110 x 26, field 110 x 70 | Both |
| P2 | Cemetery: low wall, lawn, oversized headstones, small chapel | 60 x 45, chapel 10 high | Both; beside the church or at the edge |
| P3 | Grain elevator: tall headhouse and round bins | 40 x 15, top 45 | Farm |
| P3 | Rail depot: station, four sidings, cars and a locomotive, track out both ends | 340 x 52, station 54 x 11 | Hill |
| P3 | Radio mast, red and white | 4 across, top 100 | Both |
| P3 | Greenhouses in a row | four of 40 x 10 x 5 | Farm |
| P4 | Oil storage tanks | 30 across x 15 | Farm (Salisbury) |
| P4 | Coal tipple with conveyor | 30 high | Hill (Frederick), by the rail depot |
| P4 | Bastion fort: five-pointed brick walls, barracks, parade ground, outwork | 104 across, walls 7 | Hill |
| P4 | Fairground: two tall tents, grandstand, Ferris wheel | 150 x 120, wheel 40 | Farm |

Landmark solids (boxes, tapered boxes, drums, domes, prisms) and flat ground decor (rects, discs, rings, lines) should cover most of these. The Ferris wheel, and a conveyor that really slopes, may need more or a rougher likeness.

Frederick's signature is its church spires: three, one enlarged. Plans shrink by the landmark footprint scale (2.5) and heights by the building height scale (3), then `enlarge` applies. A first guess of `enlarge` 1.5 for ordinary pieces and 2.5 for the signature is to be judged by eye.

Placement within a town: main street and courthouse or church near the center; greenhouses, mill and the larger P2 to P4 pieces at the edge.

### 4.3 Small airport
| Item | Value |
|---|---|
| Ident, name | SBY, Salisbury Regional |
| Scale | 1:2 (`airportSmall`) |
| Field height | 15 real |
| Magnetic variation | 11 deg west, so 05/23 lies on about 039 true |
| Layout | One runway, one parallel taxiway southeast of it (away from the town) into both ends, one apron |
| Buildings | A small terminal, three or four hangars, a short control tower |
| Gates | None |

No height limits or warnings for buildings near the runway.

### 4.4 In the game
- Start buttons and `?airport=SBY` come from the airport list. The default start stays DCA.
- The route readout and air start still use the first two airports. A flight started on SBY shows a readout to DCA or PHL, whichever the existing rule picks. Accepted for now.
- Ground readout and crash text use the existing district names.

### 4.5 Later: small cities (not part of E6B)

Ideas to plan as their own step. None of this is decided in detail.

- **Richmond** as the first small city: inside the map box, near its south edge. No airport. Fixed world size, with no map enlargement like DC's.
- It needs more than a big octagon of houses: a downtown with taller buildings (the existing generator), the James River with a bridge, houses and an industrial edge.
- **New pieces:** college campus, museum, hotel tower, ballpark, power plant with smokestacks, cathedral; rail yard (farm), riverfront warehouses (hill). State capitol, probably as a one-off landmark.
- **New pieces for large towns:** hospital, shopping strip with parking lot.
- Build the ballpark and campus first, and look before doing the rest.
- DC and Philadelphia are not gated by size: tall buildings come from their districts, and a stadium would be a hand-placed landmark.
- Not measured: how drawing and collision hold up with dozens of towns.

## 5. Files

| File | Change |
|---|---|
| `data/map/towns.json`, `data/map/kit.json` | New |
| `data/map/places.json` | SBY with its ground polygons |
| `data/map/checks.json` | Both towns on land |
| `tools/map/towns.ts` | New: town outline, kit placement, the town as a district and landmark specs |
| `tools/map/types.ts`, `validate.ts` | Town and kit shapes; optional airport `cityId` |
| `tools/map/place.ts` | No push without a city |
| `tools/map/skeleton.ts` | Paint town ground |
| `tools/build-map.mjs` | Load towns and kit, add their pieces and houses |
| `src/sim/world/midAtlantic.ts`, `midAtlanticBuildings.ts` | SBY layout and buildings |
| `src/config/palette.ts` | Any new materials |
| `public/maps/mid-atlantic.bin` | Rebuilt (inputs are present in `tools/raw/`) |
| `tests/mapTowns.test.ts` | New |
| `tests/mapPlace.test.ts`, `mapPatches.test.ts`, `midAtlantic.test.ts` | Third airport, fifth patch |
| `docs/CURRENT.md`, `ARCHITECTURE.md` §14, `E_PLAN.md` §5.5, `AGENTS.md` | Updated as behavior lands |

## 6. Steps

| # | Step | Done when |
|---|---|---|
| E6B.1 | Town data, ground paint and generic houses | Two patches of houses appear, on dry land |
| E6B.2 | P1 kit pieces and signatures | The two towns are told apart in both views. **Stop and look** |
| E6B.2B | P2 pieces: manor house, school, cemetery | Each is recognizable and fits its town. **Stop and look** |
| E6B.2C | P3 pieces: grain elevator, rail depot, radio mast, greenhouses | Same |
| E6B.2D | P4 pieces: oil tanks, coal tipple, fort, fairground | Same. **Stop and look** |
| E6B.2E | Town sizes and piece rules (§4.1B): `towns.json`, `kit.json`, `towns.ts`, `types.ts`, `validate.ts`, `mapTowns.test.ts`, map rebuilt | Salisbury is unchanged, Frederick is 220 world and visibly larger, a layout that breaks a rule fails. **Stop and look** |
| E6B.3 | SBY ground, runway, taxiway, apron, starts | A scripted takeoff and landing at SBY pass |
| E6B.4 | SBY buildings | They show in both views and can be hit. **Stop and look** |

## 7. Verification

| Check | Expectation |
|---|---|
| Towns | No house or kit piece on water or a highway; no overlaps; two builds give identical bytes |
| Unchanged | DC and Philadelphia buildings, landmarks, DCA and PHL are the same as before |
| Airport | Guardrails pass for SBY: dry, flat, inside the box |
| Flying | Takeoff and full-stop landing on both ends of 05/23 at default mass |
| Project | `npm run typecheck` and `npm test` pass |
| By eye | Both towns and SBY at 5, 2.5 and 1.25 m/px, side view while passing, clean console |

## 8. Risks

| Risk | Response |
|---|---|
| The runway is too short | At 762 world (DCA's is about 1090) takeoffs pass; a landing must touch down early (§10) |
| Towns are too small to notice from altitude | Raise `radiusM` or the signature's `enlarge`. Past 10 m/px only ground color shows |
| Kit pieces look wrong built from landmark solids | A pitched roof is a tapered box at best. Add a shape only if it reads badly |
| The pieces crowd out the houses or do not fit in a 160 world town | Shrink the big ones (fairground, school field), let them sit just outside the octagon, or raise `radiusM` |
| Frederick still sits badly among hills | Move the offset, or pick a lower spot farther south |
| Frederick at 220 world runs into the river to its west or crowds its highway | Move the offset, or use a radius between 160 and 220. The 160 mockup does not cover this |
| The airport ground clashes with US 50 or US 13 | Roads already avoid airport outlines; check the detour by eye |

## 9. Done when

The tests pass, both towns and SBY are on the map, you can take off from and land at SBY, and you have accepted the looks.

## 10. Results

### Mockup (before building)

A mockup of both towns on the built map (`tools/out/e6b-towns-mockup.html`, throwaway, not in git) was made first, for judging position and size. It found, with a 160 world octagon:

| Town | Found |
|---|---|
| Salisbury | Dry, 6 to 13 m. About 40 houses at density 2. A highway bends round the north and east sides, between the town and the runway line |
| Frederick, moved as in §3 | Dry, 121 to 162 m. About 55 houses at density 3. A highway runs through the middle and a river passes just west |

The user accepted the positions, the 160 world radius and the densities.

### E6B.1

- Built: `data/map/towns.json`, `tools/map/towns.ts`, town painting in `skeleton.ts`, town houses in `build-map.mjs`, `tests/mapTowns.test.ts`, both towns in `checks.json`. `buildings.ts` and `types.ts` take an area without a city (`BuiltArea`).
- Salisbury: 41 houses, street heading 12, density 2. Frederick: 62 houses, street heading -20, density 3. Kit pieces will take some of these lots.
- Compared with the map before: heights, water, highways, airports, landmarks and the 17,412 city buildings are unchanged. Only 363 base-grid ground cells differ, all inside the towns. Two builds give identical bytes.
- Checked by eye with the game's top view at 1.25 and 2.5 m/px. Not checked: side view, flying past, other zooms.
- `type` and `signature` are validated but unused until E6B.2, which also has to check the signature names a real piece.

### E6B.2

- Built: `data/map/kit.json` (the seven P1 pieces, `enlarge` 1.5, one layout per town type), kit placement in `tools/map/towns.ts`, `validateKit`, new materials in `palette.ts`.
- Beyond §4.2: layouts are in `kit.json`, as world m from the town center before the street turn. A taken spot moves to the nearest clear one. Houses keep off both a piece's clear radius and its plan with a 4 world m gap.
- Salisbury: 6 pieces (two barns, one silo pair), 38 houses. Frederick: 7 pieces (three churches, and a water tower since §4.2 says both use it), 50 houses. The 13 pieces are map landmarks; the 12 earlier landmarks, the 17,412 city buildings, ground, highways and heights are unchanged. Two builds give identical bytes.
- Checked by eye with the game's drawing code: top at 0.8, 1.25 and 2.5 m/px, side at 0.5, 1.25 and 2.5 m/px, no console errors. The towns are clearly told apart from the side. From above the water tower and big church read well; ordinary churches and barns look much like houses. Not checked: 5 m/px with the pieces, flying past, hitting a piece.
- Tests: 910 in all. 909 passed in the full run; `honors 5 m patches` ran past its 60 s limit there and passed when rerun alone with a longer limit (about 49 s).

### E6B.2B

- Built: `manor-house`, `school` and `cemetery` in `kit.json`, one of each in both layouts (listed after the P1 spots, so those did not move). A piece's plan now covers its ground decoration as well as its solids (`planM` in `towns.ts`).
- All 19 pieces fit inside the 160 world octagons; no radius change was needed. Houses fell to 31 (Salisbury) and 38 (Frederick).
- The 12 city landmarks, the 13 P1 pieces, city buildings, ground, highways and heights are unchanged. Two builds give identical bytes.
- Checked by eye with the game's drawing code: top at 0.75 and 2.5 m/px in both towns, side at 0.5 m/px (manor and bleachers read; cemetery is very low), no console errors. Not checked: flying past, hitting a piece.

### E6B.2C

- Built: `grain-elevator`, `rail-depot`, `radio-mast` and `greenhouses` in `kit.json`; the mast is in both layouts, the elevator and greenhouses in `farm`, the depot in `hill`. Kit pieces may now have `wires` (the mast's guys), which count in their plan.
- All 24 pieces fit inside the 160 world octagons. Houses fell to 27 (Salisbury) and 36 (Frederick).
- The earlier 36 landmarks and pieces, city buildings, ground, highways and heights are unchanged. Two builds give identical bytes. 911 tests and typecheck pass.
- Checked by eye with the game's drawing code: top at 0.75 m/px in both towns, side at 0.5 m/px. Not checked: other zooms, flying past, hitting a piece.
- For the look: the mast (about 50 world m) is taller than both signatures (water tower 33, church spire 38). The depot is low from the side. P4 adds four large pieces; the fairground and fort are unlikely to fit in 160 world without raising `radiusM` or letting them sit outside (§8).

### E6B.2D

- Built: `oil-tanks`, `coal-tipple`, `stone-fort` and `fairground` in `kit.json`; tanks and fairground in `farm`, tipple and fort in `hill`. The Ferris wheel is wires (drawn, not solid) with solid cars; the conveyor is solid steps.
- Both towns' `radiusM` raised from 160 to 180, as the user asked. This differs from §4.1B, which has 160 for `town` and 220 for `largeTown`; E6B.2E settles it.
- The fairground (150 x 120 real) fits nowhere inside, so a piece may now stand at the edge, outside the outline, on dry land and off highways, its middle within 1.5 radii (§8).
- 28 pieces; 33 houses in Salisbury and 43 in Frederick. With the larger outline the Salisbury manor house and Frederick school moved. City buildings, city landmarks, highways, airports and heights are unchanged; 91 base-grid ground cells differ, all at the towns. Two builds give identical bytes.
- Tests: 912; the full run had one failure, a town test that expected every piece on town ground. It was changed to expect dry ground, and a second full run passed all 912.
- Checked by eye with the game's drawing code: top at 0.85 m/px in both towns, side at 0.5 m/px (fairground and Ferris wheel, tipple). Not checked: other zooms, the fort from the side, flying past, hitting a piece.
- Still open from E6B.2C: the mast is taller than both signatures.

### Redrawn pieces (after E6B.2D, at the user's request)

- Fairground (two tall tents, wheel 40 real), stone fort (after a photo of a large star fort, simplified), rail depot (yard with four sidings), school and main street, as in the §4.2 table. All are `kit.json` data and palette colors; no code changed.
- The rail yard is placed by hand south of Frederick (found with a throwaway search for flat, dry ground off the highway), partly outside the outline; the coal tipple moved beside it.
- 28 pieces; 30 houses in Salisbury, 37 in Frederick. City buildings, ground and heights are unchanged.
- Checked by eye with the game's drawing code: top views of the fort, yard, school, main street and fairground; side view of the main street, where windows are small. Not checked: side views of the others after the change, flying past, hitting a piece.

### Cut to six per town

- The user accepted the redrawn pieces; the six were then chosen in this step, one for how clearly each reads. Only the layouts in `kit.json` changed; all pieces stay defined.
- 14 pieces; 36 houses in Salisbury and 49 in Frederick. With room freed, the Salisbury fairground moved to a nearer spot; the rail yard moved 6 world m. City buildings, city landmarks, ground and heights are unchanged. Two builds give identical bytes. 912 tests and typecheck pass.
- Checked by eye with the game's drawing code, top view at 1.1 m/px. Not checked: side view since the cut, flying past, hitting a piece.

### E6B.2E

- Built: `size` in `towns.json` in place of `radiusM`; `TOWN_RADIUS_M` in `src/config/map.ts`; `types`, `sizes` and `limit` on every piece, from the §4.1B table; layouts by type, then size; the checks in `validate.ts`; a test that layouts breaking a rule fail.
- Salisbury (`town`, 180): houses and pieces identical to before. Frederick (`largeTown`, 220): 94 houses, up from 49; the rail yard and fort shifted to nearer spots. 119 base-grid ground cells differ, all at Frederick. City buildings, city landmarks, highways, airports, heights and water are unchanged. Two builds give identical bytes. 913 tests and typecheck pass.
- Checked by eye with the game's drawing code: top view at 1.25 m/px. Not checked: side view, flying past, other zooms.
- For the look: `town` 160 or 180, and whether `largeTown` should grow (250 would be about 40% wider than 180).
- Afterwards, at the user's request, `town` went back from 180 to 160, as in §4.1B: Salisbury has 28 houses, and its fairground moved 20 world m inward. Frederick is unchanged. 49 base-grid ground cells differ, all at Salisbury. Two builds give identical bytes; 913 tests and typecheck pass. Checked by eye from above at 0.9 m/px.

### E6B.3

- Built: `cityId` optional in `types.ts`, `validate.ts` (no `pushOverrideKm` without a city) and `place.ts` (no push); SBY with one ground polygon in `places.json`; its layout in `midAtlantic.ts`; tests.
- Layout, real m in the runway frame: runway 1950 x 30; taxiway 18 wide, 90 southeast of it, into both ends, with exits at -450, 0 and 450; apron 440 x 100; ground from 100 past each end to 45 northwest and 130 to 250 southeast. A taxiway narrower than the usual 36 and hold-short bars as long as the taxiway is wide are new in the layout; DCA and PHL are unchanged.
- Guardrails pass: SBY dry, flat at 15 m, approach clear. No highway moved. DCA, PHL, city buildings and city landmarks are unchanged.
- Salisbury town: the airport's 10 m patch covers part of it, so its ground edge is finer than at 20 m. It has 24 houses (28 before) and the fairground shifted a little. The town test's lower limit went from 25 houses to 20.
- Scripted takeoffs from 05 and 23 and full-stop landings from both finals pass at default mass. 920 tests and typecheck pass. The 975 world m runway did not need lengthening.
- Checked by eye: runway and final starts in the running game, SBY in the approach menu, no console errors, and the airport from above at 2 and 0.8 m/px. Not checked: side view at the field, flying or taxiing by hand.
- **Runway shortened afterwards, at the user's request,** from 1950 to 1524 real (762 world), the real 05/23; 1950 was the length of Salisbury's other runway, 14/32. The ground, exits (now at -350, 0, 350) and taxiway ends moved in with it. Takeoffs pass from both ends. A scripted landing that aims 150 m past the threshold (flaps up, 72 m/s) touches down at 254 and stops at 813, off the end; aiming 60 past touches down at 140 and stops at 693, and the test now flies it that way. The game's final start and glide guide still aim 150 past. Not checked: landing with flaps, or by hand.

### SBY aim point

- At the user's request, SBY's approaches aim 60 world m (120 real) past either threshold instead of 150. A runway may now state its own aim point (`aimM`); the final start, approach guide, side view glide path and HSI use it. DCA and PHL are unchanged.
- The scripted landings use it: touchdown 140, stop 693 of 762. Landing with flaps is still not checked.

### E6B.4

- Built in `midAtlanticBuildings.ts`, real m in the runway frame: terminal 90 x 22 x 8 with a 24 x 8 x 5 front block, four hangars 45 x 36 x 10 (two each end of the apron), a 22 m tower, and a parking lot with cars. No gates, no height limits.
- 923 tests and typecheck pass. The map file is unchanged.
- Checked by eye: from above at 0.5 m/px, side view along the runway heading (the buildings are low and read as thin shapes; the tower stands out), the final start in the running game, no console errors. Not checked: hitting a building by hand, other zooms.

### Barn removed, fort raised

- At the user's request: the barn is gone from the kit (not distinct enough), Salisbury has the silo pair in its spot, and the bastion fort's walls are 7 real m, up from 5. The posts on its bastions went up 2 m with them; the barracks (8) and outwork (3) are unchanged.
- Only those two map pieces changed; city buildings, houses, ground and heights are identical. 923 tests and typecheck pass.
- Checked by eye with the game's drawing code: silo pair from above and from the side, fort from above. From the side the fort is still low and mostly hidden behind houses. Not checked: flying past, hitting a piece.

### Silo pair removed

- At the user's request: the silo pair is gone from the kit (too like the grain elevator) and Salisbury has the greenhouses in the barn's old spot.
- Only that one map piece changed. 923 tests and typecheck pass. Checked by eye from above at 0.5 m/px; not checked: side view, flying past, hitting a piece.
