import './styles.css';
import { attachCrashBanner } from './app/crashBanner';
import { createDebugPanel } from './app/debugPanel';
import { createFrameStats } from './app/frameStats';
import { createLoop } from './app/loop';
import { initPanels } from './app/panels';
import { APPROACH_ZOOM, ALT_BUG_FINE_FT, ALT_BUG_MAX_FT, ALT_BUG_STEP_FT, SPD_BUG_FINE_KT, SPD_BUG_STEP_KT, BUG_FINE_DEG, BUG_STEP_DEG, DEBUG_REFRESH_HZ, FRAME_SAMPLES, READOUT_SR_HZ } from './config/display';
import { attachPause } from './app/pause';
import { createRunwayMenu, type RunwayMenu } from './app/runwayMenu';
import { createApLamps, type ApLamps, type ApModeName } from './app/apLamps';
import { createZoomButtons, type ZoomButtons } from './app/zoomButtons';
import { runwayEnd } from './views/runwaySelect';
import { hsiGuide, hsiSentence, type HsiGuide } from './views/hsiData';
import { fetchWithProgress } from './app/loadMap';
import { MID_ATLANTIC_URL } from './config/map';
import { SCALES, type ScaleConfig } from './config/scales';
import { attachKeyboard } from './input/keyboard';
import { attachMapPointer } from './input/mapPointer';
import { attachSidePointer } from './input/sidePointer';
import type { SimWorld } from './sim/step';
import { heightAt, worldHeight, worldWidth, type WorldGrid } from './sim/world/grid';
import { parseMap } from './sim/world/mapFile';
import { midAtlanticGrid } from './sim/world/midAtlantic';
import { groundKindAt } from './sim/world/groundKind';
import { createObstacles } from './sim/world/obstacles';
import { withAirports } from './sim/world/placeAirports';
import { buildTestAirport } from './sim/world/testAirport';
import { buildTestMap } from './sim/world/testMap';
import { CLOSE_ZOOM, DEFAULT_ZOOM, ZOOM_LEVELS, metersPerPixel, zoomForMpp, type Point } from './views/camera';
import { cameraFor, initialFollow, panned, recentered, zoomed } from './views/followCamera';
import { SIDE_ZOOM_LEVELS, clampSideZoom, sideMetersPerPixel, sideZoomForMpp } from './views/sideCamera';
import { approachBand, easeMpp, liningUp, topPhase, recall, remember, SIDE_BAND_ZOOMS, sideBand, type PhaseZoom, type SideBand, type ZoomPhase } from './views/zoomGate';
import { NO_CALLOUTS, calloutSentence, gearPrompt, remainingOnAny, stepCallouts, stepSpeeds, takeoffMode, type CalloutState, type TakeoffHud } from './views/takeoffStrip';
import type { VSpeeds } from './sim/flight/vspeeds';
import { speedMarks } from './views/gauges/airspeed';
import { createSideView } from './views/sideView';
import { sunStep, timeOfDay } from './sim/sun';
import { sunForStep } from './views/sunLight';
import { bestApproach, type ApproachGuide } from './views/approach';
import { routeFor } from './views/route';
import { magneticVariation } from './views/magnetic';
import { stallState } from './sim/flight/aero';
import { gearWarning } from './sim/flight/gear';
import { forcesOn } from './sim/flight/forces';
import { terrainAhead } from './sim/flight/terrain';
import { drawPanel, readoutSentence, type ReadoutText } from './views/instruments';
import { buildPanelState, samePanelState, type PanelState } from './views/panelState';
import { stepBug } from './views/headingBug';
import { bugWorldZ, stepAltBug } from './views/altitudeBug';
import { displayedAltitudeFt, indicatedSpeed, knotsToMetersPerSecond, metersPerSecondToKnots } from './sim/units';
import { headingError } from './sim/flight/autopilot';
import { apNoticeText, apSentence } from './views/autopilotText';
import { heightAboveGround } from './views/format';
import { AIR_START, apActive } from './sim/state';
import { steerRate } from './sim/flight/ground';
import { pickStart, startList } from './sim/world/startList';
import { DEFAULT_TUNING } from './config/motion';
import { createTopView } from './views/topView';

const params = new URLSearchParams(location.search);

/** `?map=test` is the hand-made island; anything else is the generated Mid-Atlantic (E3). */
async function loadWorld(): Promise<{ grid: WorldGrid; scales: ScaleConfig }> {
  const status = document.getElementById('loading');
  if (params.get('map') === 'test') {
    return { grid: withAirports(buildTestMap(), [buildTestAirport()]), scales: SCALES };
  }
  try {
    const buffer = await fetchWithProgress(import.meta.env.BASE_URL + MID_ATLANTIC_URL, (done) => {
      if (status && done !== null) status.textContent = `Loading map ${Math.round(done * 100)}%`;
    });
    const map = parseMap(buffer);
    const loaded = { grid: midAtlanticGrid(map), scales: { altitude: map.altitudeScale, geoDistance: map.geoDistance } };
    return loaded;
  } catch (error) {
    if (status) status.textContent = `Could not load the map: ${error instanceof Error ? error.message : String(error)}. Open ?map=test for the test island.`;
    throw error;
  }
}

const { grid, scales } = await loadWorld();
const world: SimWorld = {
  width: worldWidth(grid),
  height: worldHeight(grid),
  heightAt: (x, y) => heightAt(grid, scales, x, y),
  altitudeScale: scales.altitude,
  groundKind: (x, y) => groundKindAt(grid, x, y),
  obstacleAt: createObstacles(grid, scales),
};
const runways = grid.airports.flatMap((a) => a.runways);
// The page starts standing on the first airport's runway, engine idle. `?airport=PHL` picks another, and
// `?start=final` opens lined up on final approach and glide slope (or `?start=air`).
const STARTS = startList(grid.airports, world.heightAt, scales.altitude, DEFAULT_TUNING);
const chosen = pickStart(STARTS, params.get('start'), params.get('airport'));
if (!chosen) throw new Error('The map has no runway to start on');
const pageStart = chosen.spec;
const bounds = world;
const crashBanner = attachCrashBanner(grid, scales);
const syncBanner = (): void => crashBanner.update(loop.state);
const topView = createTopView(grid, scales);
const sideView = createSideView(grid, scales);

// Top-view camera: locked to the plane, or free look. Never part of the simulation.
// The top view remembers one zoom for the ground, one for lining up on the picked runway and one for the air; the side view one for each height band.
// The wheel, the - / + buttons and keys 1 to 4 edit the current one only; the gates (views/zoomGate.ts) pick it from height above ground, and the shown
// zoom eases toward it.
let topMem: PhaseZoom = { ground: CLOSE_ZOOM, approach: APPROACH_ZOOM, air: DEFAULT_ZOOM };
let linedUp = false;
let sideMem: Readonly<Record<SideBand, number>> = SIDE_BAND_ZOOMS;
let shownBand: SideBand = 'near';
let zoomPhase: ZoomPhase = 'ground';
let follow = initialFollow(recall(topMem, zoomPhase));
let cursor: Point | null = null;
let sideZoom = sideMem[shownBand];
let shownTopMpp = metersPerPixel(follow.free.zoom);
let shownSideMpp = sideMetersPerPixel(sideZoom);
let shownTopZoom = follow.free.zoom;
let shownSideZoom = sideZoom;
let lastFrameMs = performance.now();
// Takeoff HUD (C4B, D5A): V-speeds, call-outs and what the panels draw. View state, rebuilt from the sim state each frame.
let vSpeedsShown: VSpeeds | null = null;
let calloutState: CalloutState = NO_CALLOUTS;
let takeoffHud: TakeoffHud | null = null;
let guide: ApproachGuide | null = null;
let sideCursor: Point | null = null;
/** Magnetic variation at a position, degrees. Headings are shown magnetic; the sim flies true. */
const variationAt = (at: { readonly x: number; readonly y: number }): number => magneticVariation(grid.airports, at.x, at.y);
// Heading bug (degrees, clockwise from magnetic north): a view setting. It starts at the plane's heading.
let bugDeg = Math.round((pageStart.heading * 180) / Math.PI + variationAt(pageStart)) % 360;
/** The bug as the true heading, radians, that the autopilot flies from here. */
const bugHeading = (at: { readonly x: number; readonly y: number }): number => ((bugDeg - variationAt(at)) * Math.PI) / 180;
const moveBug = (sign: -1 | 1, fine: boolean): void => {
  bugDeg = stepBug(bugDeg, sign * (fine ? BUG_FINE_DEG : BUG_STEP_DEG));
  syncAutopilotBugs();
  if (loop.paused) {
    panels.top.requestDraw();
    panels.instruments.requestDraw();
  }
};
// Altitude bug (displayed feet, the same feet as ALT): starts at the plane's altitude to the nearest 100 ft.
let altBugFt = Math.round(displayedAltitudeFt(AIR_START.z, scales) / 100) * 100;
const moveAltBug = (sign: -1 | 1, fine: boolean): void => {
  altBugFt = stepAltBug(altBugFt, sign * (fine ? ALT_BUG_FINE_FT : ALT_BUG_STEP_FT), ALT_BUG_MAX_FT);
  syncAutopilotBugs();
  if (loop.paused) {
    panels.side.requestDraw();
    panels.instruments.requestDraw();
  }
};
/**
 * The bugs are view state; the autopilot flies the sim's copies. While it is on, any difference is sent as `apTarget`.
 * Run on every drawn frame, because the loop drops queued commands on a pause; paused, `send` applies at once.
 */
const AP_BUG_RESEND_RAD = (0.1 * Math.PI) / 180;
/** Whether heading and altitude hold were on at the last sync. */
let hdgHeld = false;
let altHeld = false;
function syncAutopilotBugs(): void {
  const ap = loop.state.autopilot;
  // A mode just taken holds the present value: its bug moves there, not the plane to the bug.
  if (ap.hdg && !hdgHeld) bugDeg = stepBug(Math.round((ap.headingTarget * 180) / Math.PI + variationAt(loop.state.craft)), 0);
  if (ap.alt && !altHeld) altBugFt = Math.round(displayedAltitudeFt(ap.targetZ, scales));
  hdgHeld = ap.hdg;
  altHeld = ap.alt;
  if (!ap.hdg && !ap.alt) return;
  const heading = bugHeading(loop.state.craft);
  const z = bugWorldZ(altBugFt, scales);
  const headingOff = ap.hdg && Math.abs(headingError(ap.headingTarget, heading)) > AP_BUG_RESEND_RAD;
  if (headingOff || (ap.alt && Math.abs(ap.targetZ - z) > 1e-6)) loop.send({ kind: 'apTarget', heading, z });
}
/** A click on the HDG, ALT or SPD lamp. */
function toggleApMode(mode: ApModeName): void {
  const on = !loop.state.autopilot[mode];
  loop.send({ kind: 'apMode', mode, on });
  redrawAutopilot();
}
/** Paused, a command applies at once but no frame follows: move the bugs and redraw here. */
function redrawAutopilot(): void {
  if (!loop.paused) return;
  syncAutopilotBugs();
  panels.top.requestDraw();
  panels.side.requestDraw();
  panels.instruments.requestDraw();
}
/** Speed target nudge in knots: the sim's own target moves, so the key repeats are exact. */
const moveSpeedBug = (sign: -1 | 1, fine: boolean): void => {
  const ap = loop.state.autopilot;
  if (!ap.spd) return;
  const kt = metersPerSecondToKnots(ap.targetIas) + sign * (fine ? SPD_BUG_FINE_KT : SPD_BUG_STEP_KT);
  loop.send({ kind: 'apTarget', ias: knotsToMetersPerSecond(kt) });
  if (loop.paused) panels.instruments.requestDraw();
};
// Kept here, not read from `panels`, because the first draws run inside initPanels.
let sideSize = { width: 640, height: 360 };
let sideSized = false;
let requestTop: () => void = () => {};
// Runway selection (D5C). Made after the panels, whose first draws run before it.
let runwayMenu: RunwayMenu | null = null;
let apLamps: ApLamps | null = null;
let topZoomButtons: ZoomButtons | null = null;
let sideZoomButtons: ZoomButtons | null = null;

/**
 * Once per drawn frame (idempotent within one): the zoom phase and easing, and the takeoff HUD. Paused, the zoom snaps
 * so a wheel turn shows at once.
 */
function syncFrame(): void {
  const now = performance.now();
  const dt = (now - lastFrameMs) / 1000;
  lastFrameMs = now;
  const sim = loop.state;
  const craft = sim.craft;
  const agl = craft.z - world.heightAt(craft.x, craft.y);
  linedUp = liningUp(linedUp, craft, agl, runwayEnd(grid.airports, runwayMenu?.selected ?? null));
  const phase = topPhase(zoomPhase, craft.onGround, agl, linedUp);
  if (phase !== zoomPhase) {
    topMem = remember(topMem, zoomPhase, follow.free.zoom);
    // Coming down to land always gets the closest level, whatever the ground zoom was left at.
    if (phase === 'ground') topMem = remember(topMem, 'ground', CLOSE_ZOOM);
    zoomPhase = phase;
    follow = { ...follow, free: { ...follow.free, zoom: recall(topMem, phase) } };
  }
  const crashed = sim.crash !== null;
  guide = bestApproach(craft, agl, crashed, runways, world.heightAt);
  const band = guide ? approachBand(phase) : sideBand(shownBand, craft.onGround, displayedAltitudeFt(agl, scales));
  if (band !== shownBand) {
    sideMem = { ...sideMem, [shownBand]: sideZoom };
    shownBand = band;
    sideZoom = sideMem[band];
  }
  const topTarget = metersPerPixel(follow.free.zoom);
  const sideTarget = sideMetersPerPixel(sideZoom);
  shownTopMpp = loop.paused ? topTarget : easeMpp(shownTopMpp, topTarget, dt);
  shownSideMpp = loop.paused ? sideTarget : easeMpp(shownSideMpp, sideTarget, dt);
  shownTopZoom = shownTopMpp === topTarget ? follow.free.zoom : zoomForMpp(shownTopMpp);
  shownSideZoom = shownSideMpp === sideTarget ? sideZoom : sideZoomForMpp(shownSideMpp);
  // The phase or band may have changed the zoom under the buttons.
  topZoomButtons?.sync();
  sideZoomButtons?.sync();

  const mode = takeoffMode(craft, agl, crashed) && !guide;
  const remaining = remainingOnAny(runways, craft);
  vSpeedsShown = stepSpeeds(vSpeedsShown, craft, mode, sim.tuning, remaining);
  const ias = indicatedSpeed(craft, scales);
  calloutState = stepCallouts(calloutState, { tick: sim.tick, mode, craft, ias, speeds: vSpeedsShown, aglM: agl });
  takeoffHud =
    mode && vSpeedsShown
      ? { marks: speedMarks(vSpeedsShown, ias), remaining, callout: calloutState.shown }
      : null;
}
/** The top-view camera as drawn: the follow camera at the eased zoom. */
const shownCamera = () => ({ ...cameraFor(follow, currentCraft()), zoom: shownTopZoom });

/** One zoom level for a view (the - / + buttons and keys 1 to 4): the same as a wheel notch at the view's center. */
function zoomTop(steps: -1 | 1): void {
  const { width, height } = panels.top.size;
  follow = zoomed(follow, currentCraft(), panels.top.size, { x: width / 2, y: height / 2 }, steps, bounds);
  topZoomButtons?.sync();
  if (loop.paused) panels.top.requestDraw();
}
function zoomSide(steps: -1 | 1): void {
  sideZoom = clampSideZoom(sideZoom + steps);
  sideZoomButtons?.sync();
  redrawBoth();
}

// The loop owns the only copy of the simulation state; views read snapshots.
const keyboard = attachKeyboard({
  KeyP: () => loop.toggle(),
  KeyC: () => {
    follow = recentered(follow);
    if (loop.paused) panels.top.requestDraw();
  },
  Enter: () => loop.send({ kind: 'restart' }),
  BracketLeft: (fine) => moveBug(-1, fine),
  BracketRight: (fine) => moveBug(1, fine),
  Minus: (fine) => moveAltBug(-1, fine),
  Equal: (fine) => moveAltBug(1, fine),
  KeyZ: () => {
    const ap = loop.state.autopilot;
    // With any mode on, Z is the way out of all of them.
    if (apActive(ap)) loop.send({ kind: 'autopilot', on: false });
    else loop.send({ kind: 'autopilot', on: true });
    redrawAutopilot();
  },
  Comma: (fine) => moveSpeedBug(-1, fine),
  Period: (fine) => moveSpeedBug(1, fine),
  Digit1: () => zoomTop(-1),
  Digit2: () => zoomTop(1),
  Digit3: () => zoomSide(-1),
  Digit4: () => zoomSide(1),
  Backquote: () => {
    debug?.toggle();
    if (debug?.visible) debug.refresh();
  },
});

// Real-frame timing, kept whether or not the debug panel is shown.
const timing = {
  interval: createFrameStats(FRAME_SAMPLES),
  top: createFrameStats(FRAME_SAMPLES),
  side: createFrameStats(FRAME_SAMPLES),
  instruments: createFrameStats(FRAME_SAMPLES),
  total: createFrameStats(FRAME_SAMPLES),
};
let shownReadout: ReadoutText | null = null;
let shownPanel: PanelState | null = null;
let lastDebugMs = 0;
let lastSrMs = 0;
let shownSr = '';
const srEl = document.getElementById('readout-sr');
// Call-outs have their own live region, so they are spoken at once and the readout line stays quiet.
const calloutEl = document.getElementById('callout-sr');
let shownCallout: string | null = null;

/** Redraws the instruments panel only when a displayed string changed, since render() reads page layout. */
function syncInstruments(): void {
  if (shownPanel && samePanelState(shownPanel, currentPanel())) return;
  panels.instruments.render();
}

function syncScreenReader(now: number): void {
  const callout = takeoffHud?.callout ?? null;
  // Written once per call-out: the gear lever moving during it does not repeat it.
  if (calloutEl && callout !== shownCallout) {
    shownCallout = callout;
    calloutEl.textContent = calloutSentence(callout, loop.state.craft.gearDown);
  }
  if (!srEl || !shownReadout || now - lastSrMs < 1000 / READOUT_SR_HZ) return;
  lastSrMs = now;
  const text = readoutSentence(shownReadout) + apSentence(loop.state.autopilot, loop.state.tick) + hsiSentence(currentApproach());
  if (text === shownSr) return;
  shownSr = text;
  srEl.textContent = text;
}
const loop = createLoop({
  world,
  draw: () => {
    syncBanner();
    syncAutopilotBugs();
    const t0 = performance.now();
    panels.top.render();
    const t1 = performance.now();
    panels.side.render();
    const t2 = performance.now();
    syncInstruments();
    const t3 = performance.now();
    timing.top.push(t1 - t0);
    timing.side.push(t2 - t1);
    timing.instruments.push(t3 - t2);
    timing.total.push(t3 - t0);
    // Text is written after the draws, so it cannot distort their timing.
    syncScreenReader(t3);
    if (debug?.visible && t3 - lastDebugMs >= 1000 / DEBUG_REFRESH_HZ) {
      lastDebugMs = t3;
      debug.refresh();
    }
  },
  requestDraw: () => {
    syncBanner();
    panels.top.requestDraw();
    panels.side.requestDraw();
    panels.instruments.requestDraw();
    if (debug?.visible) requestAnimationFrame(() => debug.refresh());
  },
  onFrame: (s) => timing.interval.push(s * 1000),
  sampleKeys: () => keyboard.keys.sample(),
  clearKeys: () => keyboard.keys.clear(),
  startPaused: !document.hasFocus(),
  start: pageStart,
});
// Camera and plane both come from one snapshot, so they cannot disagree.
const currentCraft = () => loop.snapshot();
/** The sun both views draw by: one of the day's fixed positions, so every layer agrees. */
const currentSun = () => sunForStep(sunStep(timeOfDay(loop.state.tick, loop.state.sunClock)));
/** The HSI's figures for the picked runway, or null with none. */
const currentApproach = (): HsiGuide | null => {
  const end = runwayEnd(grid.airports, runwayMenu?.selected ?? null);
  return end && hsiGuide(currentCraft(), end, world.heightAt);
};
const currentPanel = (): PanelState => {
  const craft = currentCraft();
  const crashed = loop.state.crash !== null;
  const bugsShown = !crashed && takeoffHud === null && guide === null;
  return buildPanelState(craft, scales, loop.state.tuning, {
    stall: crashed ? 'none' : stallState(craft, loop.state.tuning),
    braking: loop.state.controls.brake,
    terr: !crashed && terrainAhead(craft, world.heightAt, false, world.obstacleAt),
    autopilot: loop.state.autopilot,
    // The HSI keeps its bug on an approach; the other views do not (D5D).
    headingBugDeg: !crashed && takeoffHud === null ? bugDeg : null,
    approach: currentApproach(),
    variationDeg: variationAt(craft),
    timeOfDay: timeOfDay(loop.state.tick, loop.state.sunClock),
    altBugFt: bugsShown ? altBugFt : null,
    gearWarn: !crashed && gearWarning(craft, heightAboveGround(craft.z, world.heightAt(craft.x, craft.y)), indicatedSpeed(craft, scales)),
    crashed,
    speedMarks: takeoffHud?.marks,
    callout: takeoffHud?.callout ?? null,
    gearPrompt: gearPrompt(takeoffHud?.callout ?? null, craft.gearDown),
  });
};

topView.warm(currentSun());
sideView.warm();

const panels = initPanels({
  instruments: (ctx, size) => {
    shownPanel = currentPanel();
    shownReadout = shownPanel.text;
    drawPanel(ctx, size, shownPanel);
    runwayMenu?.place();
    apLamps?.place();
  },
  top: (ctx, size) => {
    syncFrame();
    const craft = currentCraft();
    const unfinished = topView.draw(
      ctx,
      size,
      shownCamera(),
      cursor,
      {
        craft,
        crashed: loop.state.crash !== null,
        turnRate: craft.onGround ? steerRate(craft.speed, loop.state.controls.turn) : forcesOn(craft, loop.state.tuning, scales.altitude).dHeadingDt,
      },
      follow.following,
      bugDeg,
      currentSun(),
      guide,
      routeFor(grid.airports, loop.state.start),
      runwayEnd(grid.airports, runwayMenu?.selected ?? null),
      variationAt(craft),
    );
    // Running, the next frame comes anyway; paused, ask for one so the building tiles finish.
    if (unfinished && loop.paused) requestAnimationFrame(() => requestTop());
  },
  side: (ctx, size) => {
    syncFrame();
    const changed = size.width !== sideSize.width || size.height !== sideSize.height;
    sideSize = { width: size.width, height: size.height };
    sideView.draw(ctx, sideSize, currentCraft(), shownSideZoom, sideCursor, loop.state.crash !== null, altBugFt, currentSun(), takeoffHud, guide, { on: loop.state.autopilot.alt, notice: apNoticeText(loop.state.autopilot.notice, loop.state.tick) }, variationAt(currentCraft()));
    // The top view marks exactly what this panel shows, so it follows our size.
    // Redraw only on a change, so the two panels cannot trigger each other forever.
    if (changed || !sideSized) {
      sideSized = true;
      requestTop();
    }
  },
});
requestTop = panels.top.requestDraw;
runwayMenu = createRunwayMenu({
  airports: grid.airports,
  canvas: panels.instruments.canvas,
  size: () => panels.instruments.size,
  craft: () => currentCraft(),
  destination: () => routeFor(grid.airports, loop.state.start)?.toIdent ?? null,
  // While running, the next frame draws it.
  onChange: () => {
    if (!loop.paused) return;
    panels.instruments.requestDraw();
    panels.top.requestDraw();
  },
});
apLamps = createApLamps({
  canvas: panels.instruments.canvas,
  size: () => panels.instruments.size,
  autopilot: () => loop.state.autopilot,
  onToggle: toggleApMode,
});
topZoomButtons = createZoomButtons({
  canvas: panels.top.canvas,
  view: 'Top view',
  keys: { out: '1', in: '2' },
  levels: ZOOM_LEVELS.length,
  zoom: () => follow.free.zoom,
  onZoom: zoomTop,
});
sideZoomButtons = createZoomButtons({
  canvas: panels.side.canvas,
  view: 'Side view',
  keys: { out: '3', in: '4' },
  levels: SIDE_ZOOM_LEVELS.length,
  zoom: () => sideZoom,
  onZoom: zoomSide,
});
const debug = createDebugPanel({ loop, scales: scales, timing, heightAt: world.heightAt, groundKind: world.groundKind, starts: STARTS, onDisplayChange: () => panels.instruments.requestDraw() });

// While running, the loop draws every frame. Draw on demand only when paused.
const redrawBoth = (): void => {
  if (!loop.paused) return;
  panels.top.requestDraw();
  panels.side.requestDraw();
};

attachMapPointer({
  canvas: panels.top.canvas,
  getView: () => panels.top.size,
  getCamera: shownCamera,
  onPan: (dx, dy) => {
    follow = panned(follow, currentCraft(), dx, dy, bounds);
    if (loop.paused) panels.top.requestDraw();
  },
  onZoom: (at, steps) => {
    follow = zoomed(follow, currentCraft(), panels.top.size, at, steps, bounds);
    topZoomButtons?.sync();
    if (loop.paused) panels.top.requestDraw();
  },
  setCursor: (c) => {
    cursor = c;
    if (loop.paused) panels.top.requestDraw();
  },
  onClick: (w) => {
    loop.send({ kind: 'place', x: w.x, y: w.y });
  },
});

attachSidePointer({
  canvas: panels.side.canvas,
  onTurn: (r) => {
    loop.send({ kind: 'rotate', by: r });
  },
  onZoom: (steps) => {
    sideZoom = clampSideZoom(sideZoom + steps);
    sideZoomButtons?.sync();
    redrawBoth();
  },
  setCursor: (c) => {
    sideCursor = c;
    redrawBoth();
  },
});

attachPause(loop);
loop.start();
// The cover stays up through the warm-up above, which takes a few seconds on the big map.
document.getElementById('loading')?.remove();
