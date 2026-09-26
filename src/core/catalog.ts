// Catalog loading and starting configurations.
//
// The catalog ships as JSON. The internal admin screen can override it, and the
// override is persisted to localStorage until a real backend exists.

import rawCatalog from '../data/catalog.json';
import type { BuildingConfig, Catalog, Opening, WallId } from './types';
import { getSupplier } from './suppliers';

const STORAGE_KEY = 'bc.catalog.v1';

export const baseCatalog = rawCatalog as unknown as Catalog;

export function loadCatalog(): Catalog {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Catalog;
      // Ignore overrides written against an older catalog shape.
      if (parsed && parsed.version === baseCatalog.version) return parsed;
    }
  } catch {
    // Unreadable storage just falls back to the shipped catalog.
  }
  return baseCatalog;
}

export function saveCatalog(catalog: Catalog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // Non-fatal: the editor keeps working in memory for this session.
  }
}

export function resetCatalog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

let seq = 0;
export function newOpeningId(): string {
  seq += 1;
  return `o${Date.now().toString(36)}${seq.toString(36)}`;
}

/** Where a model's stock doors and windows go, as [catalogId, wall, offset, sill]. */
type Seed = [string, WallId, number | 'center', number | null];

const SEEDS: Record<string, Seed[]> = {
  'standard-garage': [
    ['oh-9x8', 'front', 'center', null],
    ['walk-3068', 'right', 3, null],
    ['win-4030', 'right', 14, null],
    ['win-4030', 'left', 14, null],
  ],
  'triple-garage': [
    ['oh-10x10', 'front', 4, null],
    ['oh-10x10', 'front', 16, null],
    ['walk-3068', 'right', 4, null],
    ['win-6040', 'right', 16, null],
  ],
  // A utility carport is an open cover with the back end closed in for storage.
  'utility-carport': [
    ['roll-8x8', 'back', 'center', null],
    ['walk-3068', 'right', 3, null],
  ],
  'free-standing': [['roll-8x8', 'front', 'center', null]],
  'standard-carport': [],
  'triple-carport': [],
};

function seedOpenings(modelId: string, catalog: Catalog, width: number, length: number): Opening[] {
  const seeds = SEEDS[modelId] ?? [];
  const out: Opening[] = [];
  for (const [catalogId, wall, offset, sill] of seeds) {
    const type = catalog.openingTypes.find((o) => o.id === catalogId);
    if (!type) continue;
    const wallLen = wall === 'front' || wall === 'back' ? width : length;
    const resolved = offset === 'center' ? (wallLen - type.width) / 2 : offset;
    // Skip seeds that do not fit the model's default footprint.
    if (resolved < 0 || resolved + type.width > wallLen) continue;
    out.push({
      id: newOpeningId(),
      catalogId,
      wall,
      offset: resolved,
      sill: sill ?? type.defaultSill,
    });
  }
  return out;
}

/** A sensible starting configuration for a model. */
export function defaultConfigFor(modelId: string, catalog: Catalog): BuildingConfig {
  const model = catalog.models.find((m) => m.id === modelId) ?? catalog.models[0];
  const d = model.defaults;
  const width = d.width ?? model.size.minWidth;
  const length = d.length ?? model.size.minLength;

  const supplier = getSupplier(d.supplierId ?? 'select-steel');
  // Snap the model's nominal size onto something the supplier actually prints.
  const roofBuild = d.roofBuild ?? model.allowedRoofBuilds[0];
  const onCenter = d.onCenter ?? 5;
  const nearest = (want: number, from: number[]) =>
    from.length ? from.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : want;

  return {
    modelId: model.id,
    supplierId: supplier.id,
    width: nearest(width, supplier.widths),
    length: nearest(length, supplier.lengthsFor(roofBuild, onCenter, nearest(width, supplier.widths))),
    eaveHeight: d.eaveHeight ?? model.baseEaveHeight,
    roofStyle: d.roofStyle ?? model.allowedRoofStyles[0],
    roofBuild: d.roofBuild ?? model.allowedRoofBuilds[0],
    pitch: d.pitch ?? model.basePitch,
    onCenter: d.onCenter ?? 5,
    gaugeId: d.gaugeId ?? catalog.gauges[0].id,
    certified: d.certified ?? false,
    enclosure: d.enclosure ?? model.allowedEnclosures[0],
    sidesClosed: d.sidesClosed ?? (d.enclosure ?? model.allowedEnclosures[0]) !== 'open',
    endsClosed: d.endsClosed ?? ((d.enclosure ?? model.allowedEnclosures[0]) === 'enclosed' ? 2 : (d.enclosure ?? model.allowedEnclosures[0]) === 'partial' ? 1 : 0),
    overhang: d.overhang ?? 0,
    wainscot: d.wainscot ?? false,
    sidingId: d.sidingId ?? catalog.sidings[0].id,
    sidingOrientation: d.sidingOrientation ?? 'horizontal',
    roofingId: d.roofingId ?? catalog.roofings[0].id,
    sidingColorId: d.sidingColorId ?? 'red',
    roofColorId: d.roofColorId ?? 'galvalume',
    trimColorId: d.trimColorId ?? 'bright-white',
    wainscotColorId: d.wainscotColorId ?? null,
    floorId: d.floorId ?? catalog.floors[0].id,
    gableOverhang: d.gableOverhang ?? 1,
    eaveOverhang: d.eaveOverhang ?? 1,
    openings: seedOpenings(model.id, catalog, width, length),
    optionIds: d.optionIds ?? ['anchors'],
    quantities: {},
    discountPct: 0,
  };
}
