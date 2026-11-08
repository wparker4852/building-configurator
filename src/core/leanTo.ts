// Lean-tos: single-slope additions hung off the main building's walls.
//
// A lean-to's high edge sits against its host wall, tucked under the main
// eave, and the roof slopes down and away to an outer eave. It is framed with
// posts along the outer line, a rafter at every post, a ledger on the host
// wall and hat channel under vertical panels, and its three walls (outer and
// two ends) can each be open, closed, half or columns, with doors and windows
// in any closed one.
//
// Where two lean-tos meet at a corner of the main building they can be
// connected: both run out to the corner, the outer walls carry on round it,
// and the corner square gets a hip roof so the roof line is continuous.
//
// Everything here is in the building's world coordinates (feet, +X width,
// +Z length, +Y up). Each lean-to also works in its host wall's own terms:
//   s  along the host wall, from its left end as seen from outside
//   u  outward from the host wall's face
// which is the same measure openings use, so offsets read the same way.

import type {
  BuildingConfig, Catalog, CornerId, ExteriorWalls, LeanTo, LeanToWallId, WallId, WallKind, WallRef,
} from './types';
import { WALL_IDS } from './types';
import type { HoleRect, MemberKind, Pt, TubeMember, WallSpec } from './geometry';
import {
  FRAME_SPEC, eaveHeights, openingCenterX, openingSize, polygonArea, roofProfile, splitRun, wallLength, wallTopEdge,
  wallsTakeOpenings,
} from './geometry';

type V3 = [number, number, number];

/** Pitches a lean-to can be ordered in. */
export const LEAN_TO_PITCHES = [1, 2, 3, 4];
export const LEAN_TO_WIDTH = { min: 4, max: 20 };
export const LEAN_TO_MIN_LENGTH = 4;
/** Roof overhang past the outer eave and an unconnected end. */
const OVERHANG = 0.5;
/** How far the high edge sits below the main eave, so it tucks under it. */
const TUCK = 0.5;

export interface RoofSlab {
  key: string;
  /** Centre of the slab's underside. */
  center: V3;
  /** Down the slope, along the run, and up out of the roof: unit vectors. */
  slopeDir: V3;
  alongDir: V3;
  normal: V3;
  slopeLength: number;
  runLength: number;
  area: number;
}

export interface RoofTriangle {
  key: string;
  points: [V3, V3, V3];
  area: number;
}

export interface LeanToGeometry {
  id: string;
  side: WallId;
  label: string;
  walls: WallSpec[];
  roof: RoofSlab;
  /** Hip-roof triangles filling a connected corner (owned by the end-wall lean-to). */
  corners: RoofTriangle[];
  /** Hip lines over connected corners, for the cap trim. */
  hips: [V3, V3][];
  members: TubeMember[];
  /** Plan rectangles this lean-to covers (its strip, plus any corner it owns). */
  footprints: { x0: number; x1: number; z0: number; z1: number }[];
  footprintArea: number;
  roofArea: number;
  /** Panelled wall area, openings deducted. */
  wallArea: number;
  highY: number;
  eaveHeight: number;
}

// ── The host wall's frame of reference ───────────────────────────────────────

/** Outward normal n and along-the-wall direction a (left to right from outside), in world x/z. */
const SIDE: Record<WallId, { n: [number, number]; a: [number, number] }> = {
  front: { n: [0, 1], a: [1, 0] },
  back: { n: [0, -1], a: [-1, 0] },
  right: { n: [1, 0], a: [0, -1] },
  left: { n: [-1, 0], a: [0, 1] },
};

export interface Host {
  side: WallId;
  n: [number, number];
  a: [number, number];
  /** Distance from the building centre to the host wall's outside face. */
  d: number;
  /** Length of the host wall. */
  len: number;
}

export function hostOf(cfg: BuildingConfig, side: WallId): Host {
  const endWall = side === 'front' || side === 'back';
  return { side, ...SIDE[side], d: endWall ? cfg.length / 2 : cfg.width / 2, len: endWall ? cfg.width : cfg.length };
}

/** World point at (s along the host wall, u out from its face, height y). */
function at(h: Host, s: number, u: number, y: number): V3 {
  return [h.n[0] * (h.d + u) + h.a[0] * (s - h.len / 2), y, h.n[1] * (h.d + u) + h.a[1] * (s - h.len / 2)];
}

/** Highest a lean-to's high edge can sit on this side: just under the main eave. */
export function leanToMaxHigh(cfg: BuildingConfig, side: WallId): number {
  const e = eaveHeights(cfg);
  const hostEave = side === 'left' ? e.left : side === 'right' ? e.right : Math.min(e.left, e.right);
  return hostEave - TUCK;
}

/** Tallest outer eave a lean-to of this width and pitch can have on this side. */
export function leanToMaxEave(cfg: BuildingConfig, side: WallId, width: number, pitch: number): number {
  return Math.floor(leanToMaxHigh(cfg, side) - (width * pitch) / 12);
}

// ── Corners ──────────────────────────────────────────────────────────────────

/** Which end of which host wall meets at each building corner. */
export const CORNERS: Record<CornerId, [{ side: WallId; end: 'left' | 'right' }, { side: WallId; end: 'left' | 'right' }]> = {
  'front-left': [{ side: 'front', end: 'left' }, { side: 'left', end: 'right' }],
  'front-right': [{ side: 'front', end: 'right' }, { side: 'right', end: 'left' }],
  'back-right': [{ side: 'back', end: 'left' }, { side: 'right', end: 'right' }],
  'back-left': [{ side: 'back', end: 'right' }, { side: 'left', end: 'left' }],
};
export const CORNER_IDS = Object.keys(CORNERS) as CornerId[];

function reaches(lt: LeanTo, hostLen: number, end: 'left' | 'right'): boolean {
  return end === 'left' ? lt.offset <= 1e-6 : lt.offset + lt.length >= hostLen - 1e-6;
}

/**
 * Corners where a connection is possible: a lean-to on each of the two walls,
 * both running all the way to the corner.
 */
export function connectableCorners(cfg: BuildingConfig): CornerId[] {
  const bySide = new Map((cfg.leanTos ?? []).map((l) => [l.side, l]));
  return CORNER_IDS.filter((c) =>
    CORNERS[c].every(({ side, end }) => {
      const lt = bySide.get(side);
      return !!lt && reaches(lt, hostOf(cfg, side).len, end);
    }),
  );
}

/** Corners with a lean-to on both walls, whether or not they reach it yet. */
export function cornersWithBoth(cfg: BuildingConfig): CornerId[] {
  const sides = new Set((cfg.leanTos ?? []).map((l) => l.side));
  return CORNER_IDS.filter((c) => CORNERS[c].every(({ side }) => sides.has(side)));
}

/**
 * The lean-tos with both of a corner's lean-tos run into that corner: one that
 * already reaches its other end is lengthened to the full wall, otherwise it
 * slides along the wall to the corner.
 */
export function reachCorner(cfg: BuildingConfig, corner: CornerId): LeanTo[] {
  return (cfg.leanTos ?? []).map((lt) => {
    const at = CORNERS[corner].find((e) => e.side === lt.side);
    const hostLen = Math.floor(hostOf(cfg, lt.side).len);
    if (!at || reaches(lt, hostLen, at.end)) return lt;
    if (reaches(lt, hostLen, at.end === 'left' ? 'right' : 'left')) return { ...lt, offset: 0, length: hostLen };
    return { ...lt, offset: at.end === 'left' ? 0 : hostLen - lt.length };
  });
}

/** For each lean-to, which of its ends are connected, and whether it owns that corner's roof. */
function connections(cfg: BuildingConfig) {
  const out = new Map<string, { left?: { corner: CornerId; owner: boolean }; right?: { corner: CornerId; owner: boolean } }>();
  const bySide = new Map((cfg.leanTos ?? []).map((l) => [l.side, l]));
  for (const c of CORNER_IDS) {
    if (!cfg.leanToCorners?.[c]) continue;
    CORNERS[c].forEach(({ side, end }, i) => {
      const lt = bySide.get(side);
      if (!lt) return;
      const entry = out.get(lt.id) ?? {};
      // The lean-to on the gable end (listed first) owns the corner roof.
      entry[end] = { corner: c, owner: i === 0 };
      out.set(lt.id, entry);
    });
  }
  return out;
}

// ── Keeping lean-tos legal ───────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const KINDS: WallKind[] = ['open', 'closed', 'half', 'columns'];

/**
 * Clamp every lean-to into what can be built: one per side, 4'–20' wide and
 * at least 4' long in whole feet, along its host wall, with its high edge under
 * the main eave. Connected corners take one width, pitch and eave so the hip
 * meets cleanly; a connection that no longer has a lean-to on both walls
 * running to the corner is dropped. Mutates `cfg`.
 */
export function normalizeLeanTos(cfg: BuildingConfig): void {
  const seen = new Set<WallId>();
  const out: LeanTo[] = [];
  for (const raw of cfg.leanTos ?? []) {
    if (!raw || !WALL_IDS.includes(raw.side) || seen.has(raw.side)) continue;
    seen.add(raw.side);
    const hostLen = hostOf(cfg, raw.side).len;
    const width = clamp(Math.round(Number(raw.width) || 12), LEAN_TO_WIDTH.min, LEAN_TO_WIDTH.max);
    const length = clamp(Math.round(Number(raw.length) || hostLen), LEAN_TO_MIN_LENGTH, Math.floor(hostLen));
    const offset = clamp(Math.round(Number(raw.offset) || 0), 0, Math.floor(hostLen) - length);
    const pitch = LEAN_TO_PITCHES.includes(Math.round(Number(raw.pitch))) ? Math.round(Number(raw.pitch)) : 3;
    const maxEave = leanToMaxEave(cfg, raw.side, width, pitch);
    const eaveHeight = clamp(Math.round(Number(raw.eaveHeight) || maxEave), 4, Math.max(4, maxEave));

    let walls: Record<LeanToWallId, WallKind> = {
      outer: KINDS.includes(raw.walls?.outer) ? raw.walls.outer : 'open',
      left: KINDS.includes(raw.walls?.left) ? raw.walls.left : 'open',
      right: KINDS.includes(raw.walls?.right) ? raw.walls.right : 'open',
    };
    let exteriorWalls: ExteriorWalls = raw.exteriorWalls ?? 'none';
    if (exteriorWalls === 'none') walls = { outer: 'open', left: 'open', right: 'open' };
    else if (exteriorWalls === 'enclosed') walls = { outer: 'closed', left: 'closed', right: 'closed' };
    if (exteriorWalls !== 'custom') {
      const all = Object.values(walls);
      exteriorWalls = all.every((k) => k === 'open') ? 'none' : all.every((k) => k === 'closed') ? 'enclosed' : 'custom';
    }
    out.push({ id: String(raw.id || `lt-${raw.side}`), side: raw.side, width, length, offset, eaveHeight, pitch, exteriorWalls, walls });
  }
  cfg.leanTos = out;

  // Corners: keep only connectable ones, and give both lean-tos the same
  // width, pitch and eave (the gable-end lean-to leads).
  const ok = new Set(connectableCorners(cfg));
  const corners: Partial<Record<CornerId, boolean>> = {};
  for (const c of CORNER_IDS) {
    if (!cfg.leanToCorners?.[c] || !ok.has(c)) continue;
    const [lead, follow] = CORNERS[c].map(({ side }) => out.find((l) => l.side === side)!);
    follow.width = lead.width;
    follow.pitch = lead.pitch;
    const eave = Math.max(
      4,
      Math.min(lead.eaveHeight, leanToMaxEave(cfg, follow.side, lead.width, lead.pitch), leanToMaxEave(cfg, lead.side, lead.width, lead.pitch)),
    );
    lead.eaveHeight = eave;
    follow.eaveHeight = eave;
    corners[c] = true;
  }
  cfg.leanToCorners = corners;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

const WALL_NAME: Record<WallId, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };
const LT_WALL_NAME: Record<LeanToWallId, string> = { outer: 'outer wall', left: 'left end', right: 'right end' };

export function leanToLabel(side: WallId): string {
  return `${WALL_NAME[side]} lean-to`;
}

export function isLeanToWall(ref: WallRef): ref is `lt:${string}:${LeanToWallId}` {
  return ref.startsWith('lt:');
}

export function parseLeanToWall(ref: WallRef): { id: string; wall: LeanToWallId } | null {
  if (!isLeanToWall(ref)) return null;
  const parts = ref.split(':');
  return { id: parts.slice(1, -1).join(':'), wall: parts[parts.length - 1] as LeanToWallId };
}

const norm3 = (v: V3): V3 => {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};

/**
 * Build every lean-to: walls (with their openings), roof, corner hips and
 * frame. `tube` is the frame tube size for the building's gauge.
 */
export function buildLeanTos(cfg: BuildingConfig, catalog: Catalog, tube: number): LeanToGeometry[] {
  const wt = catalog.rules.wallThickness;
  const inset = wt + tube / 2;
  const conn = connections(cfg);
  const hc = FRAME_SPEC.hatChannel;

  return (cfg.leanTos ?? []).map((lt) => {
    const h = hostOf(cfg, lt.side);
    const k = lt.pitch / 12;
    const m = Math.sqrt(1 + k * k);
    const w = lt.width;
    const highY = lt.eaveHeight + w * k;
    /** Roof line (top of the rafters) at distance u from the host wall. */
    const roofY = (u: number) => highY - u * k;
    const c = conn.get(lt.id) ?? {};
    const s0 = lt.offset;
    const s1 = lt.offset + lt.length;
    // At a connected end the outer wall and frame carry on round the corner.
    const os0 = s0 - (c.left ? w : 0);
    const os1 = s1 + (c.right ? w : 0);
    const ohL = c.left ? 0 : OVERHANG;
    const ohR = c.right ? 0 : OVERHANG;
    const up = w - inset; // outer post line
    const P = (s: number, u: number, y: number) => at(h, s, u, y);
    const members: TubeMember[] = [];

    const seg = (kind: MemberKind, A: V3, B: V3, thick = tube) => {
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const dz = B[2] - A[2];
      const horiz = Math.hypot(dx, dz);
      const len = Math.hypot(horiz, dy);
      if (len < 1e-3) return;
      members.push({
        kind,
        leanToId: lt.id,
        position: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2],
        // Long axis tilted up by `tilt`, then turned to face along the run.
        rotation: [0, horiz < 1e-9 ? 0 : Math.atan2(-dz, dx), Math.atan2(dy, horiz)],
        size: [len, thick, thick],
      });
    };

    // ── Roof ──────────────────────────────────────────────────────────────
    const slopeDir = norm3([h.n[0], -k, h.n[1]]);
    const normal = norm3([h.n[0] * k, 1, h.n[1] * k]);
    const run0 = s0 - ohL;
    const run1 = s1 + ohR;
    const reach = w + OVERHANG;
    const roof: RoofSlab = {
      key: `lt-roof-${lt.id}`,
      center: P((run0 + run1) / 2, reach / 2, roofY(reach / 2)),
      slopeDir,
      alongDir: [h.a[0], 0, h.a[1]],
      normal,
      slopeLength: reach * m,
      runLength: run1 - run0,
      area: reach * m * (run1 - run0),
    };

    // Corner hip roof, built by the lean-to that owns the corner.
    const corners: RoofTriangle[] = [];
    const hips: [V3, V3][] = [];
    const footprints: LeanToGeometry['footprints'] = [];
    const rect = (A: V3, B: V3) =>
      footprints.push({ x0: Math.min(A[0], B[0]), x1: Math.max(A[0], B[0]), z0: Math.min(A[2], B[2]), z1: Math.max(A[2], B[2]) });
    rect(P(s0, 0, 0), P(s1, w, 0));
    let footprintArea = w * lt.length;
    for (const end of ['left', 'right'] as const) {
      const e = c[end];
      if (!e?.owner) continue;
      const sc = end === 'left' ? 0 : h.len;
      const dir = end === 'left' ? -1 : 1;
      // (u, v): u out from this host wall, v out past its end. The hip runs
      // where they are equal; each slope keeps the half nearer its own wall.
      const W = reach;
      const Q = (u: number, v: number) => P(sc + dir * v, u, highY - Math.max(u, v) * k);
      corners.push(
        { key: `lt-hip-a-${lt.id}-${end}`, points: [Q(0, 0), Q(W, 0), Q(W, W)], area: 0.5 * W * W * m },
        { key: `lt-hip-b-${lt.id}-${end}`, points: [Q(0, 0), Q(0, W), Q(W, W)], area: 0.5 * W * W * m },
      );
      hips.push([Q(0, 0), Q(W, W)]);
      rect(P(sc, 0, 0), P(sc + dir * w, w, 0));
      footprintArea += w * w;
      // Hip rafter under the hip line.
      seg('lt-rafter', P(sc, 0, highY - tube / 2), P(sc + dir * up, up, roofY(up) - tube / 2));
    }

    // ── Walls ─────────────────────────────────────────────────────────────
    const t = wt;
    const halfH = Math.max(2, Math.round(lt.eaveHeight) / 2);
    const walls: WallSpec[] = [];
    const makeWall = (
      wid: LeanToWallId,
      len: number,
      /** Top edge left to right in local x, as seen from outside this wall. */
      fullTop: Pt[],
      /** Centre of the wall's outside face at ground level, world x/z. */
      cx: number,
      cz: number,
      /** Outward normal, world x/z. */
      nx: number,
      nz: number,
    ) => {
      const ref: WallRef = `lt:${lt.id}:${wid}`;
      const kind = lt.walls[wid];
      const half = len / 2;
      const top = kind === 'half' ? [{ x: -half, y: halfH }, { x: half, y: halfH }] : fullTop;
      const outline: Pt[] = [{ x: -half, y: 0 }, { x: half, y: 0 }, ...top.slice().reverse()];
      const holes: HoleRect[] = [];
      if (kind === 'closed') {
        for (const op of cfg.openings) {
          if (op.wall !== ref) continue;
          const type = catalog.openingTypes.find((o) => o.id === op.catalogId);
          if (!type) continue;
          const { width, height } = openingSize(op, type);
          const hx = openingCenterX(op.offset, width, len);
          holes.push({ opening: op, type, cx: hx, x0: hx - width / 2, x1: hx + width / 2, y0: op.sill, y1: op.sill + height });
        }
      }
      const grossArea = polygonArea(outline);
      const holeArea = holes.reduce((sum, hh) => sum + (hh.x1 - hh.x0) * (hh.y1 - hh.y0), 0);
      // Local x runs along (nz, -nx) in world x/z.
      const X: [number, number] = [nz, -nx];
      const tops = top.map((p) => p.y);
      walls.push({
        id: ref,
        kind,
        label: `${leanToLabel(lt.side)} — ${LT_WALL_NAME[wid]}`,
        length: len,
        outline,
        top,
        face: { x0: cx - X[0] * half, z0: cz - X[1] * half, x1: cx + X[0] * half, z1: cz + X[1] * half },
        rotationY: Math.atan2(nx, nz),
        position: [cx - nx * t, 0, cz - nz * t],
        holes,
        grossArea,
        netArea: Math.max(0, grossArea - holeArea),
        present: kind === 'closed' || kind === 'half',
        minHeight: Math.min(...tops),
        maxHeight: Math.max(...tops),
      });
    };

    // Outer wall: along the outer eave, carried round any connected corner.
    {
      const len = os1 - os0;
      const C = P((os0 + os1) / 2, w, 0);
      makeWall('outer', len, [{ x: -len / 2, y: lt.eaveHeight }, { x: len / 2, y: lt.eaveHeight }], C[0], C[2], h.n[0], h.n[1]);
    }
    // End walls, unless that end is connected (the corner closes it).
    if (!c.left) {
      const C = P(s0, w / 2, 0);
      makeWall('left', w, [{ x: -w / 2, y: highY }, { x: w / 2, y: lt.eaveHeight }], C[0], C[2], -h.a[0], -h.a[1]);
    }
    if (!c.right) {
      const C = P(s1, w / 2, 0);
      makeWall('right', w, [{ x: -w / 2, y: lt.eaveHeight }, { x: w / 2, y: highY }], C[0], C[2], h.a[0], h.a[1]);
    }
    const wallById = (wid: LeanToWallId) => walls.find((x) => x.id === `lt:${lt.id}:${wid}`);

    // ── Frame ─────────────────────────────────────────────────────────────
    const outer = wallById('outer')!;
    const outerMid = (os0 + os1) / 2;
    const outerHoles = outer.holes.map((hh) => ({ s0: hh.x0 + outerMid, s1: hh.x1 + outerMid, y0: hh.y0, y1: hh.y1 }));
    const postTop = roofY(up) - 2 * tube;

    // Posts along the outer line, evenly at no more than the bent spacing,
    // broken around openings in the outer wall. A non-owning lean-to leaves
    // the shared corner post to the owner.
    const pFrom = os0 + inset;
    const pTo = os1 - inset;
    const count = Math.max(2, Math.round((pTo - pFrom) / cfg.onCenter) + 1);
    for (let i = 0; i < count; i++) {
      const s = pFrom + ((pTo - pFrom) * i) / (count - 1);
      if ((i === 0 && c.left && !c.left.owner) || (i === count - 1 && c.right && !c.right.owner)) continue;
      const gaps = outerHoles.filter((hh) => s > hh.s0 - tube && s < hh.s1 + tube).map((hh) => [hh.y0 - tube, hh.y1 + tube] as [number, number]);
      for (const [y0, y1] of splitRun(0, postTop, gaps, tube)) seg('lt-post', P(s, up, y0), P(s, up, y1));
      // Rafter from the host wall out to the eave; past a connected end it is
      // a jack rafter running from the hip.
      const beyond = s < s0 ? s0 - s : s > s1 ? s - s1 : 0;
      if (beyond < up - tube) seg('lt-rafter', P(s, beyond, roofY(beyond) - tube / 2), P(s, w, roofY(w) - tube / 2));
    }
    // Header along the post tops, base rail along the foot (cut at doors),
    // ledger on the host wall under the high edge.
    seg('lt-header', P(os0 + inset - tube / 2, up, postTop + tube / 2), P(os1 - inset + tube / 2, up, postTop + tube / 2));
    const outerDoors = outerHoles.filter((hh) => hh.y0 < 0.05).map((hh) => [hh.s0, hh.s1] as [number, number]);
    for (const [a0, a1] of splitRun(os0 + inset - tube / 2, os1 - inset + tube / 2, outerDoors, tube)) {
      seg('base-rail', P(a0, up, tube / 2), P(a1, up, tube / 2));
    }
    seg('ledger', P(s0, tube / 2, highY - tube / 2), P(s1, tube / 2, highY - tube / 2));
    // Hat channel under the vertical panels: 1' down from the high edge, then every 4'.
    for (let d = hc.firstFromRidge; d < w * m - hc.width; d += hc.spacing) {
      const u = d / m;
      seg('hat-channel', P(s0, u, roofY(u) - hc.height / 2), P(s1, u, roofY(u) - hc.height / 2), hc.height);
    }

    // End walls that are framed get studs at no more than 5', a base rail
    // (cut at doors) and, on a half wall, a girt along the top of the panels.
    for (const end of ['left', 'right'] as const) {
      if (c[end]) continue;
      const wall = wallById(end);
      if (!wall || wall.kind === 'open') continue;
      const sF = end === 'left' ? s0 + inset : s1 - inset;
      // Local x along this end wall to u, and back.
      const uOf = (x: number) => (end === 'left' ? x + w / 2 : w / 2 - x);
      const holes = wall.holes.map((hh) => {
        const a = uOf(hh.x0);
        const b = uOf(hh.x1);
        return { u0: Math.min(a, b), u1: Math.max(a, b), y0: hh.y0, y1: hh.y1 };
      });
      const bays = Math.max(1, Math.ceil(up / FRAME_SPEC.endwallStudSpacing - 1e-6));
      for (let i = 1; i < bays; i++) {
        const u = (up * i) / bays;
        const gaps = holes.filter((hh) => u > hh.u0 - tube && u < hh.u1 + tube).map((hh) => [hh.y0 - tube, hh.y1 + tube] as [number, number]);
        for (const [y0, y1] of splitRun(tube, roofY(u) - tube, gaps, tube)) seg('endwall-stud', P(sF, u, y0), P(sF, u, y1));
      }
      const doors = holes.filter((hh) => hh.y0 < 0.05).map((hh) => [hh.u0, hh.u1] as [number, number]);
      for (const [a0, a1] of splitRun(tube / 2, up - tube / 2, doors, tube)) seg('base-rail', P(sF, a0, tube / 2), P(sF, a1, tube / 2));
      if (wall.kind === 'half') seg('girt', P(sF, tube / 2, halfH - tube / 2), P(sF, up, halfH - tube / 2));
    }
    if (outer.kind === 'half') seg('girt', P(os0 + inset, up, halfH - tube / 2), P(os1 - inset, up, halfH - tube / 2));

    // Frame-outs: full-height jambs, a header and (for windows) a sill at
    // every opening, in the plane of the frame, like the main building.
    const frameOut = (wall: WallSpec, toWorld: (x: number, y: number) => V3, topAt: (x: number) => number) => {
      for (const hh of wall.holes) {
        const door = hh.y0 < 0.05;
        const foot = door ? 0 : tube;
        for (const x of [hh.x0 - tube / 2, hh.x1 + tube / 2]) seg('jamb', toWorld(x, foot), toWorld(x, topAt(x)));
        const hy = hh.y1 + tube / 2;
        if (hy < Math.min(topAt(hh.x0), topAt(hh.x1)) - tube / 2) seg('header', toWorld(hh.x0 - tube, hy), toWorld(hh.x1 + tube, hy));
        if (!door) seg('sill', toWorld(hh.x0 - tube, hh.y0 - tube / 2), toWorld(hh.x1 + tube, hh.y0 - tube / 2));
      }
    };
    frameOut(outer, (x, y) => P(outerMid + x, up, y), () => postTop);
    for (const end of ['left', 'right'] as const) {
      const wall = wallById(end);
      if (!wall) continue;
      const sF = end === 'left' ? s0 + inset : s1 - inset;
      const uOf = (x: number) => (end === 'left' ? x + w / 2 : w / 2 - x);
      frameOut(wall, (x, y) => P(sF, uOf(x), y), (x) => roofY(uOf(x)) - tube);
    }

    const roofArea = roof.area + corners.reduce((sum, tri) => sum + tri.area, 0);
    const wallArea = walls.filter((x) => x.present).reduce((sum, x) => sum + x.netArea, 0);
    return {
      id: lt.id,
      side: lt.side,
      label: leanToLabel(lt.side),
      walls,
      roof,
      corners,
      hips,
      members,
      footprints,
      footprintArea,
      roofArea,
      wallArea,
      highY,
      eaveHeight: lt.eaveHeight,
    };
  });
}

// ── Any wall, main or lean-to ────────────────────────────────────────────────

export interface WallInfo {
  ref: WallRef;
  label: string;
  length: number;
  /** Top edge in wall-local coordinates, for headroom. */
  top: Pt[];
  /** Doors and windows are only built into a fully closed wall. */
  takesOpenings: boolean;
}

const MAIN_LABEL: Record<WallId, string> = { front: 'Front', back: 'Back', left: 'Left side', right: 'Right side' };

/** Length, top edge and whether openings are built, for any wall an opening can go in. */
export function wallInfo(cfg: BuildingConfig, catalog: Catalog, ref: WallRef): WallInfo | null {
  if (!isLeanToWall(ref)) {
    if (!WALL_IDS.includes(ref)) return null;
    const profile = roofProfile(cfg, catalog.roofStyles.find((r) => r.id === cfg.roofStyle));
    return {
      ref,
      label: MAIN_LABEL[ref],
      length: wallLength(cfg, ref),
      top: wallTopEdge(cfg, ref, profile),
      takesOpenings: wallsTakeOpenings(cfg)[ref],
    };
  }
  const parsed = parseLeanToWall(ref);
  if (!parsed || !(cfg.leanTos ?? []).some((l) => l.id === parsed.id)) return null;
  const tube = catalog.gauges.find((g) => g.id === cfg.gaugeId)?.tubeSize ?? catalog.rules.tubeSize;
  const geo = buildLeanTos({ ...cfg, openings: [] }, catalog, tube).find((l) => l.id === parsed.id);
  const wall = geo?.walls.find((x) => x.id === ref);
  if (!wall) return null;
  // Headroom is the full wall's, whatever its kind; whether it is built is separate.
  const full = wall.kind === 'half' ? buildLeanTos({ ...cfg, openings: [], leanTos: (cfg.leanTos ?? []).map((l) => (l.id === parsed.id ? { ...l, walls: { ...l.walls, [parsed.wall]: 'closed' } } : l)) }, catalog, tube)
    .find((l) => l.id === parsed.id)?.walls.find((x) => x.id === ref) : wall;
  return { ref, label: wall.label, length: wall.length, top: (full ?? wall).top, takesOpenings: wall.kind === 'closed' };
}

/** Every wall an opening could go in: the four main walls, then each lean-to's. */
export function allWallRefs(cfg: BuildingConfig, catalog: Catalog): WallInfo[] {
  const refs: WallRef[] = [...WALL_IDS];
  const conn = connections(cfg);
  for (const lt of cfg.leanTos ?? []) {
    refs.push(`lt:${lt.id}:outer`);
    if (!conn.get(lt.id)?.left) refs.push(`lt:${lt.id}:left`);
    if (!conn.get(lt.id)?.right) refs.push(`lt:${lt.id}:right`);
  }
  return refs.map((r) => wallInfo(cfg, catalog, r)).filter((x): x is WallInfo => x !== null);
}
