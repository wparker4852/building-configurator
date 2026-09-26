// Per-component sell prices, per manufacturer.
//
// Cost comes from the supplier's price book and is never edited here. Price is
// editable, and margin is always derived from the two — never stored — so the
// three can't drift out of agreement.
//
//   margin % = (price - cost) / price * 100        <- margin on the sell price
//   price    = cost / (1 - margin/100)             <- the inverse, for editing margin
//
// Overrides live in localStorage until there is a backend; this file is the
// only place that touches storage.

import type { ComponentDef, Supplier } from './suppliers';

const KEY = 'bc.componentPrices.v1';

/** `${supplierId}:${componentId}` -> sell price. */
type Overrides = Record<string, number>;

function readAll(): Overrides {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Overrides) : {};
  } catch {
    return {};
  }
}

function writeAll(next: Overrides): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked; edits still apply for this session via the caller's state.
  }
}

const keyOf = (supplierId: string, componentId: string) => `${supplierId}:${componentId}`;

/** Margin on the sell price, as a percentage. */
export function marginOf(cost: number, price: number): number {
  if (!price) return 0;
  return ((price - cost) / price) * 100;
}

/** The price that yields a given margin on the sell price. */
export function priceForMargin(cost: number, marginPct: number): number {
  const m = Math.min(Math.max(marginPct, -500), 95) / 100;
  return round2(cost / (1 - m));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PricedComponent extends ComponentDef {
  price: number;
  marginPct: number;
  /** True when this row has been edited away from the default markup. */
  overridden: boolean;
}

/**
 * Every component for a supplier, with its current sell price.
 * Unedited rows fall back to cost plus the catalog's default markup.
 */
export function pricedComponents(supplier: Supplier, defaultMarkupPct: number): PricedComponent[] {
  const overrides = readAll();
  return supplier.components().map((c) => {
    const override = overrides[keyOf(supplier.id, c.id)];
    const price = override ?? round2(c.cost * (1 + defaultMarkupPct / 100));
    return {
      ...c,
      price,
      marginPct: marginOf(c.cost, price),
      overridden: override != null,
    };
  });
}

/** One component's sell price, or null when the supplier does not carry it. */
export function componentPrice(
  supplier: Supplier,
  componentId: string,
  defaultMarkupPct: number,
): PricedComponent | null {
  return pricedComponents(supplier, defaultMarkupPct).find((c) => c.id === componentId) ?? null;
}

export function setComponentPrice(supplierId: string, componentId: string, price: number): void {
  const all = readAll();
  all[keyOf(supplierId, componentId)] = round2(Math.max(0, price));
  writeAll(all);
}

/** Apply one margin across every component a supplier carries. */
export function setMarginForSupplier(supplier: Supplier, marginPct: number): void {
  const all = readAll();
  for (const c of supplier.components()) {
    all[keyOf(supplier.id, c.id)] = priceForMargin(c.cost, marginPct);
  }
  writeAll(all);
}

/** Drop every override for a supplier, returning its rows to the default markup. */
export function resetSupplierPrices(supplier: Supplier): void {
  const all = readAll();
  for (const c of supplier.components()) delete all[keyOf(supplier.id, c.id)];
  writeAll(all);
}

export function resetAllPrices(): void {
  writeAll({});
}

/** Everything currently overridden, for export or backup. */
export function exportOverrides(): Overrides {
  return readAll();
}

export function componentsToCsv(supplier: Supplier, rows: PricedComponent[]): string {
  const cols = ['supplier', 'category', 'item', 'unit', 'cost', 'price', 'marginPct'];
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    cols.join(','),
    ...rows.map((r) =>
      [supplier.name, r.category, r.label, r.unit, r.cost, r.price, r.marginPct.toFixed(1)]
        .map(cell)
        .join(','),
    ),
  ].join('\r\n');
}
