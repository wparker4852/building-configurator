// Domain model for the building configurator.
//
// Units are FEET everywhere, including the 3D scene (1 three.js unit = 1 ft).
// Money is plain numbers in USD.
//
// Axis convention:
//   +X = building width (the gable-end span)
//   +Z = building length (the direction the ridge runs)
//   +Y = up
// The building is centered on the origin, sitting on y = 0.

export type RoofStyleId = 'gable' | 'single-slope' | 'gambrel';
export type Enclosure = 'enclosed' | 'partial' | 'open';

/**
 * How the roof is built — the primary choice in tube-steel buildings, and a
 * separate axis from the roof's silhouette:
 *   regular     rounded eaves, panels run horizontally (lengthwise)
 *   boxed-eave  squared A-frame eaves, panels still run horizontally
 *   vertical    squared A-frame eaves, panels run ridge-to-eave over purlins
 */
export type RoofBuild = 'regular' | 'boxed-eave' | 'vertical';

/** Which way corrugated panels run. */
export type PanelOrientation = 'horizontal' | 'vertical';

/** Frame (leg/bow) spacing in feet. 4' is required for most certifications. */
export type OnCenter = 4 | 5;
export type WallId = 'front' | 'back' | 'left' | 'right';
export type TextureKind = 'ribbed' | 'lap' | 'shingle' | 'smooth' | 'board-batten';

export const WALL_IDS: WallId[] = ['front', 'back', 'left', 'right'];

/**
 * How the sidewall legs are built. Tall buildings double the leg, and taller
 * still spread the pair apart and weld rungs between them (a ladder leg).
 * Which one applies is the supplier's call; see `Supplier.legStyleFor`.
 */
export type LegStyle = 'single' | 'double' | 'ladder';

/**
 * Something parked on the 2D floor plan to check fit — a truck, a lift, a
 * workbench. Positions are in feet from the building center, +x toward the
 * right wall and +y toward the front. Not priced; it travels with the design
 * so a salesperson sees the same layout the customer drew.
 */
export interface PlanItem {
  id: string;
  /** References a FLOOR_PLAN_ITEMS preset id, or 'custom'. */
  kind: string;
  label: string;
  /** Footprint in feet: w across, h along the item's own length. */
  w: number;
  h: number;
  x: number;
  y: number;
  /** Height in feet, for the 3D stand-in and the headroom check. */
  tall?: number;
  /** Degrees, multiples of 90. */
  rot: number;
  color: string;
}

/** A door or window placed on a wall. */
export interface Opening {
  /** Instance id, unique within the config. */
  id: string;
  /** References OpeningType.id in the catalog. */
  catalogId: string;
  wall: WallId;
  /**
   * Distance in feet from the LEFT edge of the wall to the left edge of the
   * opening, as seen by someone standing outside looking at that wall.
   */
  offset: number;
  /**
   * Height in feet from the floor to the bottom of the opening. Forced to 0
   * for anything a person or vehicle drives/walks through.
   */
  sill: number;
  /** Set only on resizable types (framed openings); otherwise the catalog rules. */
  width?: number;
  height?: number;
}

/** The complete, serializable description of a building. */
export interface BuildingConfig {
  modelId: string;
  /** Which price book this building is quoted from. */
  supplierId: string;
  width: number;
  length: number;
  /** Wall height at the eave (the low side of the roof). */
  eaveHeight: number;
  /** The silhouette. */
  roofStyle: RoofStyleId;
  /** How the roof is built: rounded, boxed eave, or vertical panels. */
  roofBuild: RoofBuild;
  /** Roof rise per 12 units of run. For gambrel this is the UPPER slope. */
  pitch: number;
  /** Frame spacing, 4 or 5 feet on center. */
  onCenter: OnCenter;
  gaugeId: string;
  /** Wind/snow certified build. */
  certified: boolean;
  /**
   * The books price the two sides as a pair and each gable end on its own, so
   * that is how the config models it. `enclosure` is derived from these.
   */
  sidesClosed: boolean;
  /** How many gable ends are closed in: 0, 1 or 2. */
  endsClosed: number;
  /** Side overhang in feet. Ends are fixed by the supplier. */
  overhang: number;
  /** Charge the wainscot upgrade. */
  wainscot: boolean;
  enclosure: Enclosure;
  sidingId: string;
  /** Which way the wall panels run. */
  sidingOrientation: PanelOrientation;
  /** Contrasting band around the base of the walls; null for none. */
  wainscotColorId: string | null;
  roofingId: string;
  sidingColorId: string;
  roofColorId: string;
  trimColorId: string;
  floorId: string;
  /** Roof projection past the endwalls, in feet. */
  gableOverhang: number;
  /** Roof projection past the sidewalls, in feet. */
  eaveOverhang: number;
  openings: Opening[];
  /** Selected AddOn.id values. */
  optionIds: string[];
  /** Quantity per AddOn.id, for add-ons priced each. */
  quantities: Record<string, number>;
  /** Internal-only: percentage knocked off the subtotal. */
  discountPct?: number;
  /** Delivery ZIP, used for the freight estimate. */
  zip?: string;
  /** Delivery state (two-letter code); picks the tax rate when one is set. */
  state?: string;
  /** Vehicles and equipment laid out on the 2D floor plan. */
  planItems?: PlanItem[];
}

// ── Catalog ──────────────────────────────────────────────────────────────────

export interface SizeRange {
  minWidth: number;
  maxWidth: number;
  minLength: number;
  maxLength: number;
  minEave: number;
  maxEave: number;
  /** Increment the width slider snaps to. */
  step: number;
  /** Increment the length snaps to; defaults to `step`. */
  lengthStep?: number;
  eaveStep: number;
}

export interface BuildingModel {
  id: string;
  name: string;
  /** Groups models into the top-level tabs: Carports, Garages, Barns, … */
  category: string;
  tagline: string;
  /** Eave height the base $/sqft assumes; taller costs more. */
  baseEaveHeight: number;
  /** Roof pitch the base $/sqft assumes; steeper costs more. */
  basePitch: number;
  baseCharge: number;
  basePricePerSqFt: number;
  size: SizeRange;
  allowedRoofStyles: RoofStyleId[];
  allowedRoofBuilds: RoofBuild[];
  allowedEnclosures: Enclosure[];
  /** Applied on top of the catalog defaults when this model is selected. */
  defaults: Partial<BuildingConfig>;
}

export interface ColorOption {
  id: string;
  name: string;
  hex: string;
  /** Added per square foot of the surface it is applied to. */
  upchargePerSqFt: number;
  /** Metalness hint for the renderer, 0..1. */
  metallic?: number;
  /**
   * Printed finish. Wood- and stone-look panels are premium prints on the same
   * steel; `variant` picks the grain or stone pattern.
   */
  finish?: 'metal' | 'wood' | 'stone';
  variant?: string;
}

export interface MaterialOption {
  id: string;
  name: string;
  kind: 'siding' | 'roofing';
  texture: TextureKind;
  pricePerSqFt: number;
  /** Vertical feet covered by one texture tile; drives texture repeat. */
  tileHeight?: number;
}

export interface OpeningType {
  id: string;
  name: string;
  /** 'framed' is a bare framed-out hole with no door or glass in it. */
  category: 'overhead' | 'walk' | 'window' | 'framed';
  width: number;
  height: number;
  defaultSill: number;
  price: number;
  /** 'any' means the opening can go on any wall. */
  allowedWalls: WallId[] | 'any';
  /**
   * Whether this opening may sit above the floor. Windows and framed openings
   * can; walk doors and roll-up doors are driven or walked through, so they
   * always start at grade.
   */
  allowSill: boolean;
  /** The customer picks the size; `width`/`height` above are just the defaults. */
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Added per square foot of opening, for resizable types. */
  pricePerSqFt?: number;
  /** Part number, for ordering. */
  sku?: string;
  description?: string;
}

export interface FloorOption {
  id: string;
  name: string;
  pricePerSqFt: number;
  /** Rendered slab thickness in feet; 0 renders as a flat pad. */
  thickness: number;
  hex: string;
  /** Surface pattern painted on the slab. */
  texture?: 'concrete' | 'asphalt' | 'gravel' | 'dirt' | 'wood';
}

/** What an add-on's unit price is multiplied by. */
export type PriceBasis = 'each' | 'footprint' | 'wallArea' | 'roofArea' | 'perimeter' | 'length';

export interface AddOn {
  id: string;
  name: string;
  description: string;
  category: string;
  basis: PriceBasis;
  price: number;
  /** When true the option carries a quantity instead of being a simple toggle. */
  countable?: boolean;
  maxQty?: number;
  /** Hide from the customer-facing configurator. */
  internalOnly?: boolean;
  /** Part number, for ordering. */
  sku?: string;
}

export interface RoofStyleOption {
  id: RoofStyleId;
  name: string;
  /** Multiplies the base structure line. */
  priceMultiplier: number;
  /** Gambrel only. */
  params?: { breakFraction: number; lowerPitch: number };
  minPitch: number;
  maxPitch: number;
  /** Widest building this silhouette is offered on. */
  maxWidth?: number;
}

export interface RoofBuildOption {
  id: RoofBuild;
  name: string;
  description: string;
  priceMultiplier: number;
  /** Round the eaves (and ridge) instead of leaving them square. */
  rounded: boolean;
  /** Which way the roof panels run. */
  panels: PanelOrientation;
  /** Vertical roofs need hat channel under the panels. */
  purlins: boolean;
  /** Pitches this build is offered in. */
  pitches: number[];
}

export interface GaugeOption {
  id: string;
  name: string;
  description: string;
  priceMultiplier: number;
  /** Outside dimension of this gauge's square tube, in feet. */
  tubeSize?: number;
}

export interface PricingRules {
  /** Charged per extra foot of eave height, per linear foot of perimeter. */
  heightAdderPerFtPerPerimeterFt: number;
  /** Charged per unit of rise above the model's base pitch, per sqft of roof. */
  pitchAdderPerRisePerSqFt: number;
  enclosureMultipliers: Record<Enclosure, number>;
  /** Cost comes from the supplier book; this is what we add on top. */
  markup: MarkupRules;
  /** Gross-margin assumption per line-item category, for anything not book-priced. */
  costFactors: Record<string, number>;
  defaultCostFactor: number;
  taxRate: number;
  /**
   * Sales tax by delivery state, overriding `taxRate` when the customer picks
   * a state. State base rates only; local add-ons are not modelled.
   */
  taxByState?: Record<string, number>;
  freight: { baseCharge: number; perMile: number; freeRadiusMiles: number; defaultMiles: number };
  /** Drives the "as low as $X/mo" estimate. */
  financing: { months: number; apr: number; downPct: number };
  /** Spacing of posts on open walls, in feet. */
  postSpacing: number;
  wallThickness: number;
  roofThickness: number;
  /** Outside dimension of the square frame tubing, in feet. */
  tubeSize: number;
  /** Radius of the round-over on a regular roof, in feet. */
  eaveRoundRadius: number;
  /** Height of the wainscot band, in feet. */
  wainscotHeight: number;
  /** Structure multiplier for tightening the frame from 5' to 4' on center. */
  onCenter4Multiplier: number;
  /** Structure multiplier for a certified build. */
  certifiedMultiplier: number;
}

export interface Branding {
  productName: string;
  companyName: string;
  accent: string;
  /** Shown on the quote request form. */
  contactEmail: string;
  contactPhone: string;
}

export interface Catalog {
  version: number;
  branding: Branding;
  models: BuildingModel[];
  roofStyles: RoofStyleOption[];
  roofBuilds: RoofBuildOption[];
  gauges: GaugeOption[];
  sidings: MaterialOption[];
  roofings: MaterialOption[];
  colors: ColorOption[];
  openingTypes: OpeningType[];
  floors: FloorOption[];
  addOns: AddOn[];
  rules: PricingRules;
}

// ── Pricing output ───────────────────────────────────────────────────────────

export interface LineItem {
  key: string;
  label: string;
  detail?: string;
  category: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  /** Estimated cost of goods for this line; internal view only. */
  cost: number;
}

/** Turns supplier cost into a sell price. */
export interface MarkupRules {
  /** Percentage added to cost, by line category. */
  defaultPct: number;
  byCategory: Record<string, number>;
}

export interface Quote {
  lines: LineItem[];
  /** Anything the supplier's book could not price. */
  unpriced: string[];
  subtotal: number;
  discount: number;
  freight: number;
  taxable: number;
  tax: number;
  total: number;
  /** Internal only. */
  cost: number;
  grossProfit: number;
  marginPct: number;
}

/** Who is looking at the configurator. */
export type Audience = 'customer' | 'internal';
