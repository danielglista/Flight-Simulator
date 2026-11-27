import type { LandmarkDecor, MapLandmark } from '../../src/sim/world/mapFile';
import type { LandmarksFile } from './types';

/**
 * Turns the authored landmarks (real meters about a latitude and longitude) into game-frame world meters (E6). Each is a
 * stamp: only its center goes through the map warp, so it keeps its own shape. Plans shrink by the file's footprint
 * scale, heights by the building height scale.
 */
export function buildLandmarks(file: LandmarksFile, centerWorld: (lat: number, lon: number) => { readonly x: number; readonly y: number }, heightScale: number): MapLandmark[] {
  const k = file.footprintScale;
  return file.landmarks.map((l) => {
    const c = centerWorld(l.lat, l.lon);
    const turn = l.turn ?? 0;
    const at = turner(turn);
    /** A position in the landmark's own frame, real m, as world m. */
    const place = (px: number, py: number): [number, number] => {
      const [rx, ry] = at(px, py);
      return [round(c.x + rx / k), round(c.y + ry / k)];
    };
    const xy = (px: number, py: number): { x: number; y: number } => {
      const [x, y] = place(px, py);
      return { x, y };
    };
    const pairs = (points: readonly number[]): number[] => points.flatMap((v, i) => (i % 2 === 0 ? place(v, points[i + 1] as number) : []));
    const decor = l.decor.map((d): LandmarkDecor =>
      d.kind === 'line'
        ? { kind: 'line', material: d.material, width: round(d.width / k), points: pairs(d.points) }
        : d.kind === 'ring'
          ? { kind: 'ring', material: d.material, ...xy(d.x, d.y), radius: round(d.radius / k), width: round(d.width / k) }
          : d.kind === 'rect'
            ? { kind: 'rect', material: d.material, ...xy(d.x, d.y), width: round(d.w / k), depth: round(d.d / k), ...(turn ? { turn } : {}) }
            : { kind: 'disc', material: d.material, ...xy(d.x, d.y), radius: round(d.radius / k) },
    );
    return {
      id: l.id,
      ...xy(0, 0),
      solids: l.solids.map((s) => ({
        ...xy(s.x, s.y),
        width: round(s.w / k),
        depth: round(s.d / k),
        topWidth: round(s.topW / k),
        topDepth: round(s.topD / k),
        bottom: round(s.bottom / heightScale),
        top: round(s.top / heightScale),
        material: s.material,
        ...(s.shape ? { shape: s.shape } : {}),
        // Turning keeps corners counterclockwise; round solids look the same turned.
        ...(s.points ? { points: pairs(s.points) } : {}),
        ...(turn && !s.shape ? { turn } : {}),
        ...(s.cap ? { cap: s.cap } : {}),
        ...(s.base ? { base: true } : {}),
        ...(s.columns ? { columns: round(s.columns / k) } : {}),
      })),
      decor,
      ...(l.wires
        ? {
            wires: l.wires.map((w) => ({
              material: w.material,
              points: w.points.flatMap((v, i) => (i % 3 === 0 ? [...place(v, w.points[i + 1] as number), round((w.points[i + 2] as number) / heightScale)] : [])),
            })),
          }
        : {}),
      ...(l.posts ? { posts: { ...xy(l.posts.x, l.posts.y), radius: round(l.posts.radius / k), count: l.posts.count, height: round(l.posts.height / heightScale) } } : {}),
    };
  });
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** Turns an offset the given degrees clockwise. */
function turner(degrees: number): (x: number, y: number) => [number, number] {
  const a = (degrees * Math.PI) / 180;
  return (x, y) => [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)];
}

/** Is the point inside the ground a landmark keeps clear of ordinary buildings? */
export function landmarkClear(file: LandmarksFile, landmarks: readonly MapLandmark[]): (x: number, y: number) => boolean {
  const k = file.footprintScale;
  const circles = landmarks.flatMap((l, i) => {
    const spec = file.landmarks[i];
    const at = turner(spec?.turn ?? 0);
    const more = (spec?.clearAlso ?? []).map(([px, py, r]) => {
      const [rx, ry] = at(px, py);
      return { x: l.x + rx / k, y: l.y + ry / k, r: r / k };
    });
    return [{ x: l.x, y: l.y, r: (spec?.clearRadiusM ?? 0) / k }, ...more];
  });
  return (x, y) => circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
}
