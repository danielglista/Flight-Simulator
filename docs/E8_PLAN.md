# E8 Implementation Plan: Sun and Shadows

**Status:** E8.1 built (2026-11-27), not committed. E8.2 planned, nothing built.
**Milestone:** shadows and lit faces agree with a sun in the southern sky, and then follow a sun that crosses it.
**Starting state:** E6 committed. E4 (scale tuning) is not done; E7 is planned, not built. E8 depends on neither.

All numbers are provisional. `E8` is a proposed step name; it is not yet in ARCHITECTURE.md §14.

## 1. The problem

Everything is lit from the northwest, so shadows fall southeast. In the northern hemisphere the sun is mostly in the southern sky. The direction is written separately into each drawing module.

## 2. Scope

| In | Out (where it belongs) |
|---|---|
| One sun value passed into the drawing code | Night, dawn and dusk color tints (day/night milestone) |
| E8.1: fixed southwest sun | City, runway, road and aircraft lights (same) |
| E8.2: sun moves from sunrise to sunset, then jumps back to sunrise | Seasons; latitude that varies by city |
| Shadow direction and length, face and roof lighting | Terrain hillshade: stays northwest (§3) |
| Repainting the cached building tiles | Side-view terrain slope shading (lit from screen left, not a compass direction) |

## 3. Decisions (proposed)

| Decision | Choice | Why |
|---|---|---|
| How views get the sun | A `Sun` argument to draw and shape functions, never an imported constant | E8.2 only changes where it comes from |
| Terrain hillshade | Unchanged, northwest | Lighting relief from the south can make ridges read as valleys; it is also cached |
| Fixed sun (E8.1) | Azimuth 225 (southwest), shadow 0.5 m per m of height | Keeps today's diagonal look and length |
| Sun path (E8.2) | Equinox path at one latitude, 39 N | A few lines of math; Boston and Miami do not justify per-city values |
| Day length (E8.2) | 12 min sunrise to sunset (43,200 steps), then straight back to sunrise | Your call. A later full cycle would be 24 min |
| Time source | `SimState.tick`, plus an offset | Replays stay the same; pause stops the sun |
| Sun movement | 60 steps per day: one every 12 s | Buildings are cached; every layer uses the same stepped sun so they agree |

Note: at 12 min, the sun covers 12 hours at 60 times real speed. Earlier flight estimates suggested about 15 to 25. A flight of 4 to 6 min would span a third to half of the day. Day length is one config value.

## 4. The sun value

```ts
interface Sun {
  readonly azimuth: number;    // radians clockwise from north, toward the sun
  readonly shadowPerM: number; // shadow length per meter of height
  readonly strength: number;   // 0..1: how much shadows and face shading show
}
```

Shadows point along `azimuth + 180`. A face with outward normal `n` is lit by `1 + strength * (base + amp * dot(n, s) - 1)`, where `s` is the horizontal unit vector toward the sun.

| Surface | `base` | `amp` |
|---|---|---|
| Flat walls and slopes | 0.90 | 0.25 |
| Round walls and domes (side view) | 0.92 | 0.20 |

One formula replaces the two four-value tables (`FACE_LIGHT`, `SLOPE_LIGHT`), so individual faces will not match today's values exactly even after mirroring the direction.

## 5. E8.1: Fixed southwest sun

**Behavior:** all cast shadows fall northeast. South and west faces are the bright ones.

| Item | Change | File |
|---|---|---|
| `Sun` type and `FIXED_SUN` | New. Replaces `BUILDING_SHADOW_PER_M` | `config/sun.ts`, `config/map.ts` |
| Shadow vector and face light helpers | New, pure | `views/sunLight.ts` |
| Building shadows | Sweep along the sun's shadow vector | `views/cityLayer.ts` |
| Pitched roofs | Darken the half facing away from the sun, chosen from the building's angle. Today it is always the same local half | `views/cityLayer.ts` |
| Landmark shadows, flag poles, slopes, dome highlight | From the sun | `views/landmarkLayer.ts` |
| Side-view walls and round walls | From the sun | `views/sideLandmarks.ts` |
| Plane shadow | Direction from the sun; length still shows height only | `views/depth.ts` |
| Cloud shadows (off by default) | Direction from the sun | `views/topView.ts` |
| Bridge shadow | Today 5 m east and 5 m south; same distance along the shadow vector | `views/roadLayer.ts` |
| Passing it through | `main.ts` gives `FIXED_SUN` to both views | `main.ts`, `views/topView.ts`, `views/sideView.ts` |
| Comment that cites the game's shadows | Say the preview keeps northwest hillshade | `tools/map/shade.ts` |

**Steps**
1. `config/sun.ts`, `views/sunLight.ts`, `tests/sunLight.test.ts`.
2. Buildings, including roofs. Update `tests/cityLayer.test.ts`.
3. Landmarks, both views. Update `tests/landmarkLayer.test.ts`, `tests/sideLandmarks.test.ts`.
4. Plane, cloud and bridge shadows, with their tests.
5. `docs/CURRENT.md`.

**Verification:** `npm run typecheck`, `npm test`; in the browser, DC in both views with North up and turned: buildings, a pitched-roof suburb, the Monument, a dome, a bridge, the plane low over the ground. No console errors.

**Done when:** every cast shadow points the same way (northeast), lit faces agree with it, and a test shows that passing a different azimuth turns them all.

## 6. E8.2: Moving sun

**Behavior**
- Sunrise to sunset takes 12 min. The next step is sunrise again.
- A game starts a quarter of the way through the day (mid-morning), 9 min before sunset.
- Restart and new starts leave the time alone. Pause stops it.
- Debug panel: a time-of-day slider and a "hold sun" checkbox.
- No sky or ground color changes.

**Path** (hour angle `H` from -90 at sunrise to +90 at sunset, latitude `L`):

```
sin(elevation) = cos(L) * cos(H)
azimuth        = 180 deg + atan2(sin(H), cos(H) * sin(L))
```

| Part of day | Time, min | Sun azimuth | Elevation | Shadow per m | Shadows point |
|---|---|---|---|---|---|
| Sunrise | 0 | 090 | 0 | hidden | west |
| Mid-morning (start) | 3 | 122 | 33 | 0.94 | northwest |
| Noon | 6 | 180 | 51 | 0.50 | north |
| Mid-afternoon | 9 | 238 | 33 | 0.94 | northeast |
| Sunset | 12 | 270 | 0 | hidden | east |

**Length and fade**
- `shadowPerM = min(1.5, 0.62 / tan(elevation))`. This is stylized: 0.62 keeps noon at today's 0.5. The cap applies below about 22 deg, roughly the first and last 2 min.
- `strength` rises smoothly from 0 at the horizon to 1 at 10 deg (about the first and last 50 s). At the jump from sunset to sunrise there is then nothing directional to see change.
- The plane shadow keeps its alpha: it is a height cue. Its direction does jump at the reset.

**Cached work that must now follow the sun**

| What | Today | Change |
|---|---|---|
| Building tiles | Painted once; zoomed-out levels all at load | Each carries the sun step it was painted for. A stale visible tile is repainted within the existing 6 ms per frame budget and shown until then. Off-screen tiles wait until seen |
| Which tiles a building touches | Its roof and shadow | Roof plus the longest shadow it can have in any direction it can point (west, north, east) |
| Landmark shadows and culling boxes | Worked out once | Worked out again on each sun step |
| Landmarks, roads, plane, side view | Drawn each frame | Nothing beyond reading the current sun |

**Files:** `sim/sun.ts` (new, pure: time of day to azimuth and elevation), `sim/state.ts`, `sim/commands.ts` and `sim/step.ts` (`sunTime`, `sunHold`), `config/sun.ts` (day length, latitude, steps, cap, fade), `views/sunLight.ts` (elevation to `shadowPerM` and `strength`), `views/cityLayer.ts`, `views/landmarkLayer.ts`, `app/debugPanel.ts`, `main.ts`.

**Steps**
1. Measure first: time to paint one tile at each zoom level over central DC and Philadelphia. Record it here.
2. `sim/sun.ts`, state and commands, with tests (the table above, the wrap at 12 min, pause and restart).
3. Length and fade, with tests.
4. Tile and landmark repainting, with tests for the stale-tile choice and the wider tile membership.
5. Debug controls.
6. `docs/CURRENT.md`; the day length in `docs/GAME_DESIGN.md`.

**Verification:** `npm run typecheck`, `npm test`; in the browser, use the slider at the five times in the table; watch one full day over DC at a close and a zoomed-out level for stutter, mixed shadow directions between tiles, and the reset. Compare frame times in the debug panel with step 1's baseline.

**Done when:** a full 12 min day runs and wraps, shadows and lit faces follow it in both views, and flying over DC shows no stutter you notice.

## 7. Risks

| Risk | Response, in order |
|---|---|
| One dense zoomed-out tile takes longer than a frame to paint | Fewer sun steps; drop shadows at the coarsest zoom; smaller tiles |
| Neighboring tiles briefly show different sun steps, cutting shadows at the seam | Paint the next step's visible tiles ahead of time (the sun is predictable) and swap them together; costs memory |
| Shadows on the ground visibly jump every 12 s (up to about 5 deg near noon) | More steps if painting is cheap; cross-fade if not |
| Longer low-sun shadows darken the city and cost more to fill | Lower the 1.5 cap |
| Building shadows disagree with the fixed northwest hillshade | Accept first; change the hillshade only if it bothers you |

## 8. Questions, settled

1. A game starts mid-morning, not in the afternoon like E8.1's fixed sun.
2. A restart or new start does not reset the time of day.

## 9. Results

### E8.1 (2026-11-27)

Built as in section 5. `npm run typecheck` and `npm test` pass (820 tests).

**Differences and choices**
- The bridge shadow distance is `BRIDGE_SHADOW_M` in `config/map.ts` (7.07 m). The roof's darker-half value is `ROOF_AWAY_LIGHT` in `config/sun.ts`.
- `strength` scales face and roof shading only. Fading the shadows by it is left to E8.2.
- The building tile cache and prepared landmark shadows start over if handed a different `Sun` object. E8.2 replaces this for tiles with gradual repainting; a new object every frame would rebuild everything.
- Side-view ordinary buildings are unchanged (not in the scope table): their darker strip is on the screen right.

**Seen in the browser** (DC, drawn from the real view modules onto an overlay canvas, because the pane was hidden and the game stayed paused): building, Monument, Capitol and Jefferson shadows northeast, including with the map turned 110 deg; pitched roofs lit on the west half; plane shadow northeast; a northwest-southeast bridge casting northeast, and southwest with a test azimuth of 45; no console errors. The side-view dome shading was only faintly readable at its size.

**Not checked:** the running game in a visible window, and flying it.

**Noticed:** the highway bridge near the Jefferson Memorial runs southwest to northeast, along the sun, so its shadow hardly shows.
