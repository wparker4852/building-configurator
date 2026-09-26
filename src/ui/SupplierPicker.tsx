// Pick a manufacturer by its logo. One click re-prices the whole building.
//
// Real logo artwork drops into public/logos/ and is picked up automatically
// via Supplier.logo.file. Until a file is there, a branded monogram tile
// stands in, so nothing depends on artwork that may not exist yet.

import { useState } from 'react';
import type { Supplier } from '../core/suppliers';

function LogoTile({ supplier, selected }: { supplier: Supplier; selected: boolean }) {
  const { logo } = supplier;
  const [failed, setFailed] = useState(false);
  const showImage = !!logo.file && !failed;

  return (
    <span className="logo-tile" style={{ '--brand': logo.color } as React.CSSProperties}>
      {showImage ? (
        <img src={logo.file} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="logo-mark" aria-hidden="true">
          {logo.mark}
        </span>
      )}
      {selected && <span className="logo-check" aria-hidden="true">&#10003;</span>}
    </span>
  );
}

export default function SupplierPicker({
  suppliers,
  value,
  onChange,
  /** Widths each supplier can't build, so the UI can warn before switching. */
  currentWidth,
}: {
  suppliers: Supplier[];
  value: string;
  onChange: (id: string) => void;
  currentWidth?: number;
}) {
  return (
    <div className="supplier-grid" role="radiogroup" aria-label="Supplier">
      {suppliers.map((s) => {
        const selected = s.id === value;
        const fits = currentWidth == null || s.widths.includes(currentWidth);
        return (
          <button
            key={s.id}
            className="supplier-card"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(s.id)}
            title={s.blurb}
          >
            <LogoTile supplier={s} selected={selected} />
            <span className="supplier-name">{s.name}</span>
            <span className="supplier-blurb">{s.blurb}</span>
            {!fits && (
              <span className="supplier-warn">
                Doesn&rsquo;t build {currentWidth}&prime; &mdash; size will change
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
