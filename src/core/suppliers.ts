// Suppliers = manufacturers, one entry each.
//
// A manufacturer may publish several books (Select Steel prints one for
// 12'-30' and another for 32'-40'), but that is a detail of THEIR catalog, not
// a choice for whoever is quoting. Picking a width routes to the right book
// automatically, so the only decision in the UI is which company to buy from.
//
// Everything a book returns is COST — what we pay. Markup and per-item price
// overrides live in componentPricing.ts and pricing.ts, never here.

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
    perBow: Num; perLinearFoot: Num; rollUpDoors: Num; doorsAndWindows: Num;
    frameouts: Num; insulationPerSqFt: Num; mobileHomeAnchorEachAdditional: number;
    each: Num;
  };
};
const wide = wideRaw as unknown as {
  widths: number[]; lengths: number[]; base: Num; standardLegHeight: number;
  legHeight: { rows: Num2 }; sidesClosed: Num2; endClosed: Num2;
};
const sbsi = sbsiRaw as unknown as {
  widths: number[]; roofLengths: number[]; base: Num;
  legStyleByWidth: { minWidth: number; maxWidth: number; onCenter: number }[];
  legHeight: { rows: Num2; ladderLegsIncludedFromHeight: number };
  sidesClosed: { rows: Num2; verticalUpcharge: Num; verticalIncludedFromHeight: number };
  endClosed: { rows: Num2; verticalUpchargePerEnd: Num; verticalIncludedFromHeight: number };
  upgrades: { gauge12Framing: Num; deluxeVerticalWainscot: Num; custom: Num2 };
  rollUpDoors: Num; walkInDoors: Num; gridWindows: Num;
  frameouts: { endWall: Num; sideWall: Num; addDutch: number };
  insulationPerSqFt: Num; headerSealPerFt: number; addChainHoist: number;
  doorColorUpcharge: { default: number; black: number };
};

export interface CostLine {
  key: string;
  label: string;
  detail?: string;
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
  endsClosed: number;
  verticalSides: boolean;
  verticalEnds: boolean;
  pitch: number;
  overhang: number;
  gauge12: boolean;
  wainscot: boolean;
}

export interface SupplierQuote {
  lines: CostLine[];
  cost: number;
  unpriced: string[];
  bows: number;
}

/** One purchasable item from a manufacturer, at book cost. */
export interface ComponentDef {
  id: string;
  label: string;
  category: 'Roll-Up Doors' | 'Walk-In Doors' | 'Windows' | 'Frameouts' | 'Insulation' | 'Options';
  unit: 'ea' | 'sq ft' | 'lin ft';
  cost: number;
  /** Nominal opening size in feet, where the item is an opening. */
  size?: { width: number; height: number };
}

export interface SupplierLogo {
  /** Monogram shown until a real logo file is dropped in. */
  mark: string;
  color: string;
  /** Path under public/, e.g. "logos/select-steel.svg". Rendered when present. */
  file?: string;
}

export interface Supplier {
  id: string;
  name: string;
  logo: SupplierLogo;
  blurb: string;
  basePriceCovers: string;
  widths: number[];
  alwaysCertified: boolean;
  /** Availability is width-dependent, because width picks the book. */
  roofBuildsFor(width: number): RoofBuild[];
  onCentersFor(width: number): OnCenter[];
  legHeightsFor(width: number): number[];
  standardLegHeightFor(width: number): number;
  pitchesFor(width: number): number[];
  overhangsFor(width: number): number[];
  lengthsFor(roofBuild: RoofBuild, onCenter: OnCenter, width: number): number[];
  /** True when the book dictates frame spacing rather than offering a choice. */
  onCenterFixedFor(width: number): boolean;
  onCenterFor(width: number): OnCenter;
  quote(input: StructureInput): SupplierQuote;
  components(): ComponentDef[];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// ── Select Steel Buildings ───────────────────────────────────────────────────
// Two printed books behind one manufacturer: 12'-30' standard, 32'-40' wide.

const SELECT_WIDE_FROM = 32;
const isWide = (width: number) => width >= SELECT_WIDE_FROM;

function selectComponents(): ComponentDef[] {
  const s = select.shared;
  const out: ComponentDef[] = [];

  for (const [size, cost] of Object.entries(s.rollUpDoors)) {
    const [w, h] = size.split('x').map(Number);
    out.push({
      id: `rollup-${size}`,
      label: `Roll-Up Door ${w}′ × ${h}′`,
      category: 'Roll-Up Doors',
      unit: 'ea',
      cost,
      size: { width: w, height: h },
    });
  }

  const walk = { width: 3, height: 6.67 };
  out.push(
    { id: 'walk-mobile', label: 'Mobile Home Door 36″ × 80″', category: 'Walk-In Doors', unit: 'ea', cost: s.doorsAndWindows.mobileHomeDoor36x80, size: walk },
    { id: 'walk-6panel', label: '6-Panel Door 36″ × 80″', category: 'Walk-In Doors', unit: 'ea', cost: s.doorsAndWindows.sixPanelDoor36x80, size: walk },
    { id: 'walk-9lite', label: '9-Lite Door 36″ × 80″', category: 'Walk-In Doors', unit: 'ea', cost: s.doorsAndWindows.nineLiteDoor36x80, size: walk },
    { id: 'win-single', label: 'Single Pane Window 24″ × 36″', category: 'Windows', unit: 'ea', cost: s.doorsAndWindows.singlePaneWindow24x36, size: { width: 2, height: 3 } },
    { id: 'win-transom', label: 'Transom Window', category: 'Windows', unit: 'ea', cost: s.doorsAndWindows.transomWindow, size: { width: 4, height: 1.5 } },

    { id: 'fo-window', label: 'Frameout — Window', category: 'Frameouts', unit: 'ea', cost: s.frameouts.window },
    { id: 'fo-walk', label: 'Frameout — Walk-In Door', category: 'Frameouts', unit: 'ea', cost: s.frameouts.walkInDoor },
    { id: 'fo-gable-nodoor', label: 'Frameout on Gable, no door', category: 'Frameouts', unit: 'ea', cost: s.frameouts.gableWithoutDoor },
    { id: 'fo-side-door', label: 'Frameout on Side, with door', category: 'Frameouts', unit: 'ea', cost: s.frameouts.sideWithDoor },
    { id: 'fo-side-nodoor', label: 'Frameout on Side, no door', category: 'Frameouts', unit: 'ea', cost: s.frameouts.sideWithoutDoor },
    { id: 'fo-dutch', label: 'Dutch Openings (set of 2)', category: 'Frameouts', unit: 'ea', cost: s.frameouts.dutchOpeningsSetOf2 },

    { id: 'ins-vapor', label: 'Vapor Barrier', category: 'Insulation', unit: 'sq ft', cost: s.insulationPerSqFt.vaporBarrier },
    { id: 'ins-fg-quarter', label: '1/4″ Fiberglass', category: 'Insulation', unit: 'sq ft', cost: s.insulationPerSqFt.fiberglassQuarterInch },
    { id: 'ins-fg-2in', label: '2″ Fiberglass', category: 'Insulation', unit: 'sq ft', cost: s.insulationPerSqFt.fiberglassTwoInch },

    { id: 'opt-cupola', label: 'Cupola 30″ × 40″', category: 'Options', unit: 'ea', cost: s.each.cupola30x40 },
    { id: 'opt-wainscot', label: 'Vertical Wainscoting', category: 'Options', unit: 'lin ft', cost: s.perLinearFoot.verticalWainscoting },
    { id: 'opt-anchor', label: 'Mobile Home Anchor (each additional)', category: 'Options', unit: 'ea', cost: s.mobileHomeAnchorEachAdditional },
  );
  return out;
}

const selectSteel: Supplier = {
  id: 'select-steel',
  name: 'Select Steel Buildings',
  logo: { mark: 'SSB', color: '#1f3f77', file: 'logos/select-steel.svg' },
  blurb: "12'–40' wide · regular, boxed eave or vertical",
  basePriceCovers: 'Roof only; sides and ends are priced separately.',
  widths: [...select.onCenter['5'].widths, ...wide.widths],
  alwaysCertified: true,

  roofBuildsFor: (w) => (isWide(w) ? ['vertical'] : ['regular', 'boxed-eave', 'vertical']),
  onCentersFor: (w) => (isWide(w) ? [4] : [5, 4]),
  legHeightsFor: (w) => (isWide(w) ? range(8, 20) : range(7, 16)),
  standardLegHeightFor: (w) => (isWide(w) ? wide.standardLegHeight : 7),
  pitchesFor: (w) => (isWide(w) ? [3] : [3, 4, 5]),
  overhangsFor: (w) => (isWide(w) ? [0] : [0, 1]),
  onCenterFixedFor: (w) => isWide(w),
  onCenterFor: (w) => (isWide(w) ? 4 : 5),
  lengthsFor: (roofBuild, onCenter, width) =>
    isWide(width) ? wide.lengths : (select.onCenter[String(onCenter)]?.lengthsByRoof[roofBuild] ?? []),
  components: selectComponents,

  quote(input) {
    return isWide(input.width) ? quoteSelectWide(input) : quoteSelectStandard(input);
  },
};

function quoteSelectStandard(input: StructureInput): SupplierQuote {
  const lines: CostLine[] = [];
  const unpriced: string[] = [];
  const bows = bowCount(input.length, input.onCenter);

  const base = selectBase(input.roofBuild, input.width, input.length, input.onCenter);
  if (base.value == null) unpriced.push(base.reason!);
  else lines.push({
    key: 'base',
    label: `${input.width}' × ${input.length}' ${input.roofBuild.replace('-', ' ')} roof`,
    detail: `${bows} bows on ${input.onCenter}' centers · roof only`,
    cost: base.value,
    category: 'Structure',
  });

  const legs = selectLegHeightUpcharge(input.width, input.length, input.legHeight, input.onCenter);
  if (legs.value == null) unpriced.push(legs.reason!);
  else if (legs.value > 0) lines.push({
    key: 'legs',
    label: `${input.legHeight}' legs`,
    detail: `7' included${input.legHeight >= 14 ? ' · double leg + double baserail' : ''}`,
    cost: legs.value,
    category: 'Structure',
  });

  if (input.sidesClosed) {
    const sides = selectSidesClosed(input.length, input.legHeight, input.onCenter, input.verticalSides);
    if (sides.value == null) unpriced.push(sides.reason!);
    else lines.push({
      key: 'sides', label: 'Both sides closed',
      detail: input.verticalSides ? 'vertical panels' : 'horizontal panels',
      cost: sides.value, category: 'Walls',
    });
  }
  if (input.endsClosed > 0) {
    const end = selectEndClosed(input.width, input.legHeight, input.onCenter, input.verticalEnds);
    if (end.value == null) unpriced.push(end.reason!);
    else lines.push({
      key: 'ends',
      label: `${input.endsClosed === 2 ? 'Both ends' : 'One end'} closed`,
      detail: input.verticalEnds ? 'vertical panels' : 'horizontal panels',
      cost: end.value * input.endsClosed, category: 'Walls',
    });
  }

  if (input.pitch > 3) {
    const perBow = input.pitch === 4 ? select.shared.perBow.pitch4_12 : select.shared.perBow.pitch5_12;
    lines.push({
      key: 'pitch', label: `${input.pitch}/12 roof pitch`,
      detail: `$${perBow} per bow × ${bows}`, cost: perBow * bows, category: 'Upgrades',
    });
  }
  if (input.overhang >= 1) {
    lines.push({
      key: 'overhang', label: "1' overhang",
      detail: `$${select.shared.perBow.overhang1ft} per bow × ${bows}`,
      cost: select.shared.perBow.overhang1ft * bows, category: 'Upgrades',
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
      key: 'wainscot', label: 'Vertical wainscot',
      detail: `$${select.shared.perLinearFoot.verticalWainscoting}/linear ft × ${lf}'`,
      cost: select.shared.perLinearFoot.verticalWainscoting * lf, category: 'Upgrades',
    });
  }
  return { lines, cost: lines.reduce((s, l) => s + l.cost, 0), unpriced, bows };
}

function quoteSelectWide(input: StructureInput): SupplierQuote {
  const lines: CostLine[] = [];
  const unpriced: string[] = [];
  const bows = bowCount(input.length, 4);

  const base = wide.base[`${input.width}x${input.length}`];
  if (base == null) unpriced.push(`${input.width}' × ${input.length}' is not a priced size`);
  else lines.push({
    key: 'base', label: `${input.width}' × ${input.length}' vertical roof`,
    detail: `${bows} bows on 4' centers · roof only · 8' leg included`,
    cost: base, category: 'Structure',
  });

  if (input.legHeight > wide.standardLegHeight) {
    const v = wide.legHeight.rows[String(input.legHeight)]?.[String(input.length)];
    if (v == null) unpriced.push(`No leg-height price for ${input.legHeight}'`);
    else lines.push({
      key: 'legs', label: `${input.legHeight}' legs`,
      detail: input.legHeight >= 13 ? 'ladder leg' : 'double leg',
      cost: v, category: 'Structure',
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
      key: 'ends', label: `${input.endsClosed === 2 ? 'Both ends' : 'One end'} closed`,
      cost: v * input.endsClosed, category: 'Walls',
    });
  }
  return { lines, cost: lines.reduce((s, l) => s + l.cost, 0), unpriced, bows };
}

// ── SBSI certified clear span ────────────────────────────────────────────────

const frameLengthFor = (roofLength: number) => roofLength - 1;

function sbsiComponents(): ComponentDef[] {
  const out: ComponentDef[] = [];
  for (const [size, cost] of Object.entries(sbsi.rollUpDoors)) {
    const [w, h] = size.split('x').map(Number);
    out.push({
      id: `rollup-${size}`, label: `Roll-Up Door ${w}′ × ${h}′`,
      category: 'Roll-Up Doors', unit: 'ea', cost, size: { width: w, height: h },
    });
  }
  const walk = { width: 3, height: 6.67 };
  out.push(
    { id: 'walk-6panel-9lite', label: '6-Panel or 9-Lite Door', category: 'Walk-In Doors', unit: 'ea', cost: sbsi.walkInDoors.sixPanelOrNineLite, size: walk },
    { id: 'walk-solid', label: 'Solid Door with Threshold', category: 'Walk-In Doors', unit: 'ea', cost: sbsi.walkInDoors.solidWithThreshold, size: walk },
    { id: 'win-grid-white', label: 'Grid Window 30″ × 36″ White', category: 'Windows', unit: 'ea', cost: sbsi.gridWindows.white30x36, size: { width: 2.5, height: 3 } },
    { id: 'win-grid-black', label: 'Grid Window 30″ × 36″ Black', category: 'Windows', unit: 'ea', cost: sbsi.gridWindows.black30x36, size: { width: 2.5, height: 3 } },

    { id: 'fo-end-window', label: 'End Wall Frameout — Window', category: 'Frameouts', unit: 'ea', cost: sbsi.frameouts.endWall.window },
    { id: 'fo-end-walk', label: 'End Wall Frameout — Walk-In Door', category: 'Frameouts', unit: 'ea', cost: sbsi.frameouts.endWall.walkInDoor },
    { id: 'fo-end-garage', label: 'End Wall Frameout — Garage Door', category: 'Frameouts', unit: 'ea', cost: sbsi.frameouts.endWall.garageDoor },
    { id: 'fo-side-6-12', label: "Side Wall Frameout 6'–12'", category: 'Frameouts', unit: 'ea', cost: sbsi.frameouts.sideWall['6-12'] },
    { id: 'fo-side-13-16', label: "Side Wall Frameout 13'–16'", category: 'Frameouts', unit: 'ea', cost: sbsi.frameouts.sideWall['13-16'] },
    { id: 'fo-side-17-20', label: "Side Wall Frameout 17'–20'", category: 'Frameouts', unit: 'ea', cost: sbsi.frameouts.sideWall['17-20'] },
    { id: 'fo-dutch', label: 'Add Dutch to any Frameout', category: 'Frameouts', unit: 'ea', cost: sbsi.frameouts.addDutch },

    { id: 'ins-double-bubble', label: '1/4″ Double Bubble R-1.1', category: 'Insulation', unit: 'sq ft', cost: sbsi.insulationPerSqFt.doubleBubbleR1_1 },
    { id: 'ins-dripstop', label: 'Dripstop', category: 'Insulation', unit: 'sq ft', cost: sbsi.insulationPerSqFt.dripstop },
    { id: 'ins-fg-2in', label: '2″ Fiberglass R-6.89', category: 'Insulation', unit: 'sq ft', cost: sbsi.insulationPerSqFt.fiberglassTwoInchR6_89 },

    { id: 'opt-header-seal', label: 'Header Seal', category: 'Options', unit: 'lin ft', cost: sbsi.headerSealPerFt },
    { id: 'opt-chain-hoist', label: 'Add Chain Hoist', category: 'Options', unit: 'ea', cost: sbsi.addChainHoist },
    { id: 'opt-door-color', label: 'Roll-Up Door Color', category: 'Options', unit: 'ea', cost: sbsi.doorColorUpcharge.default },
    { id: 'opt-door-black', label: 'Roll-Up Door — Black', category: 'Options', unit: 'ea', cost: sbsi.doorColorUpcharge.black },
  );
  return out;
}

const sbsiSupplier: Supplier = {
  id: 'sbsi-clearspan',
  name: 'SBSI',
  logo: { mark: 'SBSI', color: '#9c1f26', file: 'logos/sbsi.svg' },
  blurb: "32'–60' clear span · certified 140 MPH / 35 PSF",
  basePriceCovers: 'Roof only; sides and ends priced separately. Frame is 1′ shorter than the stated roof length.',
  widths: sbsi.widths,
  alwaysCertified: true,

  roofBuildsFor: () => ['vertical'],
  onCentersFor: (w) => [sbsiSupplier.onCenterFor(w)],
  legHeightsFor: () => range(8, 20),
  standardLegHeightFor: () => 8,
  pitchesFor: () => [3, 4, 5],
  overhangsFor: () => [0, 1, 2],
  onCenterFixedFor: () => true,
  onCenterFor(width) {
    const band = sbsi.legStyleByWidth.find((b) => width >= b.minWidth && width <= b.maxWidth);
    return (band?.onCenter === 4 ? 4 : 5) as OnCenter;
  },
  lengthsFor: () => sbsi.roofLengths,
  components: sbsiComponents,

  quote(input) {
    const lines: CostLine[] = [];
    const unpriced: string[] = [];
    const frameLen = frameLengthFor(input.length);
    const oc = sbsiSupplier.onCenterFor(input.width);
    const bows = bowCount(frameLen, oc);

    const base = sbsi.base[`${input.width}x${input.length}`];
    if (base == null) unpriced.push(`${input.width}' × ${input.length}' is not a priced size`);
    else lines.push({
      key: 'base', label: `${input.width}' × ${input.length}' vertical roof`,
      detail: `${frameLen}' frame on ${oc}' centers · roof only · certified 140 MPH / 35 PSF`,
      cost: base, category: 'Structure',
    });

    if (input.legHeight > 8) {
      const v = sbsi.legHeight.rows[String(input.legHeight)]?.[String(frameLen)];
      if (v == null) unpriced.push(`Leg height ${input.legHeight}' is not printed for a ${frameLen}' frame`);
      else lines.push({
        key: 'legs', label: `${input.legHeight}' legs`,
        detail: input.legHeight >= sbsi.legHeight.ladderLegsIncludedFromHeight ? 'ladder legs included' : "8' included",
        cost: v, category: 'Structure',
      });
    }

    if (input.sidesClosed) {
      const v = sbsi.sidesClosed.rows[String(input.legHeight)]?.[String(frameLen)];
      if (v == null) unpriced.push(`No side price at ${input.legHeight}' × ${frameLen}' frame`);
      else {
        const needsUp = input.verticalSides && input.legHeight < sbsi.sidesClosed.verticalIncludedFromHeight;
        const up = needsUp ? (sbsi.sidesClosed.verticalUpcharge[String(frameLen)] ?? 0) : 0;
        lines.push({
          key: 'sides', label: 'Both sides closed',
          detail: input.verticalSides ? (needsUp ? 'vertical panels' : 'vertical included at this height') : 'horizontal panels',
          cost: v + up, category: 'Walls',
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
          key: 'ends', label: `${input.endsClosed === 2 ? 'Both ends' : 'One end'} closed`,
          detail: input.verticalEnds ? (needsUp ? 'vertical panels' : 'vertical included at this height') : 'horizontal panels',
          cost: (v + up) * input.endsClosed, category: 'Walls',
        });
      }
    }

    if (input.pitch === 4) {
      const v = sbsi.upgrades.custom.pitch4_12[String(input.length)];
      if (v != null) lines.push({ key: 'pitch', label: '4/12 roof pitch', cost: v, category: 'Upgrades' });
    } else if (input.pitch === 5) {
      const m = sbsi.upgrades.custom.pitch5_12_material[String(input.length)] ?? 0;
      const l = sbsi.upgrades.custom.pitch5_12_labor[String(input.length)] ?? 0;
      lines.push({ key: 'pitch', label: '5/12 roof pitch', detail: 'material + required labor', cost: m + l, category: 'Upgrades' });
    }
    if (input.overhang > 0) {
      const v = sbsi.upgrades.custom[input.overhang >= 2 ? 'overhang2ft' : 'overhang1ft'][String(input.length)];
      if (v != null) lines.push({
        key: 'overhang', label: `${input.overhang}' overhang`,
        detail: 'sides only; ends are a fixed 6″', cost: v, category: 'Upgrades',
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

export const SUPPLIERS: Supplier[] = [selectSteel, sbsiSupplier];

export function getSupplier(id: string): Supplier {
  return SUPPLIERS.find((s) => s.id === id) ?? SUPPLIERS[0];
}

/** Every manufacturer that prints this width. */
export function suppliersForWidth(width: number): Supplier[] {
  return SUPPLIERS.filter((s) => s.widths.includes(width));
}
