// The configuration sidebar, laid out as the Walker Buildings panel: yellow
// section bars that open and close, radio choices, and colour pickers.
//
// Choices the selected manufacturer's book does not offer are shown but
// disabled, with the reason on hover, rather than hidden — so the customer
// sees the full product and the quote never holds a size nobody printed.

import type {
  Audience, BuildingConfig, Catalog, GutterSize, LegStyle, OnCenter, PanelOrientation, RoofBuild, RoofStyleId,
  WallId, WallKind,
} from '../core/types';
import { WALL_IDS } from '../core/types';
import type { BuildingGeometry } from '../core/geometry';
import { strongerLeg, wallKinds } from '../core/geometry';
import { money } from '../core/pricing';
import OpeningsEditor from './OpeningsEditor';
import { Accordion, CheckRow, ColorPicker, Field, RadioGroup, Slider, Stepper } from './controls';
import { SUPPLIERS, getSupplier } from '../core/suppliers';
import SupplierPicker from './SupplierPicker';
import { bowCount } from '../core/pricebook';
import { feetInches } from '../core/format';

const STATE_NAMES: Record<string, string> = {
  NC: 'North Carolina', SC: 'South Carolina', GA: 'Georgia', VA: 'Virginia', TN: 'Tennessee', FL: 'Florida',
};

const LEG_LABEL: Record<LegStyle, string> = {
  single: 'Single Leg (2-½")',
  double: 'Double Leg (5")',
  ladder: 'Ladder Leg (12")',
};

const WALL_LABEL: Record<WallId, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };
const WALL_KIND_LABEL: Record<WallKind, string> = {
  open: 'Open',
  closed: 'Closed',
  half: 'Half Wall',
  gable: 'Gable',
  columns: 'Columns',
};

/** Shown in sections whose product is not built yet. */
function ComingSoon({ what }: { what: string }) {
  return <p className="soon">{what} are coming soon. Ask us and we will quote them by hand.</p>;
}

export default function OptionPanel({
  cfg,
  catalog,
  geo,
  audience,
  update,
}: {
  cfg: BuildingConfig;
  catalog: Catalog;
  geo: BuildingGeometry;
  audience: Audience;
  update: (patch: Partial<BuildingConfig>) => void;
}) {
  const model = catalog.models.find((m) => m.id === cfg.modelId) ?? catalog.models[0];
  const roofStyle = catalog.roofStyles.find((r) => r.id === cfg.roofStyle);
  const roofBuild = catalog.roofBuilds.find((b) => b.id === cfg.roofBuild);
  const supplier = getSupplier(cfg.supplierId);
  const kinds = wallKinds(cfg);
  const anyPanelled = WALL_IDS.some((w) => kinds[w] === 'closed' || kinds[w] === 'half' || kinds[w] === 'gable');

  // Pitches this roof build comes in, narrowed by the supplier and silhouette.
  const pitches = (roofBuild?.pitches ?? [3, 4, 5])
    .filter((p) => supplier.pitchesFor(cfg.width).includes(p))
    .filter((p) => p >= (roofStyle?.minPitch ?? 1) && p <= (roofStyle?.maxPitch ?? 12));

  // Legs: the book sets a minimum for the height; the customer may go stronger.
  const bookLeg = supplier.legStyleFor(cfg.width, cfg.eaveHeight);
  const effectiveLeg = strongerLeg(bookLeg, cfg.legChoice ?? 'single');
  const upgradeFrom = supplier.legHeightsFor(cfg.width).find((h) => supplier.legStyleFor(cfg.width, h) !== 'single');

  const overhangs = supplier.overhangsFor(cfg.width);

  const addOn = (id: string) => catalog.addOns.find((a) => a.id === id && (audience === 'internal' || !a.internalOnly));
  const priceOf = (id: string) => {
    const a = addOn(id);
    if (!a) return '';
    return a.basis === 'each'
      ? money(a.price)
      : `${money(a.price, true)}/${a.basis === 'perimeter' || a.basis === 'length' ? 'ft' : 'sq ft'}`;
  };
  const toggle = (id: string, on: boolean) =>
    update({ optionIds: on ? [...cfg.optionIds.filter((x) => x !== id), id] : cfg.optionIds.filter((x) => x !== id) });
  /** A tick box for an add-on, with a quantity once ticked if it is counted. */
  const addOnRow = (id: string) => {
    const a = addOn(id);
    if (!a) return null;
    const on = cfg.optionIds.includes(id);
    return (
      <CheckRow
        label={a.name}
        detail={a.description}
        price={priceOf(id)}
        checked={on}
        onChange={(v) => toggle(id, v)}
        right={
          on && a.countable ? (
            <Stepper
              value={cfg.quantities[id] ?? 1}
              max={a.maxQty ?? 99}
              onChange={(n) => update({ quantities: { ...cfg.quantities, [id]: n } })}
            />
          ) : undefined
        }
      />
    );
  };

  const setWall = (w: WallId, kind: WallKind) => update({ exteriorWalls: 'custom', walls: { ...kinds, [w]: kind } });

  return (
    <div className="panel">
      {audience === 'internal' && (
        <Accordion title="Supplier (internal)">
          <p className="section-hint">{supplier.basePriceCovers}</p>
          <SupplierPicker
            suppliers={SUPPLIERS}
            value={cfg.supplierId}
            onChange={(supplierId) => update({ supplierId })}
            currentWidth={cfg.width}
          />
        </Accordion>
      )}

      {/* ── BUILDING FRAME ─────────────────────────────────────────────── */}
      <Accordion title="Building Frame" defaultOpen>
        {/* Only sizes the supplier actually prints — these books are matrices,
            not formulas, so anything else is a price nobody has quoted. */}
        <div className="row2">
          <Field label="Width">
            <select value={cfg.width} onChange={(e) => update({ width: Number(e.target.value) })}>
              {supplier.widths.map((w) => (
                <option key={w} value={w}>{w}&prime; wide</option>
              ))}
            </select>
          </Field>
          <Field label="Length">
            <select value={cfg.length} onChange={(e) => update({ length: Number(e.target.value) })}>
              {supplier.lengthsFor(cfg.roofBuild, cfg.onCenter, cfg.width).map((l) => (
                <option key={l} value={l}>{l}&prime; long</option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Eave Height"
          note={`Peak ${geo.metrics.peakHeight.toFixed(1)}' · ${feetInches(geo.metrics.sideClearHeight)} clear at the wall · ${feetInches(geo.metrics.clearHeight)} under the truss`}
        >
          <select className="narrow" value={cfg.eaveHeight} onChange={(e) => update({ eaveHeight: Number(e.target.value) })}>
            {supplier.legHeightsFor(cfg.width).map((h) => (
              <option key={h} value={h}>
                {h}&prime;{h === supplier.standardLegHeightFor(cfg.width) ? ' (standard)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="row2">
          <RadioGroup
            label="Frame Gauge"
            options={catalog.gauges.map((g) => ({ value: g.id, label: g.name, title: g.description }))}
            value={cfg.gaugeId}
            onChange={(gaugeId) => update({ gaugeId })}
          />
          <RadioGroup
            label="Frame Spacing"
            options={([5, 4] as OnCenter[]).map((oc) => ({
              value: String(oc),
              label: `${oc}' On Center`,
              disabled: !supplier.onCentersFor(cfg.width).includes(oc),
              title: supplier.onCenterFixedFor(cfg.width) ? `${supplier.name} sets spacing by width` : undefined,
            }))}
            value={String(cfg.onCenter)}
            onChange={(v) => update({ onCenter: Number(v) as OnCenter })}
            note={`${bowCount(cfg.length, cfg.onCenter)} bows`}
          />
        </div>

        <RadioGroup
          label="Support Leg Depth"
          options={(['single', 'double', 'ladder'] as LegStyle[]).map((s) => ({
            value: s,
            label: LEG_LABEL[s],
            // Weaker than the book requires at this height: not allowed.
            disabled: strongerLeg(bookLeg, s) !== s,
            title: strongerLeg(bookLeg, s) !== s ? `${supplier.name} requires ${bookLeg} legs at ${cfg.eaveHeight}'` : undefined,
          }))}
          value={effectiveLeg}
          onChange={(legChoice) => update({ legChoice })}
          note={
            effectiveLeg !== bookLeg
              ? `Upgrade over the book: not in the price book, quoted by hand.`
              : upgradeFrom != null
                ? `${supplier.name} doubles the legs from ${upgradeFrom}'.`
                : undefined
          }
        />
      </Accordion>

      {/* ── ROOF ───────────────────────────────────────────────────────── */}
      <Accordion title="Roof" defaultOpen>
        <div className="row2">
          <RadioGroup
            label="Roof Style"
            options={(['gable', 'single-slope'] as RoofStyleId[]).map((r) => {
              const style = catalog.roofStyles.find((x) => x.id === r);
              const allowed = model.allowedRoofStyles.includes(r);
              const tooWide = style?.maxWidth != null && cfg.width > style.maxWidth;
              return {
                value: r,
                label: r === 'gable' ? 'A-Frame' : 'Single Slope',
                disabled: !allowed || tooWide,
                title: tooWide ? `Not offered over ${style?.maxWidth}' wide` : !allowed ? 'Not offered on this building' : undefined,
              };
            })}
            value={cfg.roofStyle}
            onChange={(roofStyle) => update({ roofStyle })}
          />
          <RadioGroup
            label="Roof Pitch"
            options={[2, 3, 4, 5].map((p) => ({
              value: String(p),
              label: `${p}:12`,
              disabled: !pitches.includes(p),
              title: !pitches.includes(p) ? `Not in the ${supplier.name} book for this roof` : undefined,
            }))}
            value={String(cfg.pitch)}
            onChange={(v) => update({ pitch: Number(v) })}
          />
        </div>

        <RadioGroup
          label="Roof Build"
          options={(['regular', 'boxed-eave', 'vertical'] as RoofBuild[]).map((id) => {
            const b = catalog.roofBuilds.find((x) => x.id === id);
            const offered = supplier.roofBuildsFor(cfg.width).includes(id);
            return {
              value: id,
              label: b?.name ?? id,
              disabled: !offered,
              title: offered ? b?.description : `${supplier.name} does not build this at ${cfg.width}' wide`,
            };
          })}
          value={cfg.roofBuild}
          onChange={(roofBuild) => update({ roofBuild })}
          note={roofBuild?.description}
        />

        <div className="row2">
          <RadioGroup
            label="Roof Overhang"
            options={[
              { value: '0', label: '6"' },
              { value: '1', label: "1'" },
              { value: '2', label: "2'" },
            ].map((o) => ({
              ...o,
              disabled: !overhangs.includes(Number(o.value)),
              title: !overhangs.includes(Number(o.value)) ? `Not in the ${supplier.name} book` : undefined,
            }))}
            value={String(cfg.overhang)}
            onChange={(v) => update({ overhang: Number(v) })}
          />
          <RadioGroup
            label="Roof Material"
            options={catalog.roofings.map((r) => ({ value: r.id, label: r.name }))}
            value={cfg.roofingId}
            onChange={(roofingId) => update({ roofingId })}
          />
        </div>

        <ColorPicker label="Roof Colors" colors={catalog.colors} value={cfg.roofColorId} onChange={(roofColorId) => update({ roofColorId })} />

        <RadioGroup
          label="Gutters"
          options={[
            { value: 'none', label: 'None' },
            { value: '4in', label: '4" Seamless Gutters & Downspouts' },
            { value: '6in', label: '6" Seamless Gutters & Downspouts' },
          ] as { value: GutterSize; label: string }[]}
          value={cfg.gutters ?? 'none'}
          onChange={(gutters) => update({ gutters })}
        />
        {cfg.gutters && cfg.gutters !== 'none' && (
          <ColorPicker
            label="Gutter Colors"
            colors={catalog.colors}
            value={cfg.gutterColorId ?? cfg.trimColorId}
            onChange={(gutterColorId) => update({ gutterColorId })}
          />
        )}

        <div className="field">
          <span className="field-label">Roof Accessories</span>
          {addOnRow('ridge-vent')}
          {addOnRow('turbo-vent')}
          {addOnRow('skylight')}
          {addOnRow('cupola')}
        </div>
      </Accordion>

      {/* ── SIDES & ENDS ───────────────────────────────────────────────── */}
      <Accordion title="Sides & Ends">
        <RadioGroup
          label="Exterior Walls"
          options={[
            { value: 'none', label: 'None' },
            { value: 'enclosed', label: 'Fully Enclosed' },
            { value: 'custom', label: 'Custom' },
          ] as { value: 'none' | 'enclosed' | 'custom'; label: string }[]}
          value={cfg.exteriorWalls ?? 'none'}
          onChange={(exteriorWalls) => update({ exteriorWalls })}
        />
        {cfg.exteriorWalls === 'custom' && (
          <div className="wall-grid">
            {WALL_IDS.map((w) => (
              <label key={w} className="wall-row">
                <span>{WALL_LABEL[w]}</span>
                <select value={kinds[w]} onChange={(e) => setWall(w, e.target.value as WallKind)}>
                  {(['open', 'closed', 'half', 'gable', 'columns'] as WallKind[])
                    .filter((k) => k !== 'gable' || w === 'front' || w === 'back')
                    .map((k) => (
                      <option key={k} value={k}>{WALL_KIND_LABEL[k]}</option>
                    ))}
                </select>
              </label>
            ))}
          </div>
        )}

        {anyPanelled && (
          <>
            <Field label="Siding Style">
              <select
                value={cfg.sidingOrientation}
                onChange={(e) => update({ sidingOrientation: e.target.value as PanelOrientation })}
              >
                <option value="horizontal">Horizontal AG Panel</option>
                <option value="vertical">Vertical AG Panel</option>
              </select>
            </Field>
            <ColorPicker
              label="Siding Colors"
              colors={catalog.colors}
              value={cfg.sidingColorId}
              onChange={(sidingColorId) => update({ sidingColorId })}
            />

            <RadioGroup
              label="Wainscot"
              options={[
                { value: 'none', label: 'None' },
                { value: 'wainscot', label: 'Wainscot' },
              ]}
              value={cfg.wainscotColorId ? 'wainscot' : 'none'}
              onChange={(v) => update({ wainscotColorId: v === 'none' ? null : cfg.wainscotColorId ?? 'burnished-slate' })}
            />
            {cfg.wainscotColorId && (
              <>
                <select
                  value={cfg.wainscotOrientation ?? 'horizontal'}
                  onChange={(e) => update({ wainscotOrientation: e.target.value as PanelOrientation })}
                  aria-label="Wainscot style"
                >
                  <option value="horizontal">Horizontal AG Panel</option>
                  <option value="vertical">Vertical AG Panel</option>
                </select>
                <ColorPicker
                  label="Wainscot Colors"
                  colors={catalog.colors}
                  value={cfg.wainscotColorId}
                  onChange={(wainscotColorId) => update({ wainscotColorId })}
                />
              </>
            )}
            {addOnRow('j-trim')}
          </>
        )}
      </Accordion>

      <Accordion title="Lean-Tos">
        <ComingSoon what="Lean-tos" />
      </Accordion>

      {/* ── COLORS ─────────────────────────────────────────────────────── */}
      <Accordion title="Colors">
        <ColorPicker label="Roof Colors" colors={catalog.colors} value={cfg.roofColorId} onChange={(roofColorId) => update({ roofColorId })} />
        {anyPanelled && (
          <ColorPicker label="Siding Colors" colors={catalog.colors} value={cfg.sidingColorId} onChange={(sidingColorId) => update({ sidingColorId })} />
        )}
        <ColorPicker label="Trim & Door Colors" colors={catalog.colors} value={cfg.trimColorId} onChange={(trimColorId) => update({ trimColorId })} />
      </Accordion>

      {/* ── INTERIOR ───────────────────────────────────────────────────── */}
      <Accordion title="Interior">
        <Accordion title="Interior – Divider Walls" sub>
          <ComingSoon what="Divider walls" />
        </Accordion>
        <Accordion title="Interior – Insulation" sub>
          {addOnRow('ins-walls')}
          {addOnRow('ins-roof')}
        </Accordion>
        <Accordion title="Interior – Wheel Stops" sub>
          <ComingSoon what="Wheel stops" />
        </Accordion>
        <Accordion title="Interior – Wall Panels" sub>
          <ComingSoon what="Interior wall panels" />
        </Accordion>
        <Accordion title="Interior – Electrical & Lighting" sub>
          {addOnRow('electrical')}
          {addOnRow('led-lights')}
        </Accordion>
      </Accordion>

      <Accordion title="Doors & Windows">
        <OpeningsEditor cfg={cfg} catalog={catalog} update={update} />
      </Accordion>

      <Accordion title="Wings">
        <ComingSoon what="Wings" />
      </Accordion>

      {/* ── FOUNDATION ─────────────────────────────────────────────────── */}
      <Accordion title="Foundation">
        <RadioGroup
          label="Foundation"
          options={catalog.floors.map((f) => ({
            value: f.id,
            label: `${f.name} — ${f.pricePerSqFt > 0 ? `${money(f.pricePerSqFt, true)}/sq ft` : 'included'}`,
          }))}
          value={cfg.floorId}
          onChange={(floorId) => update({ floorId })}
        />
        {addOnRow('anchors')}
        {addOnRow('site-prep')}
      </Accordion>

      <Accordion title="Permitting">
        {addOnRow('wind-cert')}
        {addOnRow('permit-drawings')}
      </Accordion>

      {/* ── TAX, DELIVERY & INSTALL ────────────────────────────────────── */}
      <Accordion title="Tax, Delivery & Install">
        <Field label="Delivery state" note="Sets the sales tax on the quote.">
          <select value={cfg.state ?? ''} onChange={(e) => update({ state: e.target.value || undefined })}>
            <option value="">Not chosen yet</option>
            {Object.keys(catalog.rules.taxByState ?? {}).map((st) => (
              <option key={st} value={st}>
                {STATE_NAMES[st] ?? st}
              </option>
            ))}
          </select>
        </Field>
        <p className="field-note">Delivery and installation are included in the price on level ground.</p>
      </Accordion>

      {audience === 'internal' && (
        <Accordion title="Internal">
          <Slider
            label="Discount"
            value={cfg.discountPct ?? 0}
            min={0}
            max={40}
            step={0.5}
            onChange={(discountPct) => update({ discountPct })}
            format={(n) => `${n}%`}
            note="Applied to the subtotal before freight and tax."
          />
          {addOnRow('rush')}
        </Accordion>
      )}
    </div>
  );
}
