// Price-book lookup.
//
// These buildings are not priced by a formula — they are priced from printed
// matrices. This module reads those matrices; it makes no business decisions
// about which book applies or what margin sits on top.
//
// The one real insight worth knowing: the "4 ft OC" and "5 ft OC" Select Steel
// books are the SAME table indexed by BOW COUNT, not by length. Every one of
// the 80 cells where they overlap agrees exactly. A 40' building on 5' centers
// and a 32' building on 4' centers both have 9 bows and both cost the same.
// So 4' OC is not a multiplier — it simply buys more bows for a given length.

import selectRaw from '../data/pricebooks/select-steel.json';
import sbsiRaw from '../data/pricebooks/sbsi-clearspan.json';
import wideRaw from '../data/pricebooks/select-steel-wide.json';
import type { OnCenter, RoofBuild } from './types';

type Row = Record<string, number>;
type Grid = Record<string, Row>;

const select = selectRaw as unknown as {
  standardLegHeight: number;
  standardPitch: number;
  doubleLegFromHeight: number;
  onCenter: Record<string, {
    lengths: number[];
    lengthsByRoof: Record<string, number[]>;
    widths: number[];
    base: Record<string, Row>;
    /** band -> leg height -> length -> upcharge */
    legHeight: Record<string, Grid>;
    sidesClosed: Grid;
    sidesVerticalUpcharge: Grid;
    endClosed: Grid;
    endClosedWide: Grid;
    endVerticalPerEnd: Row;
    options: Record<string, unknown>;
  }>;
  shared: Record<string, unknown>;
};

const sbsi = sbsiRaw as unknown as Record<string, unknown>;
const wide = wideRaw as unknown as Record<string, unknown>;

export { select as selectBook, sbsi as sbsiBook, wide as selectWideBook };

// ── Bow arithmetic ───────────────────────────────────────────────────────────

/** Bows in a building of this length at this frame spacing. */
export function bowCount(length: number, onCenter: OnCenter): number {
  return Math.round(length / onCenter) + 1;
}

/** Length spanned by a given number of bows. */
export function lengthForBows(bows: number, onCenter: OnCenter): number {
  return (bows - 1) * onCenter;
}

/**
 * The Select Steel base table collapsed onto (roofBuild, width, bows).
 * Built once and asserted for agreement across the two on-center books.
 */
const unifiedBase: Record<string, Record<string, number>> = {};
const unifiedLegHeight: Record<string, Record<string, number>> = {};

(function buildUnified() {
  for (const oc of [5, 4] as const) {
    const b = select.onCenter[String(oc)];
    for (const roof of Object.keys(b.base)) {
      for (const len of b.lengthsByRoof[roof]) {
        for (const w of b.widths) {
          const v = b.base[roof][`${w}x${len}`];
          if (v == null) continue;
          const key = `${roof}|${w}|${bowCount(len, oc)}`;
          unifiedBase[roof] ??= {};
          const prior = unifiedBase[roof][`${w}|${bowCount(len, oc)}`];
          if (prior != null && prior !== v) {
            // Never seen in the shipped data; guard against a future edit.
            console.warn(`price book disagreement at ${key}: ${prior} vs ${v}`);
          }
          unifiedBase[roof][`${w}|${bowCount(len, oc)}`] = v;
        }
      }
    }
    // Leg height is bow-indexed too, but only the 12-24 band is consistent
    // between the books; see `legHeightNote`.
    const band = oc === 5 ? '12-24' : '12-30';
    const rows = b.legHeight[band];
    if (!rows) continue;
    for (const [h, byLen] of Object.entries(rows)) {
      for (const [len, v] of Object.entries(byLen)) {
        unifiedLegHeight[h] ??= {};
        unifiedLegHeight[h][String(bowCount(Number(len), oc))] = v;
      }
    }
  }
})();

export const legHeightNote =
  "The 4' OC book reprints the 12-24 leg-height table on its 26-30 page, where the " +
  "5' OC book uses higher figures. Treated as a publisher error: the 26-30 band uses " +
  "its own 5' OC table when available.";

// ── Availability ─────────────────────────────────────────────────────────────

export function selectWidths(): number[] {
  return select.onCenter['5'].widths;
}

/** Lengths actually printed for this roof build at this spacing. */
export function selectLengths(roofBuild: RoofBuild, onCenter: OnCenter): number[] {
  const b = select.onCenter[String(onCenter)];
  return b?.lengthsByRoof[roofBuild] ?? [];
}

export const selectStandardLegHeight = select.standardLegHeight;
export const selectStandardPitch = select.standardPitch;
export const selectDoubleLegFromHeight = select.doubleLegFromHeight;

/** Leg heights the book prices (7' standard through 16'). */
export function selectLegHeights(): number[] {
  return Object.keys(select.onCenter['5'].sidesClosed).map(Number).sort((a, b) => a - b);
}

// ── Lookups ──────────────────────────────────────────────────────────────────

function widthBand(width: number): '12-24' | '26-30' | null {
  if (width >= 12 && width <= 24) return '12-24';
  if (width >= 26 && width <= 30) return '26-30';
  return null;
}

export interface Lookup {
  value: number | null;
  /** Why the lookup failed, for the UI to show rather than guess a price. */
  reason?: string;
}

/** Base (roof-only, open on all four sides) price. */
export function selectBase(roofBuild: RoofBuild, width: number, length: number, onCenter: OnCenter): Lookup {
  const bows = bowCount(length, onCenter);
  const table = unifiedBase[roofBuild];
  if (!table) return { value: null, reason: `No ${roofBuild} pricing in this book` };
  const v = table[`${width}|${bows}`];
  if (v == null) {
    return { value: null, reason: `${width}' × ${length}' (${bows} bows) is not a priced size` };
  }
  return { value: v };
}

/** Upcharge over the 7' standard leg. */
export function selectLegHeightUpcharge(width: number, length: number, legHeight: number, onCenter: OnCenter): Lookup {
  if (legHeight <= select.standardLegHeight) return { value: 0 };
  const band = widthBand(width);
  if (!band) return { value: null, reason: `${width}' is outside this book` };

  // Prefer the band's own printed table; fall back to the bow-indexed union.
  const printed = select.onCenter[String(onCenter)].legHeight[band]
    ?? select.onCenter['5'].legHeight[band];
  const byLen = printed?.[String(legHeight)];
  if (byLen) {
    const direct = byLen[String(length)];
    if (direct != null) return { value: direct };
  }
  const uni = unifiedLegHeight[String(legHeight)]?.[String(bowCount(length, onCenter))];
  if (uni != null) return { value: uni };
  return { value: null, reason: `No leg-height price for ${legHeight}' at ${length}'` };
}

/** Closing BOTH sides. The book prices the pair, not one side. */
export function selectSidesClosed(length: number, legHeight: number, onCenter: OnCenter, vertical: boolean): Lookup {
  const b = select.onCenter[String(onCenter)];
  const base = b.sidesClosed[String(legHeight)]?.[String(length)];
  if (base == null) return { value: null, reason: `No side price for ${legHeight}' × ${length}'` };
  if (!vertical) return { value: base };

  const bandKey = legHeight <= 8 ? '7-8' : legHeight <= 14 ? '9-14' : '15-16';
  const up = b.sidesVerticalUpcharge[bandKey]?.[String(length)] ?? 0;
  return { value: base + up };
}

/** Closing ONE end. */
export function selectEndClosed(width: number, legHeight: number, onCenter: OnCenter, vertical: boolean): Lookup {
  const b = select.onCenter[String(onCenter)];
  const band = widthBand(width);
  if (!band) return { value: null, reason: `${width}' is outside this book` };
  const table = band === '12-24' ? b.endClosed : b.endClosedWide;
  const base = table[String(legHeight)]?.[String(width)];
  if (base == null) return { value: null, reason: `No end price for ${legHeight}' × ${width}'` };
  if (!vertical) return { value: base };
  return { value: base + (b.endVerticalPerEnd[String(width)] ?? 0) };
}

// ── Composite ────────────────────────────────────────────────────────────────

export interface BookQuoteInput {
  roofBuild: RoofBuild;
  width: number;
  length: number;
  onCenter: OnCenter;
  legHeight: number;
  sidesClosed: boolean;
  /** 0, 1 or 2 gable ends closed in. */
  endsClosed: number;
  verticalSides: boolean;
  verticalEnds: boolean;
}

export interface BookLine {
  key: string;
  label: string;
  detail?: string;
  amount: number;
}

export interface BookQuote {
  lines: BookLine[];
  total: number;
  /** Anything the book could not price, stated rather than guessed. */
  unpriced: string[];
  bows: number;
}

/** Price a building straight out of the Select Steel book. */
export function quoteFromSelectBook(input: BookQuoteInput): BookQuote {
  const { roofBuild, width, length, onCenter, legHeight } = input;
  const lines: BookLine[] = [];
  const unpriced: string[] = [];
  const bows = bowCount(length, onCenter);

  const base = selectBase(roofBuild, width, length, onCenter);
  if (base.value == null) unpriced.push(base.reason!);
  else {
    lines.push({
      key: 'base',
      label: `${width}' × ${length}' ${roofBuild.replace('-', ' ')} roof`,
      detail: `${bows} bows on ${onCenter}' centers · roof only`,
      amount: base.value,
    });
  }

  const legs = selectLegHeightUpcharge(width, length, legHeight, onCenter);
  if (legs.value == null) unpriced.push(legs.reason!);
  else if (legs.value > 0) {
    lines.push({
      key: 'legs',
      label: `${legHeight}' legs`,
      detail: `${select.standardLegHeight}' included${legHeight >= select.doubleLegFromHeight ? ' · double leg + double baserail' : ''}`,
      amount: legs.value,
    });
  }

  if (input.sidesClosed) {
    const sides = selectSidesClosed(length, legHeight, onCenter, input.verticalSides);
    if (sides.value == null) unpriced.push(sides.reason!);
    else {
      lines.push({
        key: 'sides',
        label: 'Both sides closed',
        detail: input.verticalSides ? 'vertical panels' : 'horizontal panels',
        amount: sides.value,
      });
    }
  }

  if (input.endsClosed > 0) {
    const end = selectEndClosed(width, legHeight, onCenter, input.verticalEnds);
    if (end.value == null) unpriced.push(end.reason!);
    else {
      lines.push({
        key: 'ends',
        label: `${input.endsClosed === 2 ? 'Both ends' : 'One end'} closed`,
        detail: input.verticalEnds ? 'vertical panels' : 'horizontal panels',
        amount: end.value * input.endsClosed,
      });
    }
  }

  return {
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    unpriced,
    bows,
  };
}
