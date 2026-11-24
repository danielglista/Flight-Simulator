import './styles.css';
import { initPanels } from './app/panels';
import { SCALES } from './config/scales';
import { attachMapPointer } from './input/mapPointer';
import { attachSidePointer } from './input/sidePointer';
import { worldHeight, worldWidth } from './sim/world/grid';
import { withAirports } from './sim/world/placeAirports';
import { buildTestAirport } from './sim/world/testAirport';
import { buildTestMap } from './sim/world/testMap';
import { DEFAULT_ZOOM, type Camera, type Point } from './views/camera';
import { moveProbe, START_PROBE, turnBy, type Probe } from './views/probe';
import { clampSideZoom, DEFAULT_SIDE_ZOOM } from './views/sideCamera';
import { createSideView } from './views/sideView';
import { createTopView } from './views/topView';

const grid = withAirports(buildTestMap(), [buildTestAirport(SCALES)]);
const bounds = { width: worldWidth(grid), height: worldHeight(grid) };
const topView = createTopView(grid, SCALES);
const sideView = createSideView(grid, SCALES);

let camera: Camera = { x: bounds.width / 2, y: bounds.height / 2, zoom: DEFAULT_ZOOM };
let cursor: Point | null = null;
let probe: Probe = START_PROBE;
let sideZoom = DEFAULT_SIDE_ZOOM;
let sideCursor: Point | null = null;
// Kept here, not read from `panels`, because the first draws run inside initPanels.
let sideSize = { width: 640, height: 360 };
let sideSized = false;
let requestTop: () => void = () => {};

const panels = initPanels({
  top: (ctx, size) =>
    topView.draw(ctx, size, camera, cursor, {
      probe,
      size: sideSize,
      zoom: sideZoom,
      hoverDistance: sideCursor ? sideView.distanceAt(sideSize, sideZoom, sideCursor.x) : null,
    }),
  side: (ctx, size) => {
    const changed = size.width !== sideSize.width || size.height !== sideSize.height;
    sideSize = { width: size.width, height: size.height };
    sideView.draw(ctx, sideSize, probe, sideZoom, sideCursor);
    // The top view marks exactly what this panel shows, so it follows our size.
    // Redraw only on a change, so the two panels cannot trigger each other forever.
    if (changed || !sideSized) {
      sideSized = true;
      requestTop();
    }
  },
});
requestTop = panels.top.requestDraw;

const redrawBoth = (): void => {
  panels.top.requestDraw();
  panels.side.requestDraw();
};

attachMapPointer({
  canvas: panels.top.canvas,
  getView: () => panels.top.size,
  bounds,
  getCamera: () => camera,
  setCamera: (c) => {
    camera = c;
    panels.top.requestDraw();
  },
  setCursor: (c) => {
    cursor = c;
    panels.top.requestDraw();
  },
  onClick: (w) => {
    probe = moveProbe(probe, w.x, w.y, bounds);
    redrawBoth();
  },
});

attachSidePointer({
  canvas: panels.side.canvas,
  onTurn: (r) => {
    probe = turnBy(probe, r);
    redrawBoth();
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
