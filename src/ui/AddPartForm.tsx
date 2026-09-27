// Admin: define a new part — from the Walker configurator's "Dev Dashboard".
//
// Doors and windows become opening types (placed on a wall, drawn in 3D and
// framed out); everything else becomes an add-on priced on the chosen basis.
// The JSON preview shows exactly what lands in the catalog.

import { useMemo, useState } from 'react';
import type { AddOn, Catalog, OpeningType, PriceBasis, WallId } from '../core/types';

type PartType = 'overhead' | 'walk' | 'window' | 'framed' | 'addon';
type Placement = 'any' | 'end' | 'side';

const TYPES: { id: PartType; label: string }[] = [
  { id: 'overhead', label: 'Roll-up / garage door' },
  { id: 'walk', label: 'Walk-in door' },
  { id: 'window', label: 'Window' },
  { id: 'framed', label: 'Framed opening (resizable)' },
  { id: 'addon', label: 'Add-on (trim, vents, insulation, anchors…)' },
];

const PLACEMENTS: Record<Placement, WallId[] | 'any'> = {
  any: 'any',
  end: ['front', 'back'],
  side: ['left', 'right'],
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part';

/** Accepts `10`, `10'`, `36"`, `36 in` — inches when marked, feet otherwise. */
function parseFeet(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /("|in)/.test(t) ? n / 12 : n;
}

export default function AddPartForm({ catalog, onAdd }: { catalog: Catalog; onAdd: (mutate: (d: Catalog) => void) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PartType>('overhead');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [placement, setPlacement] = useState<Placement>('any');
  const [basis, setBasis] = useState<PriceBasis>('each');
  const [category, setCategory] = useState('Exterior');
  const [sku, setSku] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addOnCategories = [...new Set(catalog.addOns.map((a) => a.category))];

  const part = useMemo((): OpeningType | AddOn | null => {
    const p = Number(price);
    const id = slug(name);
    if (type === 'addon') {
      return {
        id,
        name: name.trim(),
        description: description.trim(),
        category,
        basis,
        price: Number.isFinite(p) ? p : 0,
        countable: basis === 'each' ? true : undefined,
        sku: sku.trim() || undefined,
      };
    }
    const w = parseFeet(width);
    const h = parseFeet(height);
    if (!w || !h) return null;
    const isWindow = type === 'window';
    return {
      id,
      name: name.trim(),
      category: type,
      width: Math.round(w * 100) / 100,
      height: Math.round(h * 100) / 100,
      defaultSill: isWindow ? 3.5 : 0,
      price: Number.isFinite(p) ? p : 0,
      allowedWalls: PLACEMENTS[placement],
      allowSill: isWindow || type === 'framed',
      ...(type === 'framed' ? { resizable: true, minWidth: 2, maxWidth: 20, minHeight: 2, maxHeight: 16 } : {}),
      sku: sku.trim() || undefined,
      description: description.trim() || undefined,
    };
  }, [name, type, description, price, width, height, placement, basis, category, sku]);

  const submit = () => {
    if (!name.trim()) return setError('Give the part a name.');
    if (!part) return setError('Width and height are needed for a door or window, e.g. 10 or 36".');
    const taken = type === 'addon' ? catalog.addOns : catalog.openingTypes;
    let id = part.id;
    for (let n = 2; taken.some((x) => x.id === id); n++) id = `${part.id}-${n}`;
    const final = { ...part, id };
    onAdd((d) => {
      if (type === 'addon') d.addOns.push(final as AddOn);
      else d.openingTypes.push(final as OpeningType);
    });
    setError(null);
    setName('');
    setDescription('');
    setPrice('');
    setWidth('');
    setHeight('');
    setSku('');
  };

  const isOpening = type !== 'addon';

  return (
    <div className="add-part">
      <div className="add-part-form">
        <label>
          Part name
          <input value={name} placeholder="e.g. Roll-Up Door 12' × 14'" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as PartType)}>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          Description
          <input value={description} placeholder="Short description for customers" onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Price ($)
          <input type="number" value={price} placeholder="0" onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>
          SKU / part no.
          <input value={sku} placeholder="WB-RD-1214" onChange={(e) => setSku(e.target.value)} />
        </label>
        {isOpening ? (
          <>
            <label>
              Width (ft, or in with ")
              <input value={width} placeholder="12" onChange={(e) => setWidth(e.target.value)} />
            </label>
            <label>
              Height (ft, or in with ")
              <input value={height} placeholder="14" onChange={(e) => setHeight(e.target.value)} />
            </label>
            <label>
              Placement
              <select value={placement} onChange={(e) => setPlacement(e.target.value as Placement)}>
                <option value="any">Any wall</option>
                <option value="end">End walls only</option>
                <option value="side">Side walls only</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              Priced per
              <select value={basis} onChange={(e) => setBasis(e.target.value as PriceBasis)}>
                <option value="each">Each</option>
                <option value="footprint">Sq ft of footprint</option>
                <option value="wallArea">Sq ft of wall</option>
                <option value="roofArea">Sq ft of roof</option>
                <option value="perimeter">Linear ft of perimeter</option>
                <option value="length">Linear ft of length</option>
              </select>
            </label>
            <label>
              Section
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {addOnCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="add-part-side">
        <div className="field-label">Catalog entry</div>
        <pre className="json-preview">{part ? JSON.stringify(part, null, 2) : '// width and height needed'}</pre>
        {error && <div className="field-note" style={{ color: 'var(--red)' }}>{error}</div>}
        <button className="btn primary" onClick={submit}>Add to catalog</button>
        <span className="field-note">
          Book-priced items (doors and windows the supplier stocks) still quote from the supplier table; this price is the
          fallback.
        </span>
      </div>
    </div>
  );
}
