// Suppliers.
//
// Each supplier is a printed price book with its own sizes, roof builds and
// options. Everything a book returns is COST — what we pay. The markup that
// turns cost into a sell price lives in pricing.ts, never here.
//
// Restricting the configurator to sizes a book actually prints is deliberate:
// these matrices are not formulas, and a size that is not in the book is a
// size nobody has quoted.

import selectRaw from '../data/pricebooks/select-steel.json';
import wideRaw from '../data/pricebooks/select-steel-wide.json';
import sbsiRaw from '../data/pricebooks/sbsi-clearspan.json';
import type { OnCenter, RoofBuild } from './types';
import { bowCount, selectBase, selectEndClosed, selectLegHeightUpcharge, selectSidesClosed } from './pricebook';

type Num = Record<string, number>;
type Num2 = Record<string, Num>;

const select = selectRaw as unknown as {
  onCenter: Record<string, { lengthsByRoof: Record<string, number[]>; widths: number[]; options: { gauge12: Num } }>;
  shared: {
    perBow: Num;
    perLinearFoot: Num;
    rollUpDoors: Num;
    doorsAndWindows: Num;
    frameouts: Num;
    insulationPerSqFt: Num;
  };
};
const wide = wideRaw as unknown as {
  widths: number[]; lengths: number[]; base: Num; standardLegHeight: number;
  legHeight: { rows: Num2 }; sidesClosed: Num2; endClosed: Num2;
};
const sbsi = sbsiRaw as unknown as {
  widths: number[]; roofLengths: number[]; frameLengths: number[]; base: Num;
  legStyleByWidth: { minWidth: number; maxWidth: number; legStyle: string; onCenter: number }[];
  legHeight: { rows: Num2; ladderLegUpcharge: Num; ladderLegsIncludedFromHeight: number };
  sidesClosed: { rows: Num2; verticalUpcharge: Num; verticalIncludedFromHeight: number };
  endClosed: { rows: Num2; verticalUpchargePerEnd: Num; verticalIncludedFromHeight: number };
  upgrades: { gauge12Framing: Num; deluxeVerticalWainscot: Num; custom: Num2 };
  rollUpDoors: Num; walkInDoors: Num; gridWindows: Num;
  frameouts: { endWall: Num; sideWall: Num; addDutch: number };
  insulationPerSqFt: Num; headerSealPerFt: number;
};

export interface CostLine {
  key: string;
  label: string;
  detail?: string;
  /** What we pay. */
  cost: number;
  category: 'Structure' | 'Walls' | 'Upgrades' | 'Doors & Windows' | 'Options';
}

export interface StructureInput {
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
  pitch: number;
  /** Side overhang in feet: 0, 1 or 2. */
  overhang: number;
  gauge12: boolean;
  wainscot: boolean;
}

export interface SupplierQuote {
  lines: CostLine[];
  cost: number;
  /** Anything the book cannot price — stated, never guessed. */
  unpriced: string[];
  bows: number;
}

export interface Supplier {
  id: string;
  name: string;
  blurb: string;
  /** The book's own note about what it covers. */
  basePriceCovers: string;
  widths: number[];
  onCenters: OnCenter[];
  roofBuilds: RoofBuild[];
  legHeights: number[];
  standardLegHeight: number;
  standardPitch: number;
  pitches: number[];
  overhangs: number[];
  /** Every building from this book is engineer certified. */
  alwaysCertified: boolean;
  /** Frame spacing is fixed by width rather than chosen. */
  onCenterFixedByWidth: boolean;
  lengthsFor(roofBuild: RoofBuild, onCenter: OnCenter): number[];
  onCenterFor(width: number): OnCenter;
  quote(input: StructureInput): SupplierQuote;
  /** Component costs for things placed on the building. */
  rollUpDoors: Num;
  walkInDoors: Num;
  windows: Num;
  frameouts: Num;
  insulationPerSqFt: Num;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// ── Select Steel (12'-30') ───────────────────────────────────────────────────

const selectSteel: Supplier = {
  id: 'select-steel',
  name: 'Select Steel Buildings',
  blurb: "12'–30' wide · regular, boxed eave or vertical · 4' or 5' centers",
  basePriceCovers: 'Roof only; sides and ends are priced separately.',
  widths: select.onCenter['5'].widths,
  onCenters: [5, 4],
  roofBuilds: ['regular', 'boxed-eave', 'vertical'],
  legHeights: range(7, 16),
  standardLegHeight: 7,
  standardPitch: 3,
  pitches: [3, 4, 5],
  overhangs: [0, 1],
  alwaysCertified: true,
  onCenterFixedByWidth: false,
  lengthsFor: (roofBuild, onCenter) => select.onCenter[String(onCenter)]?.lengthsByRoof[roofBuild] ?? [],
  onCenterFor: () => 5,
  rollUpDoors: select.shared.rollUpDoors,
  walkInDoors: {
    'Mobile Home Door 36″ × 80″': select.shared.doorsAndWindows.mobileHomeDoor36x80,
    '6-Panel Door 36″ × 80″': select.shared.doorsAndWindows.sixPanelDoor36x80,
    '9-Lite Door 36″ × 80″': select.shared.doorsAndWindows.nineLiteDoor36x80,
  },
  windows: {
    'Single Pane 24″ × 36″': select.shared.doorsAndWindows.singlePaneWindow24x36,
    'Transom Window': select.shared.doorsAndWindows.transomWindow,
  },
  frameouts: select.shared.frameouts,
  insulationPerSqFt: select.shared.insulationPerSqFt,

  quote(input) {
    const lines: CostLine[] = [];
    const unpriced: string[] = [];
    const bows = bowCount(input.length, input.onCenter);

    const base = selectBase(input.roofBuild, input.width, input.length, input.onCenter);
    if (base.value == null) unpriced.push(base.reason!);
    else {
      lines.push({
        key: 'base',
        label: `${input.width}' × ${input.length}' ${input.roofBuild.replace('-', ' ')} roof`,
        detail: `${bows} bows on ${input.onCenter}' centers · roof only`,
        cost: base.value,
        category: 'Structure',
      });
    }

    const legs = selectLegHeightUpcharge(input.width, input.length, input.legHeight, input.onCenter);
    if (legs.value == null) unpriced.push(legs.reason!);
    else if (legs.value > 0) {
      lines.push({
        key: 'legs',
        label: `${input.legHeight}' legs`,
        detail: `7' included${input.legHeight >= 14 ? " · double leg + double baserail" : ''}`,
        cost: legs.value,
        category: 'Structure',
      });
    }

    if (input.sidesClosed) {
      const sides = selectSidesClosed(input.length, input.legHeight, input.onCenter, input.verticalSides);
      if (sides.value == null) unpriced.push(sides.reason!);
      else lines.push({
        key: 'sides',
        label: 'Both sides closed',
        detail: input.verticalSides ? 'vertical panels' : 'horizontal panels',
        cost: sides.value,
        category: 'Walls',
      });
    }

    if (input.endsClosed > 0) {
      const end = selectEndClosed(input.width, input.legHeight, input.onCenter, input.verticalEnds);
      if (end.value == null) unpriced.push(end.reason!);
      else lines.push({
        key: 'ends',
        label: `${input.endsClosed === 2 ? 'Both ends' : 'One end'} closed`,
        detail: input.verticalEnds ? 'vertical panels' : 'horizontal panels',
        cost: end.value * input.endsClosed,
        category: 'Walls',
      });
    }

    // Pitch and overhang are charged per bow in this book.
    if (input.pitch > 3) {
      const perBow = input.pitch === 4 ? select.shared.perBow.pitch4_12 : select.shared.perBow.pitch5_12;
      lines.push({
        key: 'pitch',
        label: `${input.pitch}/12 roof pitch`,
        detail: `$${perBow} per bow × ${bows}`,
        cost: perBow * bows,
        category: 'Upgrades',
      });
    }
    if (input.overhang >= 1) {
      lines.push({
        key: 'overhang',
        label: "1' overhang",
        detail: `$${select.shared.perBow.overhang1ft} per bow × ${bows}`,
        cost: select.shared.perBow.overhang1ft * bows,
        category: 'Upgrades',
      });
      if (input.overhang > 1) unpriced.push("2' overhang is not priced in this book");
    }
    if (input.gauge12) {
      const g = select.onCenter[String(input.onCenter)].options.gauge12[String(input.length)];
      if (g == null) unpriced.push('No 12 gauge price at this length');
      else lines.push({ key: 'gauge', label: '12 gauge framing', cost: g, category: 'Upgrades' });
    }
    if (input.wainscot) {
      const lf = 2 * (input.length + input.width);
      lines.push({
        key: 'wainscot',
        label: 'Vertical wainscot',
        detail: `$${select.shared.perLinearFoot.verticalWainscoting}/linear ft × ${lf}'`,
        cost: select.shared.perLinearFoot.verticalWainscoting * lf,
        category: 'Upgrades',
      });
    }

    return { lines, cost: lines.reduce((s, l) => s + l.cost, 0), unpriced, bows };
  },
};

// ── Select Steel wide (32'-40') ──────────────────────────────────────────────

const selectWide: Supplier = {
  id: 'select-steel-wide',
  name: 'Select Steel — Wide',
  blurb: "32'–40' wide · vertical roof · 4' centers · 8' standard leg",
  basePriceCovers: 'Roof only; sides and ends are priced separately.',
  widths: wide.widths,
  onCenters: [4],
  roofBuilds: ['vertical'],
  legHeights: range(8, 20),
  standardLegHeight: wide.standardLegHeight,
  standardPitch: 3,
  pitches: [3],
  overhangs: [0],
  alwaysCertified: true,
  onCenterFixedByWidth: true,
  lengthsFor: () => wide.lengths,
  onCenterFor: () => 4,
  rollUpDoors: select.shared.rollUpDoors,
  walkInDoors: selectSteel.walkInDoors,
  windows: selectSteel.windows,
  frameouts: select.shared.frameouts,
  insulationPerSqFt: select.shared.insulationPerSqFt,

  quote(input) {
    const lines: CostLine[] = [];
    const unpriced: string[] = [];
    const bows = bowCount(input.length, 4);

    const base = wide.base[`${input.width}x${input.length}`];
    if (base == null) unpriced.push(`${input.width}' × ${input.length}' is not a priced size`);
    else lines.push({
      key: 'base',
      label: `${input.width}' × ${input.length}' vertical roof`,
      detail: `${bows} bows on 4' centers · roof only · 8' leg included`,
      cost: base,
      category: 'Structure',
    });

    if (input.legHeight > wide.standardLegHeight) {
      const v = wide.legHeight.rows[String(input.legHeight)]?.[String(input.length)];
      if (v == null) unpriced.push(`No leg-height price for ${input.legHeight}'`);
      else lines.push({
        key: 'legs',
        label: `${input.legHeight}' legs`,
        detail: input.legHeight >= 13 ? 'ladder leg' : 'double leg',
        cost: v,
        category: 'Structure',
      });
    }

    if (input.sidesClosed) {
      const v = wide.sidesClosed[String(input.legHeight)]?.[String(input.length)];
      if (v == null) unpriced.push(`No side price at ${input.legHeight}' × ${input.length}'`);
      else lines.push({ key: 'sides', label: 'Both sides closed', cost: v, category: 'Walls' });
    }
    if (input.endsClosed > 0) {
      const v = wide.endClosed[String(input.legHeight)]?.[String(input.width)];
      if (v == null) unpriced.push(`No end price at ${input.legHeight}' × ${input.width}'`);
      else lines.push({
        key: 'ends',
        label: `${input.endsClosed === 2 ? 'Both ends' : 'One end'} closed`,
        cost: v * input.endsClosed,
        category: 'Walls',
      });
    }
    return { lines, cost: lines.reduce((s, l) => s + l.cost, 0), unpriced, bows };
  },
};

// ── SBSI certified clear span (32'-60') ──────────────────────────────────────

/** SBSI's frame is one foot shorter than the stated roof length. */
const frameLengthFor = (roofLength: number) => roofLength - 1;

const sbsiSupplier: Supplier = {
  id: 'sbsi-clearspan',
  name: 'SBSI Certified Clear Span',
  blurb: "32'–60' wide · vertical roof · certified 140 MPH / 35 PSF",
  basePriceCovers: 'Roof only; sides and ends are priced separately. Frame is 1′ shorter than the stated roof length.',
  widths: sbsi.widths,
  onCenters: [5, 4],
  roofBuilds: ['vertical'],
  legHeights: range(8, 20),
  standardLegHeight: 8,
  standardPitch: 3,
  pitches: [3, 4, 5],
  overhangs: [0, 1, 2],
  alwaysCertified: true,
  onCenterFixedByWidth: true,
  lengthsFor: () => sbsi.roofLengths,
  onCenterFor(width) {
    const band = sbsi.legStyleByWidth.find((b) => width >= b.minWidth && width <= b.maxWidth);
    return (band?.onCenter === 4 ? 4 : 5) as OnCenter;
  },
  rollUpDoors: sbsi.rollUpDoors,
  walkInDoors: {
    '6-Panel or 9-Lite': sbsi.walkInDoors.sixPanelOrNineLite,
    'Solid with Threshold': sbsi.walkInDoors.solidWithThreshold,
  },
  windows: {
    'Grid Window 30″ × 36″ White': sbsi.gridWindows.white30x36,
    'Grid Window 30″ × 36″ Black': sbsi.gridWindows.black30x36,
  },
  frameouts: { ...sbsi.frameouts.endWall, addDutch: sbsi.frameouts.addDutch },
  insulationPerSqFt: sbsi.insulationPerSqFt,

  quote(input) {
    const lines: CostLine[] = [];
    const unpriced: string[] = [];
    const frameLen = frameLengthFor(input.length);
    const oc = sbsiSupplier.onCenterFor(input.width);
    const bows = bowCount(frameLen, oc);

    const base = sbsi.base[`${input.width}x${input.length}`];
    if (base == null) unpriced.push(`${input.width}' × ${input.length}' is not a priced size`);
    else lines.push({
      key: 'base',
      label: `${input.width}' × ${input.length}' vertical roof`,
      detail: `${frameLen}' frame on ${oc}' centers · roof only · certified 140 MPH / 35 PSF`,
      cost: base,
      category: 'Structure',
    });

    if (input.legHeight > sbsiSupplier.standardLegHeight) {
      const v = sbsi.legHeight.rows[String(input.legHeight)]?.[String(frameLen)];
      if (v == null) {
        unpriced.push(`Leg height ${input.legHeight}' is not printed for a ${frameLen}' frame`);
      } else {
        lines.push({
          key: 'legs',
          label: `${input.legHeight}' legs`,
          detail: input.legHeight >= sbsi.legHeight.ladderLegsIncludedFromHeight
            ? 'ladder legs included'
            : "8' included",
          cost: v,
          category: 'Structure',
        });
      }
    }

    if (input.sidesClosed) {
      const v = sbsi.sidesClosed.rows[String(input.legHeight)]?.[String(frameLen)];
      if (v == null) unpriced.push(`No side price at ${input.legHeight}' × ${frameLen}' frame`);
      else {
        const needsUp = input.verticalSides && input.legHeight < sbsi.sidesClosed.verticalIncludedFromHeight;
        const up = needsUp ? (sbsi.sidesClosed.verticalUpcharge[String(frameLen)] ?? 0) : 0;
        lines.push({
          key: 'sides',
          label: 'Both sides closed',
          detail: input.verticalSides
            ? (needsUp ? 'vertical panels' : 'vertical panels included at this height')
            : 'horizontal panels',
          cost: v + up,
          category: 'Walls',
        });
      }
    }

    if (input.endsClosed > 0) {
      const v = sbsi.endClosed.rows[String(input.width)]?.[String(input.legHeight)];
      if (v == null) unpriced.push(`No end price at ${input.legHeight}' × ${input.width}'`);
      else {
        const band = input.width <= 40 ? '32-40' : '42-60';
        const needsUp = input.verticalEnds && input.legHeight < sbsi.endClosed.verticalIncludedFromHeight;
        const up = needsUp ? (sbsi.endClosed.verticalUpchargePerEnd[band] ?? 0) : 0;
        lines.push({
          key: 'ends',
          label: `${input.endsClosed === 2 ? 'Both ends' : 'One end'} closed`,
          detail: input.verticalEnds
            ? (needsUp ? 'vertical panels' : 'vertical ends included at this height')
            : 'horizontal panels',
          cost: (v + up) * input.endsClosed,
          category: 'Walls',
        });
      }
    }

    // SBSI charges pitch and overhang by roof length, not per bow.
    if (input.pitch === 4) {
      const v = sbsi.upgrades.custom.pitch4_12[String(input.length)];
      if (v != null) lines.push({ key: 'pitch', label: '4/12 roof pitch', cost: v, category: 'Upgrades' });
    } else if (input.pitch === 5) {
      const m = sbsi.upgrades.custom.pitch5_12_material[String(input.length)] ?? 0;
      const l = sbsi.upgrades.custom.pitch5_12_labor[String(input.length)] ?? 0;
      lines.push({
        key: 'pitch',
        label: '5/12 roof pitch',
        detail: 'material + required labor',
        cost: m + l,
        category: 'Upgrades',
      });
    }
    if (input.overhang > 0) {
      const key = input.overhang >= 2 ? 'overhang2ft' : 'overhang1ft';
      const v = sbsi.upgrades.custom[key][String(input.length)];
      if (v != null) lines.push({
        key: 'overhang',
        label: `${input.overhang}' overhang`,
        detail: "sides only; ends are a fixed 6″",
        cost: v,
        category: 'Upgrades',
      });
    }
    if (input.gauge12) {
      const v = sbsi.upgrades.gauge12Framing[String(frameLen)];
      if (v == null) unpriced.push('No 12 gauge price at this length');
      else lines.push({ key: 'gauge', label: '12 gauge galvanized framing', cost: v, category: 'Upgrades' });
    }
    if (input.wainscot) {
      const v = sbsi.upgrades.deluxeVerticalWainscot[String(frameLen)];
      if (v == null) unpriced.push('No wainscot price at this length');
      else lines.push({ key: 'wainscot', label: 'Deluxe vertical wainscot', cost: v, category: 'Upgrades' });
    }

    return { lines, cost: lines.reduce((s, l) => s + l.cost, 0), unpriced, bows };
  },
};

// ── Registry ─────────────────────────────────────────────────────────────────

export const SUPPLIERS: Supplier[] = [selectSteel, selectWide, sbsiSupplier];

export function getSupplier(id: string): Supplier {
  return SUPPLIERS.find((s) => s.id === id) ?? SUPPLIERS[0];
}

/** Every supplier that prints this width. */
export function suppliersForWidth(width: number): Supplier[] {
  return SUPPLIERS.filter((s) => s.widths.includes(width));
}
