# D4B: altitude scale 5:1 and pitch key ramp

**Status:** built. Checked by tests (438 pass) and typecheck; see Results for what was and was not checked by eye.

All numbers are provisional. "m" means world meters unless it says real (real = world x `SCALES.altitude`, now 5).

## Why

Holding altitude was too hard. At 10:1, 1 degree of path angle at 90 m/s moved the altimeter about 3,000 ft/min, so landing within 500 ft meant holding the path to about 0.15 degrees. The shortest S/W tap (0.1 s at 10 deg/s) moved the nose 1 degree or more, and the path follows the nose with a lag of about a second, so every correction overshot.

## What changed

| Area | Change |
|---|---|
| Altitude scale | `SCALES.altitude` 10 to 5. One degree of path angle is now about 1,500 ft/min on the altimeter. Terrain stays in real meters, so it is 2x taller in world meters (peak 363 m) |
| Constants kept at the same *real* height | `START_Z` 100 to 200 (1,000 m real), `CEILING_Z` 600 to 1200 (6,000 m real), so trim, air density at the start and the ceiling are unchanged. Display cues tied to height follow: `DEPTH_CAMERA_M` 1500 to 3000, `CLOUD_BASE_M` 250 to 500, shadow fade 100 to 250 becomes 200 to 500, `SHADOW_PX_PER_M` 0.4 to 0.2 |
| Constants left in world meters on purpose | Near-ground thresholds (takeoff HUD 150 m AGL, zoom gate 20/40 m, positive rate 5 m): they are tied to what the side view shows, not to real height |
| Pitch key ramp | The commanded rate starts at `PITCH_RAMP_MIN` (12%) of the slider rate and grows with the square of hold time to full at `PITCH_RAMP_S` (1.2 s). Release resets it; reversing direction restarts it. State is `Craft.pitchHold` (signed seconds). Applies on the ground and in the air, so a rotation carries through liftoff |
| Pitch rate default | `pitchRateDegS` 10 to 8 (slider range unchanged) |
| Pitch lag | `PITCH_LAG` 0.15 to 0.3 s, so the nose has some weight and settles more softly. Tap size does not depend on it |

Result of the ramp: a 0.1 s tap moves the nose about 0.1 degrees (about 150 ft/min on the altimeter at 5:1); holding 2 s moves it more than 8 degrees.

## Test changes worth knowing

- Test worlds use `SCALES.altitude` instead of a literal 10, and reference heights use `START_Z`.
- Tests that held S or W for 1 s now hold 2 s, because a short hold is deliberately gentle. The recovery test is W 2 s, S 1 s.
- The takeoff band (rotate at 62 m/s) moved from 350 to 480 m and 62 to 72 m/s to 350 to 520 m and 62 to 75 m/s: rotation is slower to build.
- A heavy-plane stall test compares 30 t with 12 t, because 40 t now hovers in the stall warning instead of stalling. Held S for 40 t no longer tips over; the slower build gives the stall protection time to act.
- The gear settle tests start from a 5 degree sink, since W is no longer fast enough to touch down inside the settle window by itself.

## Results

- `npm run typecheck` and `npm test` pass (438 tests, 4 new for the ramp).
- Not yet checked by eye: how the new vertical scale looks in the side view (terrain is 2x taller in pixels), and how the ramp feels on a real altitude capture. Tune `PITCH_RAMP_S`, `PITCH_RAMP_MIN` and `pitchRateDegS` by feel.

## Out (belongs later)

Vertical-speed hold or altitude capture, and an altitude-scale slider (E1/E4).
