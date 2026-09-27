// Turns a BuildingConfig into concrete geometry: the roof cross-section, wall
// outlines with their openings punched out, roof planes, and support posts.
//
// Everything here is plain math with no three.js dependency so it can be unit
// tested, run on a server for PDF/CAD output, or reused by another renderer.

import type {
  BuildingConfig,
  Catalog,
  LegStyle,
  Opening,
  OpeningType,
  RoofStyleOption,
  WallId,
} from './types';
import { WALL_IDS } from './types';
import { getSupplier } from './suppliers';

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

/** What a frame member is, for a cut list and for anyone reading the frame. */
export type MemberKind =
  | 'leg' | 'bow' | 'base-rail' | 'eave-rail' | 'knee-brace' | 'peak-brace'
  | 'bottom-chord' | 'chord-strut' | 'hat-channel' | 'endwall-stud' | 'ladder-rung';

/** One length of square tubing in the frame. */
export interface TubeMember {
  kind: MemberKind;
  position: [number, number, number];
  /** Euler XYZ. Bow segments rotate about Z by their slope. */
  rotation: [number, number, number];
  size: [number, number, number];
  /** Part of the leg upgrade the book charges for: second leg, its base rail, rungs. */
  upgrade?: boolean;
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
  /** Leg construction the supplier specifies at this size. */
  legStyle: LegStyle;
  /** Outside dimension of the frame tube for the chosen gauge. */
  tube: number;
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
  /** Inside face to inside face of the innermost legs — what a vehicle has to fit through. */
  clearWidth: number;
  /** Inside face to inside face of the end bents. */
  clearLength: number;
  /** Headroom under the lowest member on the centerline (peak brace or bottom chord). */
  clearHeight: number;
  /** Headroom at the sidewall, under the bow at the leg. */
  sideClearHeight: number;
}

/**
 * Fixed dimensions of the tube-steel system, per the Walker Buildings frame
 * spec. These are fabrication facts, not prices, so they live here rather than
 * in the catalog.
 */
export const FRAME_SPEC = {
  /** Clear gap between the two legs of a ladder leg. */
  ladderGap: 7 / 12,
  /** Drawn gap between the welded pair of a double leg, so it reads as two tubes. */
  doubleLegReveal: 0.5 / 12,
  /** Ladder rungs, on center, starting one spacing above the base rail. */
  ladderRungSpacing: 20 / 12,
  /** Hat channel: 3" wide, 1⅛" tall. First run 1' down the slope from the ridge, then every 4'. */
  hatChannel: { width: 3 / 12, height: 1.125 / 12, firstFromRidge: 1, spacing: 4 },
  /** Radius of the bend at the apex of a squared bow, in tube widths. */
  apexBendTubes: 2,
  /** Endwall studs are set at most this far apart, evenly spaced. */
  endwallStudSpacing: 5,
} as const;

/** Peak brace length on a narrow gable: 2' to 18' wide, 4' to 20', 6' beyond. */
export function peakBraceLength(width: number): number {
  return width <= 18 ? 2 : width <= 20 ? 4 : 6;
}

/** Widths from which a bottom chord replaces the peak brace. */
export const BOTTOM_CHORD_FROM_WIDTH = 25;

/**
 * Bottom chord length: 16' at 25–26' wide, 18' at 27–28', 20' at 29–30' — the
 * width rounded up to even, less 10'. The spec stops at 30'; wider clear spans
 * continue the same rule.
 */
export function bottomChordLength(width: number): number {
  return 2 * Math.ceil(width / 2) - 10;
}

/** Knee brace (leg to bow, 45°): 3' on legs under 8', 4' otherwise. */
export function kneeBraceLength(legHeight: number): number {
  return legHeight < 8 ? 3 : 4;
}

const WALL_LABELS: Record<WallId, string> = {
  front: 'Front (gable end)',
  back: 'Back (gable end)',
  left: 'Left side',
  right: 'Right side',
};

/**
 * Which walls are actually built. Read from the same two fields the price book
 * charges for — sides as a pair, each gable end on its own — so what is drawn
 * is always what is priced. A single closed end is the back one.
 */
export function wallsPresent(cfg: BuildingConfig): Record<WallId, boolean> {
  return {
    front: cfg.endsClosed >= 2,
    back: cfg.endsClosed >= 1,
    left: cfg.sidesClosed,
    right: cfg.sidesClosed,
  };
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

/** A span along one axis, [from, to], in world feet. */
type Span = [number, number];

/**
 * Split a run from `a` to `b` around the given cuts, dropping any piece too
 * short to be a real length of tube. Base rails are cut out at every door.
 */
function splitRun(a: number, b: number, cuts: Span[], minLen: number): Span[] {
  const sorted = cuts
    .map(([c0, c1]) => [Math.max(a, Math.min(c0, c1)), Math.min(b, Math.max(c0, c1))] as Span)
    .filter(([c0, c1]) => c1 > c0)
    .sort((p, q) => p[0] - q[0]);
  const out: Span[] = [];
  let cursor = a;
  for (const [c0, c1] of sorted) {
    if (c0 > cursor) out.push([cursor, c0]);
    cursor = Math.max(cursor, c1);
  }
  if (b > cursor) out.push([cursor, b]);
  return out.filter(([s0, s1]) => s1 - s0 >= minLen);
}

interface WorldHole {
  span: Span;
  y0: number;
  y1: number;
}

/**
 * Where each built wall's openings fall in world coordinates: along X for the
 * gable ends, along Z for the sides. Wall-local x maps to world as:
 *   front  x -> x     back  x -> -x     right  x -> -z     left  x -> z
 */
function worldOpenings(walls: WallSpec[]) {
  const ends: Record<'front' | 'back', WorldHole[]> = { front: [], back: [] };
  const sides: Record<'left' | 'right', WorldHole[]> = { left: [], right: [] };
  for (const wall of walls) {
    if (!wall.present) continue;
    for (const h of wall.holes) {
      const at = (span: Span): WorldHole => ({ span, y0: h.y0, y1: h.y1 });
      if (wall.id === 'front') ends.front.push(at([h.x0, h.x1]));
      else if (wall.id === 'back') ends.back.push(at([-h.x1, -h.x0]));
      else if (wall.id === 'right') sides.right.push(at([-h.x1, -h.x0]));
      else sides.left.push(at([h.x0, h.x1]));
    }
  }
  return { ends, sides };
}

interface FrameResult {
  members: TubeMember[];
  clearWidth: number;
  clearLength: number;
  clearHeight: number;
  sideClearHeight: number;
}

/**
 * The tube-steel frame: a bent at every leg position along the length, plus
 * the rails, braces and purlins that tie them together. This is the actual
 * structure of the building, and on an open carport it is most of what you see.
 *
 * Member sizes, spacings and bracing rules follow the Walker Buildings frame
 * spec (see FRAME_SPEC); which leg construction to draw comes from the
 * supplier's book, so the frame on screen is the one being priced.
 */
function buildFrame(
  cfg: BuildingConfig,
  catalog: Catalog,
  opts: {
    /** The line the bow is bent to, curl and apex bend included. */
    bowPath: Pt[];
    baseProfile: Pt[];
    purlins: boolean;
    rounded: boolean;
    legStyle: LegStyle;
    tube: number;
    walls: WallSpec[];
  },
): FrameResult {
  const { bowPath, baseProfile, purlins, rounded, legStyle, tube, walls } = opts;
  const wt = catalog.rules.wallThickness;
  const members: TubeMember[] = [];
  const halfL = cfg.length / 2;
  const present = wallsPresent(cfg);
  const { ends: endHoles, sides: sideHoles } = worldOpenings(walls);

  // Pull the frame inboard so the panels, which hang on its outside, are the
  // outermost surface.
  const inset = wt + tube / 2;
  const legX = cfg.width / 2 - inset;

  // The roof panel rides on top of the bow, so the underside of the bow — and
  // therefore the top of every leg — is one tube below the path line.
  const bowUnderside = (x: number) => profileHeightAt(bowPath, x) - tube;

  // The second leg of a double or ladder leg sits inboard of the first: a
  // double is a welded pair (drawn with a ½" reveal so the two tubes read as
  // two), a ladder has a 7" gap.
  const innerOffset =
    legStyle === 'double' ? tube + FRAME_SPEC.doubleLegReveal : legStyle === 'ladder' ? tube + FRAME_SPEC.ladderGap : 0;
  const legLines = innerOffset > 0 ? [legX, legX - innerOffset] : [legX];
  const innerLegX = legLines[legLines.length - 1];

  const bentCount = Math.max(2, Math.round(cfg.length / cfg.onCenter) + 1);
  // The end bents sit behind the endwall panels, not in their plane.
  const zSpan = cfg.length - 2 * wt;
  const bentZ = Array.from({ length: bentCount }, (_, i) => -halfL + wt + (zSpan * i) / (bentCount - 1));
  const endZ = { back: bentZ[0], front: bentZ[bentZ.length - 1] };

  // While set, members are flagged as part of the leg upgrade (the second leg,
  // its base rail, ladder rungs) so the viewer can pick them out.
  let upgrading = false;
  const add = (m: TubeMember) => members.push(upgrading ? { ...m, upgrade: true } : m);

  /** A straight tube in the plane of a bent, from a to b. */
  const straight = (kind: MemberKind, a: Pt, b: Pt, z: number, thick = tube) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    add({
      kind,
      position: [(a.x + b.x) / 2, (a.y + b.y) / 2, z],
      rotation: [0, 0, Math.atan2(dy, dx)],
      size: [len, thick, thick],
    });
  };
  const alongZ = (kind: MemberKind, x: number, y: number, z0: number, z1: number) => {
    add({ kind, position: [x, y, (z0 + z1) / 2], rotation: [0, 0, 0], size: [tube, tube, z1 - z0] });
  };
  /** A vertical member from y0 to y1, broken around any opening it would pass through. */
  const upright = (kind: MemberKind, x: number, z: number, y0: number, y1: number, holes: WorldHole[]) => {
    const gaps: Span[] = holes.map((h) => [h.y0 - tube, h.y1 + tube]);
    for (const [s0, s1] of splitRun(y0, y1, gaps, tube)) {
      add({ kind, position: [x, (s0 + s1) / 2, z], rotation: [0, 0, 0], size: [tube, s1 - s0, tube] });
    }
  };
  /** Openings in the built side wall at `side` whose span takes in world z. */
  const sideHolesAt = (side: -1 | 1, z: number) =>
    present[side < 0 ? 'left' : 'right']
      ? (side < 0 ? sideHoles.left : sideHoles.right).filter((h) => z > h.span[0] - tube && z < h.span[1] + tube)
      : [];

  const isGable = baseProfile.length === 3;

  // ── Bents ────────────────────────────────────────────────────────────────
  bentZ.forEach((z, i) => {
    const isEnd = i === 0 || i === bentZ.length - 1;

    for (const side of [-1, 1] as const) {
      // Legs, stopping cleanly under the bow rather than at the nominal eave.
      // A leg that lands in a sidewall opening is cut out there; the header
      // of the frame-out carries what is left above it.
      const holes = sideHolesAt(side, z);
      legLines.forEach((lx, k) => {
        upgrading = k > 0;
        upright('leg', side * lx, z, 0, bowUnderside(side * lx), holes);
      });

      // Ladder rungs welded across the pair.
      if (legStyle === 'ladder') {
        const top = bowUnderside(side * innerLegX) - FRAME_SPEC.ladderRungSpacing / 2;
        for (let y = tube + FRAME_SPEC.ladderRungSpacing; y <= top; y += FRAME_SPEC.ladderRungSpacing) {
          if (holes.some((h) => y > h.y0 - tube && y < h.y1 + tube)) continue;
          straight('ladder-rung', { x: side * legX, y }, { x: side * innerLegX, y }, z);
        }
      }
      upgrading = false;
    }

    // Bow: one tube per straight run of the bent path, tucked under the panels.
    for (let s = 0; s < bowPath.length - 1; s++) {
      const a = bowPath[s];
      const b = bowPath[s + 1];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      // Offset perpendicular, below the roof line.
      const px = -Math.sin(angle) * (tube / 2);
      const py = Math.cos(angle) * (tube / 2);
      straight('bow', { x: a.x - px, y: a.y - py }, { x: b.x - px, y: b.y - py }, z);
    }

    // Knee brace at 45° from the inboard leg up to the bow. An end bent with
    // its endwall closed is braced by the endwall studs instead.
    const endClosed = isEnd && (i === 0 ? present.back : present.front);
    if (!endClosed) {
      for (const side of [-1, 1] as const) {
        const face = side * (innerLegX - tube / 2);
        const top = bowUnderside(side * innerLegX);
        const reach = Math.min(kneeBraceLength(cfg.eaveHeight) / Math.SQRT2, top * 0.4, innerLegX * 0.45);
        if (reach < 0.6) continue;
        const headX = face - side * reach;
        straight('knee-brace', { x: face, y: top - reach }, { x: headX, y: bowUnderside(headX) }, z, tube * 0.9);
      }
    }

    // Peak bracing, on the interior bents of a gable. Narrow buildings get a
    // short brace under the apex; from 25' wide, a bottom chord on two struts.
    if (!isGable || isEnd) return;
    if (cfg.width < BOTTOM_CHORD_FROM_WIDTH) {
      const len = Math.min(peakBraceLength(cfg.width), innerLegX);
      const y = bowUnderside(len / 2) - tube / 2;
      straight('peak-brace', { x: -len / 2, y }, { x: len / 2, y }, z);
    } else {
      const half = Math.min(bottomChordLength(cfg.width), 2 * innerLegX - 2) / 2;
      // Set the chord so its ends land on the underside of the bow, which
      // keeps it inside the roof at every pitch.
      const top = bowUnderside(half);
      straight('bottom-chord', { x: -half, y: top - tube / 2 }, { x: half, y: top - tube / 2 }, z);
      for (const sx of [-half / 2, half / 2]) {
        straight('chord-strut', { x: sx, y: top }, { x: sx, y: bowUnderside(sx) }, z);
      }
    }
  });

  // ── Rails and purlins running the length ─────────────────────────────────
  const zFrom = endZ.back - tube / 2;
  const zTo = endZ.front + tube / 2;
  for (const side of [-1, 1] as const) {
    // Base rails are cut out where a door comes down to the floor.
    const doors = present[side < 0 ? 'left' : 'right']
      ? (side < 0 ? sideHoles.left : sideHoles.right).filter((h) => h.y0 < 0.05).map((h) => h.span)
      : [];
    legLines.forEach((lx, k) => {
      upgrading = k > 0;
      for (const [z0, z1] of splitRun(zFrom, zTo, doors, tube)) alongZ('base-rail', side * lx, tube / 2, z0, z1);
    });
    upgrading = false;
    // Squared eaves carry an eave rail along the leg tops — it is what the
    // boxed eave trim wraps and what vertical panels fasten to at the bottom.
    if (!rounded) alongZ('eave-rail', side * legX, bowUnderside(side * legX) - tube / 2, zFrom, zTo);
  }

  // Hat channel under a vertical roof: first run 1' down from the high end of
  // each slope, then every 4', sitting on the bows directly under the panels.
  if (purlins) {
    const hc = FRAME_SPEC.hatChannel;
    for (let s = 0; s < baseProfile.length - 1; s++) {
      const a = baseProfile[s];
      const b = baseProfile[s + 1];
      const [hi, lo] = a.y >= b.y ? [a, b] : [b, a];
      const len = Math.hypot(lo.x - hi.x, lo.y - hi.y);
      if (len < 1e-6) continue;
      const ux = (lo.x - hi.x) / len;
      const uy = (lo.y - hi.y) / len;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      for (let d = hc.firstFromRidge; d < len - hc.width; d += hc.spacing) {
        members.push({
          kind: 'hat-channel',
          position: [hi.x + ux * d - (nx * hc.height) / 2, hi.y + uy * d - (ny * hc.height) / 2, 0],
          rotation: [0, 0, angle],
          size: [hc.width, hc.height, zTo - zFrom],
        });
      }
    }
  }

  // ── Endwall framing, closed ends only ────────────────────────────────────
  // Studs evenly spaced at no more than 5' between the corner legs, top cut to
  // the bow and broken around openings. The base rail is cut out at each door.
  const span = 2 * legX;
  const bays = Math.max(1, Math.ceil(span / FRAME_SPEC.endwallStudSpacing - 1e-6));
  for (const end of ['front', 'back'] as const) {
    if (!present[end]) continue;
    const z = endZ[end];
    const holes = endHoles[end];
    for (let k = 1; k < bays; k++) {
      const x = -legX + (span * k) / bays;
      const hit = holes.filter((h) => x > h.span[0] - tube && x < h.span[1] + tube);
      upright('endwall-stud', x, z, tube, bowUnderside(x), hit);
    }
    const doors = holes.filter((h) => h.y0 < 0.05).map((h) => h.span);
    for (const [x0, x1] of splitRun(-legX + tube / 2, legX - tube / 2, doors, tube)) {
      members.push({
        kind: 'base-rail',
        position: [(x0 + x1) / 2, tube / 2, z],
        rotation: [0, 0, 0],
        size: [x1 - x0, tube, tube],
      });
    }
  }

  // ── Clearances ───────────────────────────────────────────────────────────
  const sideClearHeight = Math.min(bowUnderside(-innerLegX), bowUnderside(innerLegX));
  let clearHeight = sideClearHeight;
  if (isGable) {
    const lowest = members
      .filter((m) => m.kind === 'peak-brace' || m.kind === 'bottom-chord')
      .map((m) => m.position[1] - m.size[1] / 2);
    clearHeight = lowest.length ? Math.min(...lowest) : bowUnderside(0);
  }

  return {
    members,
    clearWidth: 2 * innerLegX - tube,
    clearLength: zSpan - tube,
    clearHeight,
    sideClearHeight,
  };
}

/** Build the full geometry for a configuration. */
export function buildGeometry(cfg: BuildingConfig, catalog: Catalog): BuildingGeometry {
  const style = catalog.roofStyles.find((r) => r.id === cfg.roofStyle);
  const build = catalog.roofBuilds.find((b) => b.id === cfg.roofBuild);
  const rounded = build?.rounded ?? false;
  const tube = catalog.gauges.find((g) => g.id === cfg.gaugeId)?.tubeSize ?? catalog.rules.tubeSize;
  const legStyle = getSupplier(cfg.supplierId).legStyleFor(cfg.width, cfg.eaveHeight);

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
  // roof line, curl included. A squared roof's bow is still one bent tube, so
  // its apex gets a tight bend rather than a mitred corner.
  const bowPath = rounded ? profile : roundProfile(baseProfile, tube * FRAME_SPEC.apexBendTubes, false);
  const frame = buildFrame(cfg, catalog, {
    bowPath,
    baseProfile,
    purlins: build?.purlins ?? false,
    rounded,
    legStyle,
    tube,
    walls,
  });

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
    clearWidth: frame.clearWidth,
    clearLength: frame.clearLength,
    clearHeight: frame.clearHeight,
    sideClearHeight: frame.sideClearHeight,
  };

  return {
    baseProfile,
    profile,
    walls,
    roofPlanes,
    frame: frame.members,
    eaves: eaveHeights(cfg),
    rounded,
    legStyle,
    tube,
    metrics,
  };
}
