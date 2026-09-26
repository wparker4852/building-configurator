// Internal: every component a manufacturer carries, with cost, sell price and
// the margin between them. Margin is derived, never stored — editing either
// price or margin recomputes the other, so they can never disagree.

import { Fragment, useMemo, useState } from 'react';
import { SUPPLIERS, getSupplier, type ComponentDef } from '../core/suppliers';
import {
  componentsToCsv,
  priceForMargin,
  pricedComponents,
  resetSupplierPrices,
  setComponentPrice,
  setMarginForSupplier,
  type PricedComponent,
} from '../core/componentPricing';
import { money } from '../core/pricing';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function marginClass(pct: number) {
  if (pct >= 35) return 'margin-good';
  if (pct >= 22) return 'margin-ok';
  return 'margin-bad';
}

export default function ComponentPricing({ defaultMarkupPct }: { defaultMarkupPct: number }) {
  const [supplierId, setSupplierId] = useState(SUPPLIERS[0].id);
  // Bumped after every edit so the derived rows recompute from storage.
  const [rev, setRev] = useState(0);
  const [massMargin, setMassMargin] = useState('40');

  const supplier = getSupplier(supplierId);
  const rows = useMemo(
    () => pricedComponents(supplier, defaultMarkupPct),
    [supplier, defaultMarkupPct, rev],
  );

  const touch = () => setRev((r) => r + 1);

  const byCategory = useMemo(() => {
    const map = new Map<ComponentDef['category'], PricedComponent[]>();
    for (const r of rows) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return [...map.entries()];
  }, [rows]);

  const editedCount = rows.filter((r) => r.overridden).length;
  const avgMargin = rows.length
    ? rows.reduce((s, r) => s + r.marginPct, 0) / rows.length
    : 0;

  const applyMass = () => {
    const pct = Number(massMargin);
    if (!Number.isFinite(pct)) return;
    if (!window.confirm(`Set every ${supplier.name} component to ${pct}% margin? This overwrites individual prices.`)) return;
    setMarginForSupplier(supplier, pct);
    touch();
  };

  return (
    <section className="sheet">
      <h3>Component pricing</h3>

      <div className="supplier-tabs">
        {SUPPLIERS.map((s) => (
          <button key={s.id} aria-pressed={s.id === supplierId} onClick={() => setSupplierId(s.id)}>
            <span className="dot" style={{ background: s.logo.color }} />
            {s.name}
          </button>
        ))}
      </div>

      <div className="mass-update">
        <strong>Set margin on all {rows.length} items:</strong>
        <input
          type="number"
          step={0.5}
          value={massMargin}
          onChange={(e) => setMassMargin(e.target.value)}
          aria-label="Margin percent"
        />
        <span>%</span>
        <button className="btn sm primary" onClick={applyMass}>
          Apply to {supplier.name}
        </button>
        <span className="spacer" />
        <span style={{ color: 'var(--text-2)' }}>
          Avg margin <strong className={marginClass(avgMargin)}>{avgMargin.toFixed(1)}%</strong>
          {editedCount > 0 && <> &middot; {editedCount} edited</>}
        </span>
        <button
          className="btn sm"
          onClick={() => download(`${supplier.id}-components.csv`, componentsToCsv(supplier, rows), 'text/csv')}
        >
          Export CSV
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            if (!window.confirm(`Reset all ${supplier.name} prices to cost + ${defaultMarkupPct}% markup?`)) return;
            resetSupplierPrices(supplier);
            touch();
          }}
        >
          Reset
        </button>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>Item</th>
            <th>Unit</th>
            <th className="num">Cost</th>
            <th className="num">Price</th>
            <th className="num">Margin</th>
            <th className="num">Profit</th>
          </tr>
        </thead>
        <tbody>
          {byCategory.map(([category, items]) => (
            <Fragment key={category}>
              <tr className="cat-row">
                <td colSpan={6}>{category}</td>
              </tr>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className={r.overridden ? 'edited' : undefined}>
                    {r.label}
                    {r.size && (
                      <div style={{ color: 'var(--text-3)', fontSize: 11 }}>
                        {r.size.width}&prime; &times; {r.size.height}&prime; opening
                      </div>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-2)' }}>{r.unit}</td>
                  {/* Cost is what the book says we pay — not editable here. */}
                  <td className="num" style={{ color: 'var(--text-2)' }}>
                    {money(r.cost, r.cost < 10)}
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      step={r.cost < 10 ? 0.05 : 5}
                      value={r.price}
                      onChange={(e) => {
                        setComponentPrice(supplier.id, r.id, Number(e.target.value));
                        touch();
                      }}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      step={0.5}
                      value={Number(r.marginPct.toFixed(1))}
                      className={marginClass(r.marginPct)}
                      onChange={(e) => {
                        setComponentPrice(supplier.id, r.id, priceForMargin(r.cost, Number(e.target.value)));
                        touch();
                      }}
                    />
                  </td>
                  <td className="num" style={{ color: 'var(--text-2)' }}>
                    {money(r.price - r.cost, r.cost < 10)}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <p style={{ padding: '12px 16px', margin: 0, fontSize: 12, color: 'var(--text-2)' }}>
        Cost comes from {supplier.name}&rsquo;s price book and is read-only. Margin is calculated
        from cost and price &mdash; edit either one and the other follows. Rows with a dot are
        edited; everything else sits at cost plus the default {defaultMarkupPct}% markup.
      </p>
    </section>
  );
}
