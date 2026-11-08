// Pricing by material takeoff: count what is actually drawn — feet of tube,
// feet of panel, feet of trim, posts to anchor — and price it from the
// materials list. Used for anything the manufacturers' printed matrices do not
// cover: lean-tos now, partition walls next.
//
// The result is COST. pricing.ts applies the category markup to reach a sell
// price, exactly as it does for book lines.

import type { BuildingConfig, Catalog, MaterialCosts } from './types';
import type { LeanToGeometry } from './leanTo';

export interface TakeoffLine {
  label: string;
  qty: number;
  unit: string;
  unitCost: number;
  cost: number;
}

export interface Takeoff {
  lines: TakeoffLine[];
  cost: number;
  /** What could not be priced (no labor rate, no materials list). */
  unpriced: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Panel gauge for a roofing or siding choice: 26 ga materials, else 29 ga. */
function panelGauge(id: string): '26ga' | '29ga' {
  return id.includes('26') || id.includes('standing-seam') ? '26ga' : '29ga';
}

/** Cost of one lean-to, from its frame, panels and trim as built. */
export function leanToTakeoff(lt: LeanToGeometry, cfg: BuildingConfig, catalog: Catalog): Takeoff {
  const mat: MaterialCosts | undefined = catalog.materials;
  if (!mat) return { lines: [], cost: 0, unpriced: [`${lt.label}: no materials price list is loaded`] };

  const lines: TakeoffLine[] = [];
  const unpriced: string[] = [];
  const add = (label: string, qty: number, unit: string, unitCost: number) => {
    if (qty <= 0) return;
    lines.push({ label, qty: Math.round(qty * 10) / 10, unit, unitCost, cost: round2(qty * unitCost) });
  };

  // Frame: every tube member's length; hat channel priced on its own.
  const gauge = cfg.gaugeId;
  const tubeFt = lt.members.filter((m) => m.kind !== 'hat-channel').reduce((s, m) => s + m.size[0], 0);
  const hatFt = lt.members.filter((m) => m.kind === 'hat-channel').reduce((s, m) => s + m.size[0], 0);
  const tubeRate = mat.tubePerFt[gauge];
  if (tubeRate == null) unpriced.push(`${lt.label}: no tube price for ${gauge}`);
  else add(`${gauge.replace('ga', ' ga')} square tube`, tubeFt, 'ft', tubeRate);
  add('Hat channel', hatFt, 'ft', mat.hatChannelPerFt);

  // Panels: running feet of 3'-coverage panel for the roof and the panelled walls.
  const roofGauge = panelGauge(cfg.roofingId);
  const wallGauge = panelGauge(cfg.sidingId);
  add(`Roof panels, ${roofGauge.replace('ga', ' ga')}`, lt.roofArea / mat.panelCoverage, 'panel ft', mat.panelPerFt[roofGauge] ?? 0);
  add(`Wall panels, ${wallGauge.replace('ga', ' ga')}`, lt.wallArea / mat.panelCoverage, 'panel ft', mat.panelPerFt[wallGauge] ?? 0);

  // Trim: eave flashing along the outer eave, rake trim up each open end,
  // valley trim where the roof meets the main wall and over each hip, corner
  // trim up each outside corner that has panels.
  const run = lt.roof.runLength;
  const openEnds = lt.walls.filter((w) => w.id.endsWith(':left') || w.id.endsWith(':right')).length;
  const hipFt = lt.hips.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), 0);
  // A connected corner adds both outer edges of its square to the eave run.
  const cornerEave = lt.hips.reduce((s, [a, b]) => s + 2 * (Math.hypot(b[0] - a[0], b[2] - a[2]) / Math.SQRT2), 0);
  add('Eave flashing', run + cornerEave, 'ft', mat.trimPerFt.eaveFlashing);
  add('Rake trim', openEnds * lt.roof.slopeLength, 'ft', mat.trimPerFt.jTrim);
  add('Wall-to-roof flashing and hip cap', run + hipFt, 'ft', mat.trimPerFt.ridgeValley);
  const outer = lt.walls.find((w) => w.id.endsWith(':outer'));
  const corners = lt.walls.filter((w) => !w.id.endsWith(':outer') && (w.present || outer?.present)).length + (outer?.present ? lt.hips.length : 0);
  add('Corner trim', corners * lt.eaveHeight, 'ft', mat.trimPerFt.cornerTrim);

  // Anchors: one per post foot.
  const posts = lt.members.filter((m) => m.kind === 'lt-post' && m.position[1] - m.size[0] / 2 < 0.05).length;
  add('Post anchors', posts, 'ea', mat.anchorEach);

  // Fastener allowance over all the panel area.
  add('Screws (allowance)', (lt.roofArea + lt.wallArea) * mat.fastenersPerSqFt, 'ea', mat.fastenerEach);

  // Install labor, once someone has set a rate.
  if (mat.laborPerSqFt == null) unpriced.push(`${lt.label}: install labor rate not set (Admin → Materials)`);
  else add('Install labor', lt.footprintArea, 'sq ft', mat.laborPerSqFt);

  return { lines, cost: round2(lines.reduce((s, l) => s + l.cost, 0)), unpriced };
}
