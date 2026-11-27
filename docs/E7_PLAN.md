# E7 Implementation Plan: Polygon Airports

**Status:** E7.0 trial run, E7.1 and E7.2 built (§10); next is E7.3. The airport ground is polygons; the land still bends to the `boundaryKm` box.
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
| Points as `[lon, lat]`, as in `districts.json` | New runway, taxiway or apron layouts (`midAtlantic.ts` stays as is) |
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
| E7.5 | Redraw DCA's and PHL's ground from the real fields; tune by eye | You accept how both airports sit |
| E7.6 | Docs: `CURRENT.md`, `ARCHITECTURE.md` §14, `AGENTS.md`, results here | Docs match the game |

E7.3 changes the code but no shapes, E7.4 only the outline and E7.5 only the ground, so a bad-looking map can be traced to one of them.

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
