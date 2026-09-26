// Builds a self-contained, printable quote document.
//
// The 3D view is baked in as a data URI, so the file can be saved, emailed or
// printed to PDF with nothing else attached.

import type { Audience, BuildingConfig, Catalog, Quote } from '../core/types';
import type { BuildingGeometry } from '../core/geometry';
import { money, monthlyPayment } from '../core/pricing';

export interface Lead {
  name: string;
  email: string;
  phone: string;
  zip: string;
  notes: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function specRows(cfg: BuildingConfig, catalog: Catalog, geo: BuildingGeometry): [string, string][] {
  const name = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? '—';
  const model = catalog.models.find((m) => m.id === cfg.modelId);
  const enclosure =
    cfg.enclosure === 'enclosed' ? 'Fully enclosed' : cfg.enclosure === 'partial' ? 'Enclosed on 3 sides' : 'Open';

  return [
    ['Building', model?.name ?? cfg.modelId],
    ['Size', `${cfg.width}' W × ${cfg.length}' L × ${cfg.eaveHeight}' eave (${geo.metrics.footprint.toLocaleString()} sq ft)`],
    ['Peak height', `${geo.metrics.peakHeight.toFixed(1)} ft`],
    ['Roof', `${name(catalog.roofStyles, cfg.roofStyle)} · ${cfg.pitch}/12 · ${name(catalog.roofings, cfg.roofingId)}`],
    ['Roof color', name(catalog.colors, cfg.roofColorId)],
    ['Walls', `${enclosure}${cfg.enclosure === 'open' ? '' : ` · ${name(catalog.sidings, cfg.sidingId)}`}`],
    ['Siding color', cfg.enclosure === 'open' ? '—' : name(catalog.colors, cfg.sidingColorId)],
    ['Trim color', name(catalog.colors, cfg.trimColorId)],
    ['Foundation', name(catalog.floors, cfg.floorId)],
    ['Overhangs', `${cfg.eaveOverhang}' eave · ${cfg.gableOverhang}' gable`],
  ];
}

export function quoteNumber(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `Q-${stamp}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

export function buildQuoteHtml(opts: {
  cfg: BuildingConfig;
  catalog: Catalog;
  geo: BuildingGeometry;
  quote: Quote;
  lead: Lead;
  image: string | null;
  audience: Audience;
  shareLink: string;
  quoteNo: string;
}): string {
  const { cfg, catalog, geo, quote, lead, image, audience, shareLink, quoteNo } = opts;
  const brand = catalog.branding;
  const internal = audience === 'internal';
  const monthly = monthlyPayment(catalog, quote.total);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const specs = specRows(cfg, catalog, geo)
    .map(
      ([k, v]) =>
        `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`,
    )
    .join('');

  const lines = quote.lines
    .map(
      (l) => `<tr>
        <td><strong>${esc(l.label)}</strong>${l.detail ? `<div class="sub">${esc(l.detail)}</div>` : ''}</td>
        <td class="num">${l.qty.toLocaleString()} ${esc(l.unit)}</td>
        <td class="num">${money(l.unitPrice, true)}</td>
        ${internal ? `<td class="num muted">${money(l.cost)}</td>` : ''}
        <td class="num">${money(l.total)}</td>
      </tr>`,
    )
    .join('');

  const contact = [lead.name, lead.email, lead.phone, lead.zip ? `ZIP ${lead.zip}` : '']
    .filter(Boolean)
    .map(esc)
    .join(' &middot; ');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(quoteNo)} — ${esc(brand.companyName)}</title>
<style>
  @page { size: letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; color: #16191d; margin: 0; padding: 28px 34px; background: #fff; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${esc(brand.accent)}; padding-bottom: 14px; margin-bottom: 20px; }
  .co { font-size: 20px; font-weight: 750; letter-spacing: -0.01em; }
  .co small { display: block; font-size: 11.5px; font-weight: 500; color: #666; letter-spacing: 0; margin-top: 2px; }
  .meta { text-align: right; font-size: 12px; color: #555; }
  .meta strong { display: block; font-size: 15px; color: #16191d; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #7a828c; margin: 22px 0 8px; }
  /* The canvas is taller than the building needs; crop to the interesting part. */
  .hero { width: 100%; height: 3.4in; object-fit: cover; object-position: 50% 58%;
          border-radius: 10px; border: 1px solid #e2e5e9; display: block; }
  .cols { display: flex; gap: 26px; align-items: flex-start; }
  .cols > * { flex: 1; min-width: 0; }
  table { width: 100%; border-collapse: collapse; }
  table.spec th { text-align: left; font-weight: 600; color: #6b7280; width: 38%; padding: 4px 0; vertical-align: top; font-size: 12px; }
  table.spec td { padding: 4px 0; font-size: 12px; }
  table.items th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #7a828c; border-bottom: 2px solid #e2e5e9; padding: 6px 8px; }
  table.items td { padding: 7px 8px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sub { font-size: 11px; color: #8b939d; }
  .muted { color: #8b939d; }
  .totals { margin-left: auto; width: 320px; margin-top: 10px; }
  .totals tr td { padding: 4px 8px; }
  .totals tr.grand td { font-size: 17px; font-weight: 750; border-top: 2px solid #16191d; padding-top: 9px; }
  .callout { background: #f6f7f9; border-radius: 9px; padding: 12px 14px; font-size: 12px; margin-top: 14px; }
  .foot { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e2e5e9; font-size: 11px; color: #7a828c; }
  .link { word-break: break-all; color: #3b6ea5; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style></head>
<body>
  <div class="head">
    <div class="co">${esc(brand.companyName)}<small>${esc(brand.productName)} · ${esc(brand.contactPhone)} · ${esc(brand.contactEmail)}</small></div>
    <div class="meta"><strong>${esc(quoteNo)}</strong>${esc(date)}${internal ? '<br><em>Internal copy</em>' : ''}</div>
  </div>

  ${contact ? `<div class="callout"><strong>Prepared for</strong><br>${contact}${lead.notes ? `<br><span class="muted">${esc(lead.notes)}</span>` : ''}</div>` : ''}

  ${image ? `<h2>Your design</h2><img class="hero" src="${image}" alt="3D view of the building">` : ''}

  <div class="cols">
    <div>
      <h2>Specification</h2>
      <table class="spec">${specs}</table>
    </div>
    <div>
      <h2>Summary</h2>
      <table class="spec">
        <tr><th>Footprint</th><td>${geo.metrics.footprint.toLocaleString()} sq ft</td></tr>
        <tr><th>Wall area</th><td>${Math.round(geo.metrics.wallArea).toLocaleString()} sq ft</td></tr>
        <tr><th>Roof area</th><td>${Math.round(geo.metrics.roofArea).toLocaleString()} sq ft</td></tr>
        <tr><th>Doors &amp; windows</th><td>${cfg.openings.length}</td></tr>
        ${monthly > 0 ? `<tr><th>Est. monthly</th><td>${money(monthly)}/mo · ${catalog.rules.financing.months} mo @ ${catalog.rules.financing.apr}% APR, ${catalog.rules.financing.downPct}% down</td></tr>` : ''}
      </table>
    </div>
  </div>

  <h2>Line items</h2>
  <table class="items">
    <thead><tr>
      <th>Item</th><th class="num">Qty</th><th class="num">Unit</th>
      ${internal ? '<th class="num">Cost</th>' : ''}
      <th class="num">Amount</th>
    </tr></thead>
    <tbody>${lines}</tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal</td><td class="num">${money(quote.subtotal)}</td></tr>
    ${quote.discount > 0 ? `<tr><td>Discount (${cfg.discountPct}%)</td><td class="num">&minus;${money(quote.discount)}</td></tr>` : ''}
    <tr><td>Delivery &amp; install</td><td class="num">${money(quote.freight)}</td></tr>
    <tr><td>Tax</td><td class="num">${money(quote.tax)}</td></tr>
    <tr class="grand"><td>Total</td><td class="num">${money(quote.total)}</td></tr>
    ${internal ? `<tr><td class="muted">Est. cost</td><td class="num muted">${money(quote.cost)}</td></tr>
    <tr><td class="muted">Gross profit</td><td class="num muted">${money(quote.grossProfit)} (${quote.marginPct.toFixed(1)}%)</td></tr>` : ''}
  </table>

  <div class="foot">
    Pricing is an estimate based on the selections shown and is valid for 30 days. Final pricing is confirmed
    after a site review; permits, site access and ground conditions may affect the installed cost.
    <br><br><a class="link" href="${esc(shareLink)}">Reopen this exact design in the designer</a>
    &mdash; the link is preserved if you save this page as a PDF.
  </div>

  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 350); });</script>
</body></html>`;
}

/** Open the quote in a new tab and trigger the print dialog. */
export function openQuoteDocument(html: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup blocked: fall back to a download so the quote is never lost.
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quote.html';
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
