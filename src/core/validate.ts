// Keeps a configuration legal.
//
// Runs on every change, on model switches, and on anything decoded from a URL,
// so the rest of the app can assume the config it holds is buildable.

import type { BuildingConfig, Catalog, Opening, PlanItem, WallId } from './types';
import { WALL_IDS } from './types';
import { FLOOR_PLAN_ITEMS } from './floorPlan';
import {
  profileHeightAt, roofProfile, wallLength, wallTopEdge, headroomAt, openingCenterX, openingSize, wallsPresent,
} from './geometry';
import { getSupplier } from './suppliers';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

/** Clamp every field of a config into the range the catalog allows. */
export function normalizeConfig(input: BuildingConfig, catalog: Catalog): BuildingConfig {
  const model = catalog.models.find((m) => m.id === input.modelId) ?? catalog.models[0];
  const size = model.size;

  const cfg: BuildingConfig = { ...input, modelId: model.id };

  // ── Snap to the supplier's printed sizes ───────────────────────────────────
  // These books are matrices, not formulas. A size that is not printed is a
  // size nobody has quoted, so the config is never allowed to hold one.
  const supplier = getSupplier(cfg.supplierId);
  cfg.supplierId = supplier.id;

  const nearest = (want: number, from: number[], fallback: number) =>
    from.length ? from.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : fallback;

  // Width first: for a manufacturer that prints several books, width is what
  // decides which one applies, so everything below depends on it.
  cfg.width = nearest(Number(cfg.width) || size.minWidth, supplier.widths, supplier.widths[0]);

  // A silhouette may stop at a width (single slope is not offered over 30').
  const styleFits = (id: string) => {
    const s = catalog.roofStyles.find((r) => r.id === id);
    return !!s && (s.maxWidth == null || cfg.width <= s.maxWidth);
  };
  if (!model.allowedRoofStyles.includes(cfg.roofStyle) || !styleFits(cfg.roofStyle)) {
    cfg.roofStyle = model.allowedRoofStyles.find(styleFits) ?? model.allowedRoofStyles[0];
  }

  const roofBuilds = supplier.roofBuildsFor(cfg.width);
  if (!roofBuilds.includes(cfg.roofBuild)) cfg.roofBuild = roofBuilds[0];

  // Some suppliers fix frame spacing by width rather than offering it.
  const onCenters = supplier.onCentersFor(cfg.width);
  cfg.onCenter = supplier.onCenterFixedFor(cfg.width)
    ? supplier.onCenterFor(cfg.width)
    : onCenters.includes(cfg.onCenter === 4 ? 4 : 5)
      ? (cfg.onCenter === 4 ? 4 : 5)
      : onCenters[0];

  const lengths = supplier.lengthsFor(cfg.roofBuild, cfg.onCenter, cfg.width);
  cfg.length = nearest(Number(cfg.length) || lengths[0], lengths, lengths[0] ?? 20);

  cfg.eaveHeight = nearest(
    Number(cfg.eaveHeight) || supplier.standardLegHeightFor(cfg.width),
    supplier.legHeightsFor(cfg.width),
    supplier.standardLegHeightFor(cfg.width),
  );

  cfg.overhang = supplier.overhangsFor(cfg.width).includes(Number(cfg.overhang)) ? Number(cfg.overhang) : 0;
  cfg.wainscot = !!cfg.wainscot;
  cfg.sidesClosed = !!cfg.sidesClosed;
  cfg.endsClosed = clamp(Math.round(Number(cfg.endsClosed) || 0), 0, 2);
  // Keep the legacy enclosure enum in step; geometry still reads it.
  cfg.enclosure = !cfg.sidesClosed && cfg.endsClosed === 0
    ? 'open'
    : cfg.sidesClosed && cfg.endsClosed >= 2
      ? 'enclosed'
      : 'partial';

  const style = catalog.roofStyles.find((r) => r.id === cfg.roofStyle);
  const build = catalog.roofBuilds.find((b) => b.id === cfg.roofBuild);
  // A roof build only comes in certain pitches, and the supplier constrains
  // that further — a regular roof is 3/12 only.
  const pitches = (build?.pitches ?? [])
    .filter((p) => supplier.pitchesFor(cfg.width).includes(p))
    .filter((p) => p >= (style?.minPitch ?? 1) && p <= (style?.maxPitch ?? 12));
  if (pitches.length > 0) {
    const want = Number(cfg.pitch) || model.basePitch;
    cfg.pitch = pitches.reduce((best, p) => (Math.abs(p - want) < Math.abs(best - want) ? p : best), pitches[0]);
  } else {
    cfg.pitch = clamp(Number(cfg.pitch) || model.basePitch, style?.minPitch ?? 1, style?.maxPitch ?? 12);
  }

  // Every book these suppliers print ships certified, and frame spacing was
  // already decided above from the supplier and width — don't re-derive it.
  cfg.certified = supplier.alwaysCertified;
  cfg.gaugeId = catalog.gauges.some((g) => g.id === cfg.gaugeId) ? cfg.gaugeId : catalog.gauges[0].id;
  cfg.sidingOrientation = cfg.sidingOrientation === 'vertical' ? 'vertical' : 'horizontal';

  // Enclosure is derived from sides and ends above. A model's allowed list must
  // not override it, or the walls drawn and the walls charged would disagree.

  const pick = <T extends { id: string }>(list: T[], id: string) =>
    list.some((x) => x.id === id) ? id : list[0].id;
  cfg.sidingId = pick(catalog.sidings, cfg.sidingId);
  cfg.roofingId = pick(catalog.roofings, cfg.roofingId);
  cfg.floorId = pick(catalog.floors, cfg.floorId);
  cfg.sidingColorId = pick(catalog.colors, cfg.sidingColorId);
  cfg.roofColorId = pick(catalog.colors, cfg.roofColorId);
  cfg.trimColorId = pick(catalog.colors, cfg.trimColorId);
  cfg.wainscotColorId =
    cfg.wainscotColorId && catalog.colors.some((c) => c.id === cfg.wainscotColorId)
      ? cfg.wainscotColorId
      : null;
  // Nothing to wainscot on an open building.
  if (cfg.enclosure === 'open') cfg.wainscotColorId = null;

  cfg.gableOverhang = clamp(Number(cfg.gableOverhang) || 0, 0, 4);
  cfg.eaveOverhang = clamp(Number(cfg.eaveOverhang) || 0, 0, 4);
  cfg.discountPct = clamp(Number(cfg.discountPct) || 0, 0, 40);

  const taxStates = catalog.rules.taxByState ?? {};
  if (!cfg.state || !(cfg.state in taxStates)) delete cfg.state;
  cfg.planItems = normalizePlanItems(cfg.planItems);

  const knownOptions = new Set(catalog.addOns.map((a) => a.id));
  cfg.optionIds = (cfg.optionIds ?? []).filter((id) => knownOptions.has(id));
  const quantities: Record<string, number> = {};
  for (const id of cfg.optionIds) {
    const addOn = catalog.addOns.find((a) => a.id === id);
    if (!addOn?.countable) continue;
    quantities[id] = clamp(Math.round(cfg.quantities?.[id] ?? 1), 1, addOn.maxQty ?? 99);
  }
  cfg.quantities = quantities;

  cfg.openings = (cfg.openings ?? [])
    .filter((op) => catalog.openingTypes.some((t) => t.id === op.catalogId))
    .map((op) => clampOpening(op, cfg, catalog))
    .filter((op): op is Opening => op !== null);

  return cfg;
}

/** Fit a single opening inside its wall, or return null if it cannot fit at all. */
export function clampOpening(op: Opening, cfg: BuildingConfig, catalog: Catalog): Opening | null {
  const type = catalog.openingTypes.find((t) => t.id === op.catalogId);
  if (!type) return null;
  if (type.allowedWalls !== 'any' && !type.allowedWalls.includes(op.wall)) return null;

  const len = wallLength(cfg, op.wall);

  const profile = roofProfile(cfg, catalog.roofStyles.find((r) => r.id === cfg.roofStyle));
  const top = wallTopEdge(cfg, op.wall, profile);

  // Resizable types carry their own size; clamp it to the type's limits and
  // to the wall before anything else depends on it.
  let width = type.width;
  let height = type.height;
  if (type.resizable) {
    width = clamp(Number(op.width ?? type.width), type.minWidth ?? 1, Math.min(type.maxWidth ?? 99, len - 0.5));
    height = clamp(Number(op.height ?? type.height), type.minHeight ?? 1, type.maxHeight ?? 99);
  }
  if (width > len) return null;

  const offset = clamp(Number(op.offset) || 0, 0, len - width);
  const cx = openingCenterX(offset, width, len);
  const room = headroomAt(top, cx - width / 2, cx + width / 2);
  // Leave a little structure above the opening.
  const maxTop = room - 0.35;

  if (type.resizable) {
    height = Math.min(height, maxTop);
    if (height < (type.minHeight ?? 1)) return null;
  } else if (height > maxTop) {
    return null;
  }

  // Doors are walked or driven through, so they sit on the floor no matter
  // what a stale config or an edited URL asks for.
  const sill = type.allowSill ? clamp(Number(op.sill) || 0, 0, Math.max(0, maxTop - height)) : 0;

  const out: Opening = { ...op, offset, sill };
  if (type.resizable) {
    out.width = Math.round(width * 4) / 4;
    out.height = Math.round(height * 4) / 4;
  } else {
    delete out.width;
    delete out.height;
  }
  return out;
}

/** Human-readable problems worth surfacing in the UI. */
export function findIssues(cfg: BuildingConfig, catalog: Catalog): Issue[] {
  const issues: Issue[] = [];
  const profile = roofProfile(cfg, catalog.roofStyles.find((r) => r.id === cfg.roofStyle));

  // Openings that overlap each other on the same wall.
  const byWall = new Map<WallId, { a: number; b: number; name: string }[]>();
  for (const op of cfg.openings) {
    const type = catalog.openingTypes.find((t) => t.id === op.catalogId);
    if (!type) continue;
    const { width } = openingSize(op, type);
    const list = byWall.get(op.wall) ?? [];
    list.push({ a: op.offset, b: op.offset + width, name: type.name });
    byWall.set(op.wall, list);
  }
  for (const [wall, list] of byWall) {
    const sorted = [...list].sort((x, y) => x.a - y.a);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].a < sorted[i - 1].b - 1e-6) {
        issues.push({
          level: 'error',
          message: `On the ${wall} wall, "${sorted[i - 1].name}" and "${sorted[i].name}" overlap.`,
        });
      }
    }
  }

  // Doors on a wall that is not being built.
  const present = wallsPresent(cfg);
  const openWalls = WALL_IDS.filter((w) => !present[w]);
  const stranded = cfg.openings.filter((o) => openWalls.includes(o.wall)).length;
  if (stranded > 0) {
    issues.push({
      level: 'warning',
      message: `${stranded} door/window ${stranded === 1 ? 'is' : 'are'} on an open side and will not be built or charged.`,
    });
  }

  const peak = Math.max(...profile.map((p) => p.y));
  if (peak > 24) {
    issues.push({
      level: 'warning',
      message: `Peak height is ${peak.toFixed(1)}' — many jurisdictions require stamped engineering above 24'.`,
    });
  }

  if (cfg.width >= 40 && cfg.roofStyle === 'single-slope') {
    issues.push({ level: 'warning', message: 'Single-slope roofs over 40′ wide usually need an interior post line.' });
  }

  return issues;
}

/** Keep floor-plan items finite, sized and on quarter turns; drop anything malformed. */
export function normalizePlanItems(items: PlanItem[] | undefined): PlanItem[] {
  if (!Array.isArray(items)) return [];
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return items
    .filter((it) => it && typeof it === 'object')
    .slice(0, 60)
    .map((it, i) => ({
      id: String(it.id || `p${i}`),
      kind: String(it.kind || 'custom'),
      label: String(it.label || 'Item').slice(0, 24),
      w: clamp(num(it.w, 2), 0.5, 200),
      h: clamp(num(it.h, 2), 0.5, 200),
      // Items saved before heights existed take their preset's.
      tall: clamp(num(it.tall, FLOOR_PLAN_ITEMS.find((p) => p.kind === it.kind)?.tall ?? 4), 0.25, 40),
      x: clamp(num(it.x, 0), -500, 500),
      y: clamp(num(it.y, 0), -500, 500),
      rot: (((Math.round(num(it.rot, 0) / 90) * 90) % 360) + 360) % 360,
      color: /^#[0-9a-f]{6}$/i.test(String(it.color)) ? String(it.color) : '#4a7fc1',
    }));
}

/** Height of the roof line at a world X, re-exported for UI hints. */
export { profileHeightAt };
