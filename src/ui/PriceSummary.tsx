// The price rail: running total, line items, and the calls to action.

import type { Audience, BuildingConfig, Catalog, Quote } from '../core/types';
import type { BuildingGeometry } from '../core/geometry';
import { money, monthlyPayment, taxRateFor } from '../core/pricing';
import { findIssues } from '../core/validate';
import { feetInches } from '../core/format';

function marginClass(pct: number) {
  if (pct >= 32) return 'margin-good';
  if (pct >= 22) return 'margin-ok';
  return 'margin-bad';
}

export default function PriceSummary({
  cfg,
  catalog,
  geo,
  quote,
  audience,
  onRequestQuote,
  onShare,
  shareLabel,
}: {
  cfg: BuildingConfig;
  catalog: Catalog;
  geo: BuildingGeometry;
  quote: Quote;
  audience: Audience;
  onRequestQuote: () => void;
  onShare: () => void;
  shareLabel: string;
}) {
  const monthly = monthlyPayment(catalog, quote.total);
  const issues = findIssues(cfg, catalog);
  const internal = audience === 'internal';

  return (
    <div className="rail">
      <div className="price-head">
        <div className="price-label">{internal ? 'Sell price' : 'Your price'}</div>
        <div className="price-total">{money(quote.total)}</div>
        <div className="price-sub">
          Delivered &amp; installed, tax included
          {monthly > 0 && <> &middot; from {money(monthly)}/mo</>}
        </div>
      </div>

      {/* Anything the supplier's book cannot price is stated, never guessed. */}
      {quote.unpriced.length > 0 && (
        <div className="issues">
          {quote.unpriced.map((u, i) => (
            <div key={i} className="issue error">
              <span>&#9650;</span>
              <span>Not in the price book: {u}</span>
            </div>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <div className="issues">
          {issues.map((issue, i) => (
            <div key={i} className={`issue ${issue.level}`}>
              <span>{issue.level === 'error' ? '▲' : '●'}</span>
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="metrics">
        <div className="metric">
          <div className="k">Footprint</div>
          <div className="v">{geo.metrics.footprint.toLocaleString()} sq ft</div>
        </div>
        <div className="metric">
          <div className="k">Peak height</div>
          <div className="v">{geo.metrics.peakHeight.toFixed(1)} ft</div>
        </div>
        <div className="metric">
          <div className="k">Clear inside</div>
          <div className="v">
            {feetInches(geo.metrics.clearWidth)} &times; {feetInches(geo.metrics.clearLength)}
          </div>
        </div>
        <div className="metric">
          <div className="k">Clear height</div>
          <div className="v">
            {feetInches(geo.metrics.clearHeight)}
            <span style={{ color: 'var(--text-3)', fontWeight: 500, fontSize: 11 }}>
              {' '}&middot; {feetInches(geo.metrics.sideClearHeight)} at wall
            </span>
          </div>
        </div>
        {internal && (
          <>
            <div className="metric">
              <div className="k">Supplier cost</div>
              <div className="v">{money(quote.cost)}</div>
            </div>
            <div className="metric">
              <div className="k">Gross margin</div>
              <div className={`v ${marginClass(quote.marginPct)}`}>
                {quote.marginPct.toFixed(1)}% &middot; {money(quote.grossProfit)}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="lines">
        {quote.lines.map((l) => (
          <div className="line" key={l.key}>
            <span className="grow">
              <span className="l">{l.label}</span>
              {l.detail && <span className="d">{l.detail}</span>}
              {l.unit !== 'ea' || l.qty !== 1 ? (
                <span className="d">
                  {l.qty.toLocaleString()} {l.unit} &times; {money(l.unitPrice, true)}
                  {internal && <> &middot; cost {money(l.cost)}</>}
                </span>
              ) : (
                internal && <span className="d">cost {money(l.cost)}</span>
              )}
            </span>
            <span className="v">{money(l.total)}</span>
          </div>
        ))}
      </div>

      <div className="totals">
        <div className="line">
          <span className="grow">Subtotal</span>
          <span className="v">{money(quote.subtotal)}</span>
        </div>
        {quote.discount > 0 && (
          <div className="line">
            <span className="grow">Discount ({cfg.discountPct}%)</span>
            <span className="v">&minus;{money(quote.discount)}</span>
          </div>
        )}
        <div className="line">
          <span className="grow">
            Delivery &amp; install
            <span className="d">Estimated {catalog.rules.freight.defaultMiles} mi from the plant</span>
          </span>
          <span className="v">{money(quote.freight)}</span>
        </div>
        <div className="line">
          <span className="grow">Tax ({(taxRateFor(catalog, cfg) * 100).toFixed(2)}%{cfg.state ? ` · ${cfg.state}` : ''})</span>
          <span className="v">{money(quote.tax)}</span>
        </div>
        <div className="line tot">
          <span className="grow">Total</span>
          <span className="v">{money(quote.total)}</span>
        </div>
      </div>

      <div className="cta">
        <button className="btn primary" onClick={onRequestQuote}>
          {internal ? 'Build quote sheet' : 'Request my quote'}
        </button>
        <button className="btn" onClick={onShare}>
          {shareLabel}
        </button>
      </div>
    </div>
  );
}
