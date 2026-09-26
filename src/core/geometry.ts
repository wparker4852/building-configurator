// Turns a BuildingConfig into concrete geometry: the roof cross-section, wall
// outlines with their openings punched out, roof planes, and support posts.
//
// Everything here is plain math with no three.js dependency so it can be unit
// tested, run on a server for PDF/CAD output, or reused by another renderer.

import type {
  BuildingConfig,
  Catalog,
  Opening,
  OpeningType,
  RoofStyleOption,
  WallId,
} from './types';
import { WALL_IDS } from './types';

export interface Pt {
  x: number;
  y: number;
}

export interface HoleRect {
  opening: Opening;
  type: OpeningType;
  /** Wall-local x of the opening's center. */
  cx: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface WallSpec {
  id: WallId;
  label: string;
  /** Length of the wall in feet. */
  length: number;
  /** Outline polygon in wall-local coordinates, x in [-length/2, length/2], y up from 0. */
  outline: Pt[];
  rotationY: number;
  position: [number, number, number];
  holes: HoleRect[];
  grossArea: number;
  netArea: number;
  /** False when the current enclosure leaves this side open. */
  present: boolean;
  /** Height at the left edge / right edge, for UI hints. */
  minHeight: number;
  maxHeight: number;
}

export interface RoofPlane {
  key: string;
  position: [number, number, number];
  /** Rotation about Z, i.e. the slope angle. */
  rotationZ: number;
  /** Size along the slope, including any eave overhang. */
  slopeLength: number;
  /** Size along the ridge, including any gable overhang. */
  runLength: number;
  area: number;
}

/** One length of square tubing in the frame. */
export interface TubeMember {
  position: [number, number, number];
  /** Euler XYZ. Bow segments rotate about Z by their slope. */
  rotation: [number, number, number];
  size: [number, number, number];
}

export interface BuildingGeometry {
  /** Sharp-cornered roof line; the frame bows follow this. */
  baseProfile: Pt[];
  /** The roof line as built, rounded for a regular roof. */
  profile: Pt[];
  walls: WallSpec[];
  roofPlanes: RoofPlane[];
  frame: TubeMember[];
  eaves: { left: number; right: number };
  rounded: boolean;
  metrics: Metrics;
}

export interface Metrics {
  footprint: number;
  perimeter: number;
  /** Wall area of built walls, openings deducted. */
  wallArea: number;
  /** Wall area before deducting openings. */
  wallAreaGross: number;
  roofArea: number;
  peakHeight: number;
  /** Sum of every opening's rough area. */
  openingArea: number;
}

const WALL_LABELS: Record<WallId, string> = {
  front: 'Front (gable end)',
  back: 'Back (gable end)',
  left: 'Left side',
  right: 'Right side',
};

/** Which walls are actually built for a given enclosure. */
export function wallsPresent(cfg: BuildingConfig): Record<WallId, boolean> {
  if (cfg.enclosure === 'enclosed') {
    return { front: true, back: true, left: true, right: true };
  }
  if (cfg.enclosure === 'partial') {
    // Open on the front gable end, closed on the other three sides.
    return { front: false, back: true, left: true, right: true };
  }
  return { front: false, back: false, left: false, right: false };
}

/** Length in feet of a given wall. */
export function wallLength(cfg: BuildingConfig, wall: WallId): number {
  return wall === 'front' || wall === 'back' ? cfg.width : cfg.length;
}

// ── Profile rounding ─────────────────────────────────────────────────────────

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
function unit(a: Pt): Pt {
  const len = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / len, y: a.y / len };
}

/** Quadratic Bezier from p0 to p2 with control p1, inclusive of both ends. */
function bezier(p0: Pt, p1: Pt, p2: Pt, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const m = 1 - t;
    out.push({
      x: m * m * p0.x + 2 * m * t * p1.x + t * t * p2.x,
      y: m * m * p0.y + 2 * m * t * p1.y + t * t * p2.y,
    });
  }
  return out;
}

/**
 * Round the corners of a roof profile — a "regular" roof curves over at the
 * ridge and curls down at the eaves instead of meeting in hard corners.
 *
 * The eave curl is added OUTSIDE the footprint: the profile still passes
 * through the eave point at exactly the nominal eave height, then continues
 * past it and bends down, the way a rolled panel hangs over the leg line.
 * Curling inward instead would drop the roof below the legs standing under it.
 */
export function roundProfile(points: Pt[], radius: number, curlEaves = true): Pt[] {
  if (points.length < 2 || radius <= 0.01) return points;

  // Never let a fillet eat more than 40% of its shortest neighbouring run.
  let shortest = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    shortest = Math.min(shortest, Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y));
  }
  const d = Math.min(radius, shortest * 0.4);

  const out: Pt[] = [];
  const n = points.length;

  const first = points[0];
  if (curlEaves) {
    // Run the slope out past the eave, then bend straight down.
    const outward = scale(unit(sub(points[1], first)), -d);
    const knee = add(first, outward);
    out.push(...bezier({ x: knee.x, y: knee.y - d }, knee, first, 5));
  } else {
    out.push(first);
  }

  for (let i = 1; i < n - 1; i++) {
    const v = points[i];
    const uIn = unit(sub(v, points[i - 1]));
    const uOut = unit(sub(points[i + 1], v));
    out.push(...bezier(sub(v, scale(uIn, d)), v, add(v, scale(uOut, d)), 5));
  }

  const last = points[n - 1];
  if (curlEaves) {
    const knee = add(last, scale(unit(sub(last, points[n - 2])), d));
    out.push(...bezier(last, knee, { x: knee.x, y: knee.y - d }, 5));
  } else {
    out.push(last);
  }

  // Drop duplicate points where fillets meet.
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y) > 1e-4);
}

/**
 * The roof cross-section, left (-X) to right (+X), in world X/Y.
 * The first and last points sit on top of the side walls.
 * This is the sharp-cornered form; see `roundProfile` for regular roofs.
 */
export function roofProfile(cfg: BuildingConfig, style: RoofStyleOption | undefined): Pt[] {
  const halfW = cfg.width / 2;
  const eave = cfg.eaveHeight;
  const slope = cfg.pitch / 12;

  if (cfg.roofStyle === 'single-slope') {
    // High side on the left, draining toward +X.
    return [
      { x: -halfW, y: eave + cfg.width * slope },
      { x: halfW, y: eave },
    ];
  }

  if (cfg.roofStyle === 'gambrel') {
    const p = style?.params ?? { breakFraction: 0.5, lowerPitch: 24 };
    const breakX = halfW * p.breakFraction;
    const haunchY = eave + (halfW - breakX) * (p.lowerPitch / 12);
    const peakY = haunchY + breakX * slope;
    return [
      { x: -halfW, y: eave },
      { x: -breakX, y: haunchY },
      { x: 0, y: peakY },
      { x: breakX, y: haunchY },
      { x: halfW, y: eave },
    ];
  }

  return [
    { x: -halfW, y: eave },
    { x: 0, y: eave + halfW * slope },
    { x: halfW, y: eave },
  ];
}

/**
 * Nominal wall height at each side, before any eave rounding.
 * Rounding dips the profile below this, but the walls, posts and frame legs
 * still stop at the true eave.
 */
export function eaveHeights(cfg: BuildingConfig): { left: number; right: number } {
  if (cfg.roofStyle === 'single-slope') {
    return { left: cfg.eaveHeight + cfg.width * (cfg.pitch / 12), right: cfg.eaveHeight };
  }
  return { left: cfg.eaveHeight, right: cfg.eaveHeight };
}

/** Height of the roof line at a given world X. */
export function profileHeightAt(profile: Pt[], x: number): number {
  const first = profile[0];
  const last = profile[profile.length - 1];
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

/** Shoelace area of a closed polygon. */
export function polygonArea(pts: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Wall-local x of an opening's center.
 * `offset` is measured from the wall's left edge as seen from outside.
 */
export function openingCenterX(offset: number, width: number, wallLen: number): number {
  return offset + width / 2 - wallLen / 2;
}

/**
 * The size an opening is actually built at. Resizable types (framed openings)
 * carry their own dimensions; everything else takes the catalog's.
 */
export function openingSize(op: Opening, type: OpeningType): { width: number; height: number } {
  if (!type.resizable) return { width: type.width, height: type.height };
  return { width: op.width ?? type.width, height: op.height ?? type.height };
}

/** Highest point an opening spanning [x0, x1] could reach on this wall. */
export function headroomAt(outlineTop: Pt[], x0: number, x1: number): number {
  // Sample the top edge across the span and take the lowest point.
  const steps = 12;
  let min = Infinity;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    min = Math.min(min, profileHeightAt(outlineTop, x));
  }
  return min;
}

/**
 * Top edge of a wall in wall-local coordinates.
 * Endwalls follow the roof profile; sidewalls are flat at their eave height.
 */
export function wallTopEdge(cfg: BuildingConfig, wall: WallId, profile: Pt[]): Pt[] {
  if (wall === 'front') {
    // Local x equals world x for the front wall.
    return profile.map((p) => ({ ...p }));
  }
  if (wall === 'back') {
    // Local x is mirrored relative to world x.
    return profile.map((p) => ({ x: -p.x, y: p.y })).reverse();
  }
  const eaves = eaveHeights(cfg);
  const h = wall === 'left' ? eaves.left : eaves.right;
  const half = cfg.length / 2;
  return [
    { x: -half, y: h },
    { x: half, y: h },
  ];
}

function buildWall(
  cfg: BuildingConfig,
  catalog: Catalog,
  wall: WallId,
  profile: Pt[],
  present: boolean,
): WallSpec {
  const len = wallLength(cfg, wall);
  const half = len / 2;
  const t = catalog.rules.wallThickness;
  const top = wallTopEdge(cfg, wall, profile);

  // Outline runs counter-clockwise: along the bottom, then back along the top.
  const outline: Pt[] = [{ x: -half, y: 0 }, { x: half, y: 0 }, ...top.slice().reverse()];

  const holes: HoleRect[] = [];
  for (const op of cfg.openings) {
    if (op.wall !== wall) continue;
    const type = catalog.openingTypes.find((o) => o.id === op.catalogId);
    if (!type) continue;
    const { width, height } = openingSize(op, type);
    const cx = openingCenterX(op.offset, width, len);
    holes.push({
      opening: op,
      type,
      cx,
      x0: cx - width / 2,
      x1: cx + width / 2,
      y0: op.sill,
      y1: op.sill + height,
    });
  }

  const grossArea = polygonArea(outline);
  const holeArea = holes.reduce((s, h) => s + (h.x1 - h.x0) * (h.y1 - h.y0), 0);

  let rotationY = 0;
  let position: [number, number, number] = [0, 0, 0];
  const halfW = cfg.width / 2;
  const halfL = cfg.length / 2;
  switch (wall) {
    case 'front':
      rotationY = 0;
      position = [0, 0, halfL - t];
      break;
    case 'back':
      rotationY = Math.PI;
      position = [0, 0, -halfL + t];
      break;
    case 'right':
      rotationY = Math.PI / 2;
      position = [halfW - t, 0, 0];
      break;
    case 'left':
      rotationY = -Math.PI / 2;
      position = [-halfW + t, 0, 0];
      break;
  }

  const tops = top.map((p) => p.y);
  return {
    id: wall,
    label: WALL_LABELS[wall],
    length: len,
    outline,
    rotationY,
    position,
    holes,
    grossArea,
    netArea: Math.max(0, grossArea - holeArea),
    present,
    minHeight: Math.min(...tops),
    maxHeight: Math.max(...tops),
  };
}

function buildRoof(cfg: BuildingConfig, catalog: Catalog, profile: Pt[], rounded: boolean): RoofPlane[] {
  const t = catalog.rules.roofThickness;
  const runLength = cfg.length + 2 * cfg.gableOverhang;
  const planes: RoofPlane[] = [];
  // A rounded roof terminates in the curve itself; there is no flat eave to
  // project past the wall.
  const overhang = rounded ? 0 : cfg.eaveOverhang;

  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const angle = Math.atan2(dy, dx);
    const ux = dx / len;
    const uy = dy / len;
    // Guard against the near-vertical tail of a rounded eave.
    const cos = Math.max(0.25, Math.abs(Math.cos(angle)));
    // Only the outermost segments carry the eave overhang.
    const startExt = i === 0 ? overhang / cos : 0;
    const endExt = i === profile.length - 2 ? overhang / cos : 0;
    const total = len + startExt + endExt;

    const ax = a.x - ux * startExt;
    const ay = a.y - uy * startExt;
    const bx = b.x + ux * endExt;
    const by = b.y + uy * endExt;

    // Nudge the slab up by half its thickness so its underside lands on the profile.
    const px = -Math.sin(angle);
    const py = Math.cos(angle);

    planes.push({
      key: `roof-${i}`,
      position: [(ax + bx) / 2 + (px * t) / 2, (ay + by) / 2 + (py * t) / 2, 0],
      rotationZ: angle,
      slopeLength: total,
      runLength,
      area: total * runLength,
    });
  }
  return planes;
}

/**
 * The tube-steel frame: a bent at every leg position along the length, plus
 * the rails and purlins that tie them together. This is the actual structure
 * of the building, and on an open carport it is most of what you see.
 */
function buildFrame(cfg: BuildingConfig, catalog: Catalog, bowProfile: Pt[], purlins: boolean): TubeMember[] {
  const { tubeSize: tube, wallThickness: wt } = catalog.rules;
  const members: TubeMember[] = [];
  const halfL = cfg.length / 2;
  // Pull the frame inboard so the panels, which hang on its outside, are the
  // outermost surface.
  const inset = wt + tube / 2;
  const legX = cfg.width / 2 - inset;

  // The roof panel rides on top of the bow, so the underside of the bow — and
  // therefore the top of every leg — is one tube below the profile line.
  const bowUnderside = (x: number) => profileHeightAt(bowProfile, x) - tube;
  const legTop = { left: bowUnderside(-legX), right: bowUnderside(legX) };

  const bentCount = Math.max(2, Math.round(cfg.length / cfg.onCenter) + 1);
  // The end bents sit behind the endwall panels, not in their plane.
  const zSpan = cfg.length - 2 * wt;

  for (let i = 0; i < bentCount; i++) {
    const z = -halfL + wt + (zSpan * i) / (bentCount - 1);

    // Legs, stopping cleanly under the bow rather than at the nominal eave.
    for (const side of [-1, 1] as const) {
      const h = side < 0 ? legTop.left : legTop.right;
      members.push({
        position: [side * legX, h / 2, z],
        rotation: [0, 0, 0],
        size: [tube, h, tube],
      });
    }

    // Bow: one tube per straight run of the roof profile, tucked under the panels.
    for (let s = 0; s < bowProfile.length - 1; s++) {
      const a = bowProfile[s];
      const b = bowProfile[s + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const angle = Math.atan2(dy, dx);
      // Offset perpendicular, below the roof line.
      const px = -Math.sin(angle) * (tube / 2);
      const py = Math.cos(angle) * (tube / 2);
      members.push({
        position: [(a.x + b.x) / 2 - px, (a.y + b.y) / 2 - py, z],
        rotation: [0, 0, angle],
        size: [len, tube, tube],
      });
    }

    // Knee brace: a real triangle with BOTH ends landing on steel — low end on
    // the leg, high end on the underside of the bow inboard of the corner.
    const reach = Math.min(1.8, Math.min(legTop.left, legTop.right) * 0.32);
    if (reach > 0.6) {
      for (const side of [-1, 1] as const) {
        const xLeg = side * legX;
        const xBow = xLeg - side * reach;
        const foot = { x: xLeg, y: (side < 0 ? legTop.left : legTop.right) - reach };
        const head = { x: xBow, y: bowUnderside(xBow) };
        const dx = head.x - foot.x;
        const dy = head.y - foot.y;
        members.push({
          position: [(foot.x + head.x) / 2, (foot.y + head.y) / 2, z],
          rotation: [0, 0, Math.atan2(dy, dx)],
          size: [Math.hypot(dx, dy), tube * 0.8, tube * 0.8],
        });
      }
    }
  }

  // Base rails tying the leg feet together down each side.
  for (const side of [-1, 1] as const) {
    members.push({
      position: [side * legX, tube / 2, 0],
      rotation: [0, 0, 0],
      size: [tube, tube, zSpan],
    });
  }

  // Hat channel under a vertical roof, running the length at intervals up the slope.
  if (purlins) {
    const step = 2.5;
    for (let s = 0; s < bowProfile.length - 1; s++) {
      const a = bowProfile[s];
      const b = bowProfile[s + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(1, Math.floor(len / step));
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      for (let k = 1; k <= count; k++) {
        const t = k / (count + 1);
        const px = -Math.sin(angle) * tube;
        const py = Math.cos(angle) * tube;
        members.push({
          position: [a.x + (b.x - a.x) * t - px, a.y + (b.y - a.y) * t - py, 0],
          rotation: [0, 0, 0],
          size: [tube * 0.8, tube * 0.55, zSpan],
        });
      }
    }
  }

  return members;
}

/** Build the full geometry for a configuration. */
export function buildGeometry(cfg: BuildingConfig, catalog: Catalog): BuildingGeometry {
  const style = catalog.roofStyles.find((r) => r.id === cfg.roofStyle);
  const build = catalog.roofBuilds.find((b) => b.id === cfg.roofBuild);
  const rounded = build?.rounded ?? false;

  const baseProfile = roofProfile(cfg, style);
  const radius = catalog.rules.eaveRoundRadius;
  // The roof panel curves down over the OUTSIDE of the wall at the eaves, so
  // the wall itself keeps its square corner there and only follows the ridge.
  const profile = rounded ? roundProfile(baseProfile, radius, true) : baseProfile;
  const wallProfile = rounded ? roundProfile(baseProfile, radius, false) : baseProfile;
  const present = wallsPresent(cfg);

  const walls = WALL_IDS.map((w) => buildWall(cfg, catalog, w, wallProfile, present[w]));
  const roofPlanes = buildRoof(cfg, catalog, profile, rounded);
  // The bow is the member the panel is bent around, so it follows the built
  // roof line, curl included — not the sharp-cornered form.
  const frame = buildFrame(cfg, catalog, profile, build?.purlins ?? false);

  const built = walls.filter((w) => w.present);
  const metrics: Metrics = {
    footprint: cfg.width * cfg.length,
    perimeter: 2 * (cfg.width + cfg.length),
    wallArea: built.reduce((s, w) => s + w.netArea, 0),
    wallAreaGross: built.reduce((s, w) => s + w.grossArea, 0),
    roofArea: roofPlanes.reduce((s, p) => s + p.area, 0),
    // Quote the true ridge height, not the point the rounded panel passes through.
    peakHeight: Math.max(...baseProfile.map((p) => p.y)),
    openingArea: walls.reduce(
      (s, w) => s + w.holes.reduce((hs, h) => hs + (h.x1 - h.x0) * (h.y1 - h.y0), 0),
      0,
    ),
  };

  return { baseProfile, profile, walls, roofPlanes, frame, eaves: eaveHeights(cfg), rounded, metrics };
}
