// Internal admin: edit the catalog, review captured leads.
//
// Edits are held in localStorage until a backend exists. "Export catalog.json"
// produces the file that should be committed back to the repo.

import { useState } from 'react';
import type { Catalog } from '../core/types';
import { baseCatalog, resetCatalog, saveCatalog } from '../core/catalog';
import { deleteLead, leadsToCsv, listLeads, type StoredLead } from '../core/leads';
import { money } from '../core/pricing';
import ComponentPricing from './ComponentPricing';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Num({
  value,
  step = 0.05,
  onChange,
}: {
  value: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="num"
    />
  );
}

function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sheet">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export default function AdminApp({
  catalog,
  setCatalog,
  onBack,
}: {
  catalog: Catalog;
  setCatalog: (c: Catalog) => void;
  onBack: () => void;
}) {
  const [leads, setLeads] = useState<StoredLead[]>(() => listLeads());
  const [saved, setSaved] = useState(false);

  /** Apply a change and persist it. */
  const edit = (mutate: (draft: Catalog) => void) => {
    const draft: Catalog = JSON.parse(JSON.stringify(catalog));
    mutate(draft);
    setCatalog(draft);
    saveCatalog(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const priceList = <T extends { id: string; name: string }>(
    items: T[],
    get: (x: T) => number,
    set: (draft: Catalog, i: number, v: number) => void,
    unit: string,
  ) => (
    <table className="grid">
      <thead>
        <tr>
          <th>Name</th>
          <th className="num">{unit}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={item.id}>
            <td>{item.name}</td>
            <td className="num">
              <Num value={get(item)} onChange={(v) => edit((d) => set(d, i, v))} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Catalog admin<span className="co">{catalog.branding.companyName}</span>
        </div>
        <div className="spacer" />
        {saved && <span className="badge">Saved</span>}
        <button className="btn sm" onClick={() => download('catalog.json', JSON.stringify(catalog, null, 2), 'application/json')}>
          Export catalog.json
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            if (!window.confirm('Discard all catalog edits and return to the shipped pricing?')) return;
            resetCatalog();
            setCatalog(baseCatalog);
          }}
        >
          Reset
        </button>
        <button className="btn sm primary" onClick={onBack}>
          Back to designer
        </button>
      </header>

      <div style={{ overflowY: 'auto' }}>
        <div className="admin">
          <h1>Catalog &amp; pricing</h1>
          <p className="sub">
            Changes take effect immediately in the designer and are saved in this browser. Export the file and commit it
            to make them permanent for everyone.
          </p>

          <ComponentPricing defaultMarkupPct={catalog.rules.markup.defaultPct} />

          <Sheet title="Branding">
            <table className="grid">
              <tbody>
                {(['productName', 'companyName', 'contactEmail', 'contactPhone', 'accent'] as const).map((k) => (
                  <tr key={k}>
                    <td style={{ width: 200, color: 'var(--text-2)' }}>{k}</td>
                    <td>
                      <input
                        style={{ width: 320 }}
                        value={catalog.branding[k]}
                        onChange={(e) => edit((d) => { d.branding[k] = e.target.value; })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sheet>

          <Sheet title="Models">
            <table className="grid">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Base $/sq ft</th>
                  <th className="num">Setup charge</th>
                  <th className="num">Base eave</th>
                  <th className="num">Base pitch</th>
                </tr>
              </thead>
              <tbody>
                {catalog.models.map((m, i) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <div className="sub" style={{ color: 'var(--text-3)', fontSize: 11 }}>{m.tagline}</div>
                    </td>
                    <td className="num"><Num value={m.basePricePerSqFt} onChange={(v) => edit((d) => { d.models[i].basePricePerSqFt = v; })} /></td>
                    <td className="num"><Num value={m.baseCharge} step={25} onChange={(v) => edit((d) => { d.models[i].baseCharge = v; })} /></td>
                    <td className="num"><Num value={m.baseEaveHeight} step={1} onChange={(v) => edit((d) => { d.models[i].baseEaveHeight = v; })} /></td>
                    <td className="num"><Num value={m.basePitch} step={1} onChange={(v) => edit((d) => { d.models[i].basePitch = v; })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sheet>

          <Sheet title="Siding">
            {priceList(catalog.sidings, (s) => s.pricePerSqFt, (d, i, v) => { d.sidings[i].pricePerSqFt = v; }, '$ / sq ft')}
          </Sheet>

          <Sheet title="Roofing">
            {priceList(catalog.roofings, (r) => r.pricePerSqFt, (d, i, v) => { d.roofings[i].pricePerSqFt = v; }, '$ / sq ft')}
          </Sheet>

          <Sheet title="Colors">
            <table className="grid">
              <thead>
                <tr>
                  <th>Color</th>
                  <th>Hex</th>
                  <th className="num">Upcharge $/sq ft</th>
                </tr>
              </thead>
              <tbody>
                {catalog.colors.map((c, i) => (
                  <tr key={c.id}>
                    <td>
                      <span
                        style={{
                          display: 'inline-block', width: 14, height: 14, borderRadius: 3,
                          background: c.hex, border: '1px solid rgba(0,0,0,.2)',
                          verticalAlign: '-2px', marginRight: 8,
                        }}
                      />
                      {c.name}
                    </td>
                    <td>
                      <input style={{ width: 100 }} value={c.hex} onChange={(e) => edit((d) => { d.colors[i].hex = e.target.value; })} />
                    </td>
                    <td className="num">
                      <Num value={c.upchargePerSqFt} onChange={(v) => edit((d) => { d.colors[i].upchargePerSqFt = v; })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sheet>

          <Sheet title="Doors & windows">
            {priceList(catalog.openingTypes, (o) => o.price, (d, i, v) => { d.openingTypes[i].price = v; }, '$ each')}
          </Sheet>

          <Sheet title="Foundations">
            {priceList(catalog.floors, (f) => f.pricePerSqFt, (d, i, v) => { d.floors[i].pricePerSqFt = v; }, '$ / sq ft')}
          </Sheet>

          <Sheet title="Add-ons">
            <table className="grid">
              <thead>
                <tr>
                  <th>Add-on</th>
                  <th>Basis</th>
                  <th className="num">Price</th>
                </tr>
              </thead>
              <tbody>
                {catalog.addOns.map((a, i) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{a.category}</div>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{a.basis}</td>
                    <td className="num"><Num value={a.price} onChange={(v) => edit((d) => { d.addOns[i].price = v; })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sheet>

          <Sheet title="Rules">
            <table className="grid">
              <tbody>
                <tr>
                  <td>Tax rate</td>
                  <td className="num"><Num value={catalog.rules.taxRate} step={0.0025} onChange={(v) => edit((d) => { d.rules.taxRate = v; })} /></td>
                </tr>
                <tr>
                  <td>Freight base / per mile / free radius / default miles</td>
                  <td className="num" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Num value={catalog.rules.freight.baseCharge} step={25} onChange={(v) => edit((d) => { d.rules.freight.baseCharge = v; })} />
                    <Num value={catalog.rules.freight.perMile} onChange={(v) => edit((d) => { d.rules.freight.perMile = v; })} />
                    <Num value={catalog.rules.freight.freeRadiusMiles} step={5} onChange={(v) => edit((d) => { d.rules.freight.freeRadiusMiles = v; })} />
                    <Num value={catalog.rules.freight.defaultMiles} step={5} onChange={(v) => edit((d) => { d.rules.freight.defaultMiles = v; })} />
                  </td>
                </tr>
                <tr>
                  <td>Financing months / APR % / down %</td>
                  <td className="num" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Num value={catalog.rules.financing.months} step={6} onChange={(v) => edit((d) => { d.rules.financing.months = v; })} />
                    <Num value={catalog.rules.financing.apr} step={0.1} onChange={(v) => edit((d) => { d.rules.financing.apr = v; })} />
                    <Num value={catalog.rules.financing.downPct} step={1} onChange={(v) => edit((d) => { d.rules.financing.downPct = v; })} />
                  </td>
                </tr>
                <tr>
                  <td>Extra eave height $/ft per perimeter ft</td>
                  <td className="num"><Num value={catalog.rules.heightAdderPerFtPerPerimeterFt} onChange={(v) => edit((d) => { d.rules.heightAdderPerFtPerPerimeterFt = v; })} /></td>
                </tr>
                <tr>
                  <td>Pitch adder $/rise per roof sq ft</td>
                  <td className="num"><Num value={catalog.rules.pitchAdderPerRisePerSqFt} onChange={(v) => edit((d) => { d.rules.pitchAdderPerRisePerSqFt = v; })} /></td>
                </tr>
              </tbody>
            </table>
          </Sheet>

          <Sheet title="Cost factors (cost ÷ price, drives margin)">
            <table className="grid">
              <tbody>
                {Object.entries(catalog.rules.costFactors).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num">
                      <Num value={v} step={0.01} onChange={(n) => edit((d) => { d.rules.costFactors[k] = n; })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sheet>

          <Sheet title={`Leads (${leads.length})`}>
            {leads.length === 0 ? (
              <p style={{ padding: '14px 16px', color: 'var(--text-2)', fontSize: 13, margin: 0 }}>
                No quote requests captured yet.
              </p>
            ) : (
              <>
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Quote</th>
                      <th>Contact</th>
                      <th className="num">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => (
                      <tr key={l.id}>
                        <td>{new Date(l.createdAt).toLocaleString()}</td>
                        <td>{l.quoteNo}</td>
                        <td>
                          <strong>{l.name || '—'}</strong>
                          <div style={{ color: 'var(--text-3)', fontSize: 11 }}>
                            {[l.email, l.phone, l.zip].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td className="num">{money(l.total)}</td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          <a className="btn sm" href={l.shareLink} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                            Open
                          </a>{' '}
                          <button
                            className="btn sm ghost"
                            onClick={() => {
                              deleteLead(l.id);
                              setLeads(listLeads());
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: 12 }}>
                  <button className="btn sm" onClick={() => download('leads.csv', leadsToCsv(leads), 'text/csv')}>
                    Export CSV
                  </button>
                </div>
              </>
            )}
          </Sheet>
        </div>
      </div>
    </div>
  );
}
