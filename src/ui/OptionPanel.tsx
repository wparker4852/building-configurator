// The configuration sidebar: everything the customer can change.

import { useEffect, useState } from 'react';
import type {
  Audience, BuildingConfig, Catalog, OnCenter, PanelOrientation, RoofBuild, RoofStyleId,
} from '../core/types';
import type { BuildingGeometry } from '../core/geometry';
import { money } from '../core/pricing';
import OpeningsEditor from './OpeningsEditor';
import { Field, OptionRow, Section, Segmented, Slider, Stepper, Swatches } from './controls';
import { SUPPLIERS, getSupplier } from '../core/suppliers';
import SupplierPicker from './SupplierPicker';
import { bowCount } from '../core/pricebook';
import { feetInches } from '../core/format';
import type { LegStyle } from '../core/types';

const STATE_NAMES: Record<string, string> = {
  NC: 'North Carolina', SC: 'South Carolina', GA: 'Georgia', VA: 'Virginia', TN: 'Tennessee', FL: 'Florida',
};

function legStyleNote(style: LegStyle): string {
  return style === 'double' ? ' — double leg' : style === 'ladder' ? ' — ladder leg' : '';
}


export default function OptionPanel({
  cfg,
  catalog,
  geo,
  audience,
  update,
  setModel,
}: {
  cfg: BuildingConfig;
  catalog: Catalog;
  geo: BuildingGeometry;
  audience: Audience;
  update: (patch: Partial<BuildingConfig>) => void;
  setModel: (id: string) => void;
}) {
  const model = catalog.models.find((m) => m.id === cfg.modelId) ?? catalog.models[0];
  const roofStyle = catalog.roofStyles.find((r) => r.id === cfg.roofStyle);
  const roofBuild = catalog.roofBuilds.find((b) => b.id === cfg.roofBuild);
  const supplier = getSupplier(cfg.supplierId);
  const gauge = catalog.gauges.find((g) => g.id === cfg.gaugeId);

  const categoryNames = [...new Set(catalog.models.map((m) => m.category))];
  // The category tabs follow the selected model unless the user browses away.
  const [category, setCategory] = useState(model.category);
  useEffect(() => setCategory(model.category), [model.category]);

  const pitches = (roofBuild?.pitches ?? [3, 4, 5])
    .filter((p) => supplier.pitchesFor(cfg.width).includes(p))
    .filter((p) => p >= (roofStyle?.minPitch ?? 1) && p <= (roofStyle?.maxPitch ?? 12));

  const addOns = catalog.addOns.filter((a) => audience === 'internal' || !a.internalOnly);
  const categories = [...new Set(addOns.map((a) => a.category))];

  const toggleOption = (id: string) => {
    const on = cfg.optionIds.includes(id);
    update({ optionIds: on ? cfg.optionIds.filter((x) => x !== id) : [...cfg.optionIds, id] });
  };

  return (
    <div className="panel">
      <Section title="Building type">
        <div className="seg" role="group" aria-label="Category">
          {categoryNames.map((c) => (
            <button key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="cards">
          {catalog.models
            .filter((m) => m.category === category)
            .map((m) => (
              <button key={m.id} className="card" aria-pressed={m.id === cfg.modelId} onClick={() => setModel(m.id)}>
                <span className="n">{m.name}</span>
                <span className="d">{m.tagline}</span>
              </button>
            ))}
        </div>
      </Section>

      {audience === 'internal' && (
      <Section title="Supplier" hint={supplier.basePriceCovers}>
        <SupplierPicker
          suppliers={SUPPLIERS}
          value={cfg.supplierId}
          onChange={(supplierId) => update({ supplierId })}
          currentWidth={cfg.width}
        />
      </Section>
      )}

      <Section title="Built &amp; size" hint={`${geo.metrics.footprint.toLocaleString()} sq ft footprint`}>
        {/* Only sizes the supplier actually prints — these books are matrices,
            not formulas, so anything else is a price nobody has quoted. */}
        <Field label="Width">
          <select value={cfg.width} onChange={(e) => update({ width: Number(e.target.value) })}>
            {supplier.widths.map((w) => (
              <option key={w} value={w}>{w}&prime; wide</option>
            ))}
          </select>
        </Field>
        <Field
          label="Length"
          note={`${bowCount(cfg.length, cfg.onCenter)} bows on ${cfg.onCenter}′ centers`}
        >
          <select value={cfg.length} onChange={(e) => update({ length: Number(e.target.value) })}>
            {supplier.lengthsFor(cfg.roofBuild, cfg.onCenter, cfg.width).map((l) => (
              <option key={l} value={l}>{l}&prime; long</option>
            ))}
          </select>
        </Field>
        <Field
          label="Leg height"
          note={`Peak reaches ${geo.metrics.peakHeight.toFixed(1)}' · ${feetInches(geo.metrics.sideClearHeight)} clear at the wall, ${feetInches(geo.metrics.clearHeight)} under the truss`}
        >
          <select value={cfg.eaveHeight} onChange={(e) => update({ eaveHeight: Number(e.target.value) })}>
            {supplier.legHeightsFor(cfg.width).map((h) => (
              <option key={h} value={h}>
                {h}&prime;{h === supplier.standardLegHeightFor(cfg.width) ? ' (standard)' : ''}
                {legStyleNote(supplier.legStyleFor(cfg.width, h))}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Roof style">
          <div className="list">
            {supplier.roofBuildsFor(cfg.width).map((id) => {
              const b = catalog.roofBuilds.find((x) => x.id === id);
              if (!b) return null;
              return (
                <OptionRow
                  key={id}
                  name={b.name}
                  detail={b.description}
                  selected={cfg.roofBuild === id}
                  onClick={() => update({ roofBuild: id as RoofBuild })}
                />
              );
            })}
          </div>
        </Field>

        <Segmented
          label="Roof pitch"
          options={pitches.map((p) => ({ value: String(p), label: `${p}/12` }))}
          value={String(cfg.pitch)}
          onChange={(v) => update({ pitch: Number(v) })}
        />

        {supplier.onCenterFixedFor(cfg.width) ? (
          <span className="field-note">
            {supplier.name} sets frame spacing by width &mdash; this build is on {cfg.onCenter}&prime; centers.
          </span>
        ) : (
          <Segmented
            label="Frame spacing"
            options={supplier.onCentersFor(cfg.width).map((oc) => ({ value: String(oc), label: `${oc}' on center` }))}
            value={String(cfg.onCenter)}
            onChange={(v) => update({ onCenter: Number(v) as OnCenter })}
          />
        )}

        {supplier.overhangsFor(cfg.width).length > 1 && (
          <Segmented
            label="Side overhang"
            options={supplier.overhangsFor(cfg.width).map((o) => ({ value: String(o), label: o === 0 ? 'None' : `${o}'` }))}
            value={String(cfg.overhang)}
            onChange={(v) => update({ overhang: Number(v) })}
          />
        )}

        <Segmented
          label="Gauge"
          options={catalog.gauges.map((g) => ({ value: g.id, label: g.name }))}
          value={cfg.gaugeId}
          onChange={(gaugeId) => update({ gaugeId })}
        />
        {gauge && <span className="field-note">{gauge.description}</span>}

        <span className="field-note">
          Every building from {supplier.name} is engineer certified.
        </span>
      </Section>

      <Section title="Walls">
        {/* The books price the two sides as a pair and each gable end on its
            own, so the UI offers exactly those choices. */}
        <Segmented
          label="Sides"
          options={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Both closed' },
          ]}
          value={cfg.sidesClosed ? 'closed' : 'open'}
          onChange={(v) => update({ sidesClosed: v === 'closed' })}
        />
        <Segmented
          label="Gable ends"
          options={[
            { value: '0', label: 'Open' },
            { value: '1', label: 'One closed' },
            { value: '2', label: 'Both closed' },
          ]}
          value={String(cfg.endsClosed)}
          onChange={(v) => update({ endsClosed: Number(v) })}
        />

        {cfg.enclosure !== 'open' && (
          <>
            <Field label="Siding">
              <div className="list">
                {catalog.sidings.map((s) => (
                  <OptionRow
                    key={s.id}
                    name={s.name}
                    price={`${money(s.pricePerSqFt, true)}/sq ft`}
                    selected={s.id === cfg.sidingId}
                    onClick={() => update({ sidingId: s.id })}
                  />
                ))}
              </div>
            </Field>
            <Segmented
              label="Panel orientation"
              options={[
                { value: 'horizontal', label: 'Horizontal' },
                { value: 'vertical', label: 'Vertical' },
              ]}
              value={cfg.sidingOrientation}
              onChange={(sidingOrientation: PanelOrientation) => update({ sidingOrientation })}
            />
            <Swatches
              label="Siding color"
              colors={catalog.colors}
              value={cfg.sidingColorId}
              onChange={(sidingColorId) => update({ sidingColorId })}
            />
            <div className="field">
              <div className="field-row">
                <span className="field-label">Wainscot</span>
                <button
                  className="btn sm ghost"
                  onClick={() => update({ wainscotColorId: cfg.wainscotColorId ? null : 'burnished-slate' })}
                >
                  {cfg.wainscotColorId ? 'Remove' : 'Add'}
                </button>
              </div>
              {cfg.wainscotColorId && (
                <Swatches
                  label={`Lower ${catalog.rules.wainscotHeight}' band`}
                  colors={catalog.colors}
                  value={cfg.wainscotColorId}
                  onChange={(wainscotColorId) => update({ wainscotColorId })}
                />
              )}
            </div>
          </>
        )}

        <Swatches
          label="Trim & doors"
          colors={catalog.colors}
          value={cfg.trimColorId}
          onChange={(trimColorId) => update({ trimColorId })}
        />
      </Section>

      <Section title="Roof">
        <Segmented
          options={model.allowedRoofStyles.map((r) => {
            const style = catalog.roofStyles.find((x) => x.id === r);
            return {
              value: r,
              label: style?.name.split(' ')[0] ?? r,
              // Single slope stops at 30' wide.
              disabled: style?.maxWidth != null && cfg.width > style.maxWidth,
            };
          })}
          value={cfg.roofStyle}
          onChange={(roofStyle: RoofStyleId) => update({ roofStyle })}
        />
        <Field label="Roofing">
          <div className="list">
            {catalog.roofings.map((r) => (
              <OptionRow
                key={r.id}
                name={r.name}
                price={`${money(r.pricePerSqFt, true)}/sq ft`}
                selected={r.id === cfg.roofingId}
                onClick={() => update({ roofingId: r.id })}
              />
            ))}
          </div>
        </Field>
        <Swatches
          label="Roof color"
          colors={catalog.colors}
          value={cfg.roofColorId}
          onChange={(roofColorId) => update({ roofColorId })}
        />
        <Slider
          label="Eave overhang"
          value={cfg.eaveOverhang}
          min={0}
          max={4}
          step={0.5}
          onChange={(eaveOverhang) => update({ eaveOverhang })}
          format={(n) => `${n}'`}
        />
        <Slider
          label="Gable overhang"
          value={cfg.gableOverhang}
          min={0}
          max={4}
          step={0.5}
          onChange={(gableOverhang) => update({ gableOverhang })}
          format={(n) => `${n}'`}
        />
      </Section>

      <Section title="Foundation">
        <div className="list">
          {catalog.floors.map((f) => (
            <OptionRow
              key={f.id}
              name={f.name}
              price={f.pricePerSqFt > 0 ? `${money(f.pricePerSqFt, true)}/sq ft` : 'Included'}
              selected={f.id === cfg.floorId}
              onClick={() => update({ floorId: f.id })}
            />
          ))}
        </div>
      </Section>

      <Section title="Doors & windows" collapsible defaultOpen>
        <OpeningsEditor cfg={cfg} catalog={catalog} update={update} />
      </Section>

      {categories.map((category) => (
        <Section key={category} title={category} collapsible defaultOpen={category === 'Structure'}>
          <div className="list">
            {addOns
              .filter((a) => a.category === category)
              .map((a) => {
                const on = cfg.optionIds.includes(a.id);
                return (
                  <OptionRow
                    key={a.id}
                    name={a.name}
                    detail={a.description}
                    price={
                      a.basis === 'each'
                        ? money(a.price)
                        : `${money(a.price, true)}/${a.basis === 'perimeter' || a.basis === 'length' ? 'ft' : 'sq ft'}`
                    }
                    selected={on}
                    onClick={() => toggleOption(a.id)}
                    right={
                      on && a.countable ? (
                        <Stepper
                          value={cfg.quantities[a.id] ?? 1}
                          max={a.maxQty ?? 99}
                          onChange={(n) => update({ quantities: { ...cfg.quantities, [a.id]: n } })}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
          </div>
        </Section>
      ))}

      <Section title="Delivery">
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
      </Section>

      {audience === 'internal' && (
        <Section title="Internal">
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
        </Section>
      )}
    </div>
  );
}
