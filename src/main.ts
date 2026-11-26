import './styles.css';
import { attachCrashBanner } from './app/crashBanner';
import { createDebugPanel } from './app/debugPanel';
import { createFrameStats } from './app/frameStats';
import { createLoop } from './app/loop';
import { initPanels } from './app/panels';
import { ALT_BUG_FINE_FT, ALT_BUG_MAX_FT, ALT_BUG_STEP_FT, SPD_BUG_FINE_KT, SPD_BUG_STEP_KT, BUG_FINE_DEG, BUG_STEP_DEG, DEBUG_REFRESH_HZ, FRAME_SAMPLES, READOUT_SR_HZ } from './config/display';
import { attachPause } from './app/pause';
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
import { withAirports } from './sim/world/placeAirports';
import { buildTestAirport } from './sim/world/testAirport';
import { buildTestMap } from './sim/world/testMap';
import { CLOSE_ZOOM, DEFAULT_ZOOM, metersPerPixel, zoomForMpp, type Point } from './views/camera';
import { cameraFor, initialFollow, panned, recentered, zoomed } from './views/followCamera';
import { clampSideZoom, CLOSE_SIDE_ZOOM, DEFAULT_SIDE_ZOOM, sideMetersPerPixel, sideZoomForMpp } from './views/sideCamera';
import { easeMpp, gatePhase, recall, remember, type PhaseZoom, type ZoomPhase } from './views/zoomGate';
import { NO_CALLOUTS, calloutSentence, gearPrompt, remainingOnAny, stepCallouts, stepSpeeds, takeoffMode, type CalloutState, type TakeoffHud } from './views/takeoffStrip';
import type { VSpeeds } from './sim/flight/vspeeds';
import { speedMarks } from './views/gauges/airspeed';
import { createSideView } from './views/sideView';
import { bestApproach, type ApproachGuide } from './views/approach';
import { routeFor } from './views/route';
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
import { AIR_START } from './sim/state';
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
// Each view remembers one zoom for the ground and one for the air (C4B). The wheel edits the current phase only;
// the gate (views/zoomGate.ts) picks the phase from height above ground, and the shown zoom eases toward it.
let topMem: PhaseZoom = { ground: CLOSE_ZOOM, air: DEFAULT_ZOOM };
let sideMem: PhaseZoom = { ground: CLOSE_SIDE_ZOOM, air: DEFAULT_SIDE_ZOOM };
let zoomPhase: ZoomPhase = 'ground';
let follow = initialFollow(recall(topMem, zoomPhase));
let cursor: Point | null = null;
let sideZoom = recall(sideMem, zoomPhase);
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
// Heading bug (degrees, clockwise from north): a view setting. It starts at the plane's heading.
let bugDeg = Math.round((pageStart.heading * 180) / Math.PI) % 360;
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
function syncAutopilotBugs(): void {
  const ap = loop.state.autopilot;
  if (!ap.on) return;
  const heading = (bugDeg * Math.PI) / 180;
  const z = bugWorldZ(altBugFt, scales);
  if (Math.abs(headingError(ap.headingTarget, heading)) > 1e-6 || Math.abs(ap.targetZ - z) > 1e-6) loop.send({ kind: 'apTarget', heading, z });
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
  const phase = gatePhase(zoomPhase, craft.onGround, agl);
  if (phase !== zoomPhase) {
    topMem = remember(topMem, zoomPhase, follow.free.zoom);
    sideMem = remember(sideMem, zoomPhase, sideZoom);
    zoomPhase = phase;
    follow = { ...follow, free: { ...follow.free, zoom: recall(topMem, phase) } };
    sideZoom = recall(sideMem, phase);
  }
  const topTarget = metersPerPixel(follow.free.zoom);
  const sideTarget = sideMetersPerPixel(sideZoom);
  shownTopMpp = loop.paused ? topTarget : easeMpp(shownTopMpp, topTarget, dt);
  shownSideMpp = loop.paused ? sideTarget : easeMpp(shownSideMpp, sideTarget, dt);
  shownTopZoom = shownTopMpp === topTarget ? follow.free.zoom : zoomForMpp(shownTopMpp);
  shownSideZoom = shownSideMpp === sideTarget ? sideZoom : sideZoomForMpp(shownSideMpp);

  const crashed = sim.crash !== null;
  guide = bestApproach(craft, agl, crashed, runways, world.heightAt);
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
    if (ap.on) loop.send({ kind: 'autopilot', on: false });
    else loop.send({ kind: 'autopilot', on: true, heading: (bugDeg * Math.PI) / 180, z: bugWorldZ(altBugFt, scales) });
    if (loop.paused) panels.instruments.requestDraw();
  },
  KeyX: () => {
    loop.send({ kind: 'autothrottle', on: !loop.state.autopilot.spd });
    if (loop.paused) panels.instruments.requestDraw();
  },
  Comma: (fine) => moveSpeedBug(-1, fine),
  Period: (fine) => moveSpeedBug(1, fine),
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
  const text = readoutSentence(shownReadout) + apSentence(loop.state.autopilot, loop.state.tick);
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
const currentPanel = (): PanelState => {
  const craft = currentCraft();
  const crashed = loop.state.crash !== null;
  const bugsShown = !crashed && takeoffHud === null && guide === null;
  return buildPanelState(craft, scales, loop.state.tuning, {
    stall: crashed ? 'none' : stallState(craft, loop.state.tuning),
    braking: loop.state.controls.brake,
    terr: !crashed && terrainAhead(craft, world.heightAt),
    autopilot: loop.state.autopilot,
    headingBugDeg: bugsShown ? bugDeg : null,
    altBugFt: bugsShown ? altBugFt : null,
    gearWarn: !crashed && gearWarning(craft, heightAboveGround(craft.z, world.heightAt(craft.x, craft.y)), indicatedSpeed(craft, scales)),
    crashed,
    speedMarks: takeoffHud?.marks,
    callout: takeoffHud?.callout ?? null,
    gearPrompt: gearPrompt(takeoffHud?.callout ?? null, craft.gearDown),
  });
};

topView.warm();
sideView.warm();

const panels = initPanels({
  instruments: (ctx, size) => {
    shownPanel = currentPanel();
    shownReadout = shownPanel.text;
    drawPanel(ctx, size, shownPanel);
  },
  top: (ctx, size) => {
    syncFrame();
    const craft = currentCraft();
    topView.draw(
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
      takeoffHud !== null,
      guide,
      routeFor(grid.airports, loop.state.start),
    );
  },
  side: (ctx, size) => {
    syncFrame();
    const changed = size.width !== sideSize.width || size.height !== sideSize.height;
    sideSize = { width: size.width, height: size.height };
    sideView.draw(ctx, sideSize, currentCraft(), shownSideZoom, sideCursor, loop.state.crash !== null, altBugFt, takeoffHud, guide, { on: loop.state.autopilot.on, notice: apNoticeText(loop.state.autopilot.notice, loop.state.tick) });
    // The top view marks exactly what this panel shows, so it follows our size.
    // Redraw only on a change, so the two panels cannot trigger each other forever.
    if (changed || !sideSized) {
      sideSized = true;
      requestTop();
    }
  },
});
requestTop = panels.top.requestDraw;
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
