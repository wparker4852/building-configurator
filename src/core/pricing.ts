// The pricing engine. Pure function of (config, catalog, geometry) -> Quote.
//
// Every charge is an explicit line item so the same result can drive the
// customer price summary, the internal margin view, and a printed quote.

import type { AddOn, BuildingConfig, Catalog, LineItem, Quote, WallKind } from './types';
import type { BuildingGeometry } from './geometry';
import { strongerLeg, wallKinds } from './geometry';
import { leanToTakeoff } from './takeoff';
import { getSupplier, type CostLine } from './suppliers';
import { pricedComponents } from './componentPricing';

const round2 = (n: number) => Math.round(n * 100) / 100;

function costFor(catalog: Catalog, category: string, total: number): number {
  const factor = catalog.rules.costFactors[category] ?? catalog.rules.defaultCostFactor;
  return round2(total * factor);
}

function line(
  catalog: Catalog,
  key: string,
  label: string,
  category: string,
  qty: number,
  unit: string,
  unitPrice: number,
  detail?: string,
): LineItem {
  const total = round2(qty * unitPrice);
  return { key, label, detail, category, qty, unit, unitPrice, total, cost: costFor(catalog, category, total) };
}

/** Quantity an add-on is priced against. */
export function addOnQty(addOn: AddOn, cfg: BuildingConfig, geo: BuildingGeometry, count: number): number {
  switch (addOn.basis) {
    case 'each':
      return count;
    case 'footprint':
      return geo.metrics.footprint;
    case 'wallArea':
      return geo.metrics.wallArea;
    case 'roofArea':
      return geo.metrics.roofArea;
    case 'perimeter':
      return geo.metrics.perimeter;
    case 'length':
      return cfg.length;
  }
}

const BASIS_UNIT: Record<AddOn['basis'], string> = {
  each: 'ea',
  footprint: 'sq ft',
  wallArea: 'sq ft',
  roofArea: 'sq ft',
  perimeter: 'lin ft',
  length: 'lin ft',
};

/** Estimated freight for a delivery distance. */
export function freightFor(catalog: Catalog, miles: number): number {
  const f = catalog.rules.freight;
  return round2(f.baseCharge + Math.max(0, miles - f.freeRadiusMiles) * f.perMile);
}

/** Sales tax rate: the delivery state's when one is chosen, else the default. */
export function taxRateFor(catalog: Catalog, cfg: BuildingConfig): number {
  const byState = catalog.rules.taxByState ?? {};
  return cfg.state && byState[cfg.state] != null ? byState[cfg.state] : catalog.rules.taxRate;
}

/** Markup percentage for a line category. */
function markupFor(catalog: Catalog, category: string): number {
  return catalog.rules.markup.byCategory[category] ?? catalog.rules.markup.defaultPct;
}

/** Turn a supplier cost line into a sell line. */
function fromCost(catalog: Catalog, l: CostLine): LineItem {
  const pct = markupFor(catalog, l.category);
  const total = round2(l.cost * (1 + pct / 100));
  return {
    key: l.key,
    label: l.label,
    detail: l.detail,
    category: l.category,
    qty: 1,
    unit: 'ea',
    unitPrice: total,
    total,
    cost: round2(l.cost),
  };
}

export function priceBuilding(cfg: BuildingConfig, catalog: Catalog, geo: BuildingGeometry): Quote {
  const floor = catalog.floors.find((f) => f.id === cfg.floorId);
  const { footprint } = geo.metrics;


  // ── Structure, walls and upgrades: straight from the supplier's book ───────
  // The book gives COST. Markup is applied per line to reach the sell price.
  const supplier = getSupplier(cfg.supplierId);
  const book = supplier.quote({
    roofBuild: cfg.roofBuild,
    width: cfg.width,
    length: cfg.length,
    onCenter: cfg.onCenter,
    legHeight: cfg.eaveHeight,
    sidesClosed: cfg.sidesClosed,
    endsClosed: cfg.endsClosed,
    verticalSides: cfg.sidingOrientation === 'vertical',
    verticalEnds: cfg.sidingOrientation === 'vertical',
    pitch: cfg.pitch,
    overhang: cfg.overhang,
    gauge12: cfg.gaugeId === '12ga',
    wainscot: !!cfg.wainscotColorId || cfg.wainscot,
  });

  const lines: LineItem[] = book.lines.map((l) => fromCost(catalog, l));
  const unpriced = [...book.unpriced];

  // ── Walls and legs the book does not print ─────────────────────────────────
  // The book prices the sides only as a closed pair and each end only as
  // closed. Anything else chosen wall by wall is stated, never estimated.
  const k = wallKinds(cfg);
  const kindName: Record<WallKind, string> = { open: 'open', closed: 'closed', half: 'half wall', gable: 'gable only', columns: 'columns' };
  if ((k.left === 'closed') !== (k.right === 'closed')) {
    unpriced.push(`only the ${k.left === 'closed' ? 'left' : 'right'} side closed — sides are priced as a pair`);
  }
  for (const w of ['left', 'right', 'front', 'back'] as const) {
    if (k[w] === 'half' || k[w] === 'gable' || k[w] === 'columns') unpriced.push(`${w} wall as ${kindName[k[w]]}`);
  }
  const bookLeg = supplier.legStyleFor(cfg.width, cfg.eaveHeight);
  const chosenLeg = cfg.legChoice ?? 'single';
  if (strongerLeg(bookLeg, chosenLeg) !== bookLeg) {
    unpriced.push(`${chosenLeg} legs at ${cfg.eaveHeight}' (${supplier.name} prints ${bookLeg} legs at this height)`);
  }

  // ── Lean-tos: priced by material takeoff ───────────────────────────────────
  // No manufacturer prints lean-tos, so each is priced from what is drawn:
  // tube, panels, trim, anchors, screws and (once set) install labor, at the
  // Materials price list's cost, marked up like any other line.
  for (const lt of geo.leanTos) {
    const t = leanToTakeoff(lt, cfg, catalog);
    unpriced.push(...t.unpriced);
    if (t.cost <= 0) continue;
    const spec = cfg.leanTos?.find((l) => l.id === lt.id);
    const sell = round2(t.cost * (1 + markupFor(catalog, 'Lean-tos') / 100));
    lines.push({
      key: `lt-${lt.id}`,
      label: spec ? `${lt.label} ${spec.width}' × ${spec.length}'` : lt.label,
      detail: t.lines.map((l) => `${l.label} ${l.qty.toLocaleString()} ${l.unit}`).join(' · '),
      category: 'Lean-tos',
      qty: 1,
      unit: 'ea',
      unitPrice: sell,
      total: sell,
      cost: t.cost,
    });
  }

  // ── Foundation ─────────────────────────────────────────────────────────────
  if (floor && floor.pricePerSqFt > 0) {
    lines.push(line(catalog, 'floor', floor.name, 'Foundation', footprint, 'sq ft', floor.pricePerSqFt));
  }

  // ── Doors & windows ────────────────────────────────────────────────────────
  // Priced from the supplier's own component list wherever they carry the item,
  // so the admin price table is what actually drives the quote. Anything the
  // supplier does not stock falls back to the catalog and is flagged.
  const components = pricedComponents(supplier, catalog.rules.markup.defaultPct);
  const byId = new Map(components.map((c) => [c.id, c]));

  /** Match a catalog opening type to this supplier's nearest stocked item. */
  const matchComponent = (type: { id: string; category: string; width: number; height: number }) => {
    if (type.category === 'overhead') {
      const exact = byId.get(`rollup-${type.width}x${type.height}`);
      if (exact) return exact;
      // Nearest roll-up door by opening area.
      const rollups = components.filter((c) => c.category === 'Roll-Up Doors' && c.size);
      if (!rollups.length) return null;
      const want = type.width * type.height;
      return rollups.reduce((a, b) =>
        Math.abs(b.size!.width * b.size!.height - want) < Math.abs(a.size!.width * a.size!.height - want) ? b : a,
      );
    }
    if (type.category === 'walk') return components.find((c) => c.category === 'Walk-In Doors') ?? null;
    if (type.category === 'window') return components.find((c) => c.category === 'Windows') ?? null;
    return null;
  };

  const openingCounts = new Map<string, number>();
  // Main walls and lean-to walls alike: an opening is priced wherever it is built.
  for (const wall of [...geo.walls, ...geo.leanTos.flatMap((lt) => lt.walls)]) {
    if (!wall.present) continue;
    for (const hole of wall.holes) {
      if (hole.type.resizable) {
        // Every framed opening is its own size, so it gets its own line.
        const w = hole.x1 - hole.x0;
        const h = hole.y1 - hole.y0;
        const each = round2(hole.type.price + (hole.type.pricePerSqFt ?? 0) * w * h);
        lines.push(
          line(
            catalog,
            `op-${hole.opening.id}`,
            hole.type.name,
            'Doors & Windows',
            1,
            'ea',
            each,
            `${w}' × ${h}' on the ${hole.opening.wall} wall`,
          ),
        );
      } else {
        openingCounts.set(hole.type.id, (openingCounts.get(hole.type.id) ?? 0) + 1);
      }
    }
  }
  for (const [catalogId, count] of openingCounts) {
    const type = catalog.openingTypes.find((o) => o.id === catalogId);
    if (!type) continue;

    const match = matchComponent(type);
    if (match) {
      lines.push({
        key: `op-${catalogId}`,
        label: match.label,
        detail: supplier.name,
        category: 'Doors & Windows',
        qty: count,
        unit: 'ea',
        unitPrice: match.price,
        total: round2(count * match.price),
        cost: round2(count * match.cost),
      });
    } else {
      lines.push(line(catalog, `op-${catalogId}`, type.name, 'Doors & Windows', count, 'ea', type.price));
      unpriced.push(`${type.name} is not stocked by ${supplier.name} — using catalog price`);
    }
  }

  // ── Add-ons ────────────────────────────────────────────────────────────────
  for (const id of cfg.optionIds) {
    const addOn = catalog.addOns.find((a) => a.id === id);
    if (!addOn) continue;
    const count = addOn.countable ? Math.max(1, cfg.quantities[id] ?? 1) : 1;
    const qty = round2(addOnQty(addOn, cfg, geo, count));
    if (qty <= 0) continue;
    lines.push(
      line(catalog, `add-${id}`, addOn.name, addOn.category, qty, BASIS_UNIT[addOn.basis], addOn.price),
    );
  }

  // ── Premium printed finishes ───────────────────────────────────────────────
  // Wood- and stone-look panels cost extra, but no book prints the upcharge
  // yet. Say so rather than invent one.
  const premium = new Set<string>();
  const finishOf = (id: string | null) => catalog.colors.find((c) => c.id === id);
  const walled = geo.walls.some((w) => w.present);
  for (const [id, surface] of [
    [cfg.roofColorId, 'roof'],
    [walled ? cfg.sidingColorId : null, 'walls'],
    [walled ? cfg.wainscotColorId : null, 'wainscot'],
  ] as const) {
    const c = finishOf(id);
    if (c && c.finish && c.finish !== 'metal') premium.add(`${c.name} (${c.finish}-look) on the ${surface}`);
  }
  for (const p of premium) unpriced.push(`premium finish ${p}`);

  // ── Roll-up ────────────────────────────────────────────────────────────────
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const discount = round2(subtotal * ((cfg.discountPct ?? 0) / 100));
  const freight = freightFor(catalog, catalog.rules.freight.defaultMiles);
  const freightCost = costFor(catalog, 'Freight', freight);
  const taxable = round2(subtotal - discount + freight);
  const tax = round2(taxable * taxRateFor(catalog, cfg));
  const total = round2(taxable + tax);

  const cost = round2(lines.reduce((s, l) => s + l.cost, 0) + freightCost);
  const revenue = taxable;
  const grossProfit = round2(revenue - cost);

  return {
    lines,
    unpriced,
    subtotal,
    discount,
    freight,
    taxable,
    tax,
    total,
    cost,
    grossProfit,
    marginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
  };
}

/** Estimated monthly payment on an amortizing loan for the quoted total. */
export function monthlyPayment(catalog: Catalog, total: number): number {
  const { months, apr, downPct } = catalog.rules.financing;
  const principal = total * (1 - downPct / 100);
  if (principal <= 0 || months <= 0) return 0;
  const r = apr / 100 / 12;
  if (r === 0) return round2(principal / months);
  const factor = Math.pow(1 + r, months);
  return round2((principal * r * factor) / (factor - 1));
}

export const money = (n: number, cents = false) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`;
