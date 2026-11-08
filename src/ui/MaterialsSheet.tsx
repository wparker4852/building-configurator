// Admin: the Materials price list behind takeoff pricing (lean-tos now,
// partition walls next). Every figure is cost; the category markup below it
// makes the sell price.

import type { Catalog, MaterialCosts } from '../core/types';

function Cost({ value, onChange, step = 0.01, placeholder }: { value: number | null; onChange: (n: number | null) => void; step?: number; placeholder?: string }) {
  return (
    <input
      type="number"
      step={step}
      className="num"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export default function MaterialsSheet({ catalog, edit }: { catalog: Catalog; edit: (mutate: (d: Catalog) => void) => void }) {
  const m = catalog.materials;
  if (!m) return <p style={{ padding: '14px 16px', margin: 0 }}>No materials price list is loaded.</p>;

  const row = (label: string, value: number | null, set: (d: MaterialCosts, v: number | null) => void, unit: string, note?: string) => (
    <tr key={label}>
      <td>
        {label}
        {note && <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{note}</div>}
      </td>
      <td className="num">
        <Cost
          value={value}
          placeholder="not set"
          onChange={(v) =>
            edit((d) => {
              if (d.materials) set(d.materials, v);
            })
          }
        />
      </td>
      <td style={{ color: 'var(--text-2)' }}>{unit}</td>
    </tr>
  );
  const num = (v: number | null) => v ?? 0;

  return (
    <>
      <p style={{ padding: '12px 16px 0', margin: 0, fontSize: 12.5, color: 'var(--text-2)' }}>
        Cost of goods for anything priced by takeoff &mdash; the configurator counts the feet of tube, panel and trim it
        draws and prices them here. Source: {m.source}.
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Cost</th>
            <th>Per</th>
          </tr>
        </thead>
        <tbody>
          <tr className="cat-row"><td colSpan={3}>Frame</td></tr>
          {Object.keys(m.tubePerFt).map((g) =>
            row(`${g.replace('ga', ' gauge')} square tube`, m.tubePerFt[g], (d, v) => { d.tubePerFt[g] = num(v); }, 'foot',
              g === '14ga' ? '2½" tube' : g === '12ga' ? '2¼" tube' : undefined),
          )}
          {row('Hat channel', m.hatChannelPerFt, (d, v) => { d.hatChannelPerFt = num(v); }, 'foot')}
          {row('Post anchor', m.anchorEach, (d, v) => { d.anchorEach = num(v); }, 'each')}

          <tr className="cat-row"><td colSpan={3}>Panels</td></tr>
          {Object.keys(m.panelPerFt).map((g) =>
            row(`${g.replace('ga', ' gauge')} AG panel`, m.panelPerFt[g], (d, v) => { d.panelPerFt[g] = num(v); }, 'running foot of panel'),
          )}
          {row('Panel coverage width', m.panelCoverage, (d, v) => { d.panelCoverage = Math.max(0.5, num(v)); }, 'feet')}

          <tr className="cat-row"><td colSpan={3}>Trim</td></tr>
          {row('Eave flashing', m.trimPerFt.eaveFlashing, (d, v) => { d.trimPerFt.eaveFlashing = num(v); }, 'foot')}
          {row('J / L trim (rakes)', m.trimPerFt.jTrim, (d, v) => { d.trimPerFt.jTrim = num(v); }, 'foot')}
          {row('Ridge cap / valley (wall-to-roof, hips)', m.trimPerFt.ridgeValley, (d, v) => { d.trimPerFt.ridgeValley = num(v); }, 'foot')}
          {row('Corner trim', m.trimPerFt.cornerTrim, (d, v) => { d.trimPerFt.cornerTrim = num(v); }, 'foot')}

          <tr className="cat-row"><td colSpan={3}>Fasteners &amp; labor</td></tr>
          {row('Screws per sq ft of panel', m.fastenersPerSqFt, (d, v) => { d.fastenersPerSqFt = num(v); }, 'count', 'An allowance, not a book figure')}
          {row('Screw', m.fastenerEach, (d, v) => { d.fastenerEach = num(v); }, 'each')}
          {row('Install labor', m.laborPerSqFt, (d, v) => { d.laborPerSqFt = v; }, 'sq ft of footprint',
            m.laborPerSqFt == null ? 'Not set: lean-tos show "install labor not set" on the quote until you enter a rate' : undefined)}

          <tr className="cat-row"><td colSpan={3}>Markup</td></tr>
          <tr>
            <td>Lean-tos markup on cost</td>
            <td className="num">
              <Cost
                step={1}
                value={catalog.rules.markup.byCategory['Lean-tos'] ?? catalog.rules.markup.defaultPct}
                onChange={(v) => edit((d) => { d.rules.markup.byCategory['Lean-tos'] = num(v); })}
              />
            </td>
            <td style={{ color: 'var(--text-2)' }}>%</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
