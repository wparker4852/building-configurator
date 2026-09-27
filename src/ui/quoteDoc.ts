// Builds a self-contained, printable quote document.
//
// The 3D view is baked in as a data URI, so the file can be saved, emailed or
// printed to PDF with nothing else attached.

import type { Audience, BuildingConfig, Catalog, Quote } from '../core/types';
import type { BuildingGeometry } from '../core/geometry';
import { money, monthlyPayment } from '../core/pricing';
import { feetInches } from '../core/format';
import { BRAND } from './brand';

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
  // Described the way the book prices it: sides as a pair, ends one by one.
  const open = !cfg.sidesClosed && cfg.endsClosed === 0;
  const enclosure = open
    ? 'Open'
    : [
        cfg.sidesClosed ? 'both sides closed' : 'sides open',
        cfg.endsClosed === 2 ? 'both ends closed' : cfg.endsClosed === 1 ? 'back end closed' : 'ends open',
      ].join(', ').replace(/^./, (c) => c.toUpperCase());
  const m = geo.metrics;
  const legs = geo.legStyle === 'single' ? 'single legs' : `${geo.legStyle} legs`;

  return [
    ['Building', model?.name ?? cfg.modelId],
    ['Size', `${cfg.width}' W × ${cfg.length}' L × ${cfg.eaveHeight}' eave (${m.footprint.toLocaleString()} sq ft)`],
    ['Peak height', `${m.peakHeight.toFixed(1)} ft`],
    ['Inside clear', `${feetInches(m.clearWidth)} wide × ${feetInches(m.clearLength)} long · ${feetInches(m.clearHeight)} under the truss · ${feetInches(m.sideClearHeight)} at the sidewall`],
    ['Frame', `${name(catalog.gauges, cfg.gaugeId)} · ${legs} · ${cfg.onCenter}' on center`],
    ['Roof', `${name(catalog.roofStyles, cfg.roofStyle)} · ${cfg.pitch}/12 · ${name(catalog.roofings, cfg.roofingId)}`],
    ['Roof color', name(catalog.colors, cfg.roofColorId)],
    ['Walls', `${enclosure}${open ? '' : ` · ${name(catalog.sidings, cfg.sidingId)}`}`],
    ['Siding color', open ? '—' : name(catalog.colors, cfg.sidingColorId)],
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
  // Walker yellow for the rules, bars and total; the site without its scheme for the footer.
  const Y = esc(brand.accent || BRAND.colors.yellow);
  const site = brand.website?.replace(/^https?:\/\//, '');
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Questrial&display=swap" rel="stylesheet">
<style>
  /* Walker Buildings: yellow ${Y}, black, grey #575757, white. Colours print as shown. */
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 13px/1.5 'Questrial', ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif; color: #000; margin: 0; padding: 28px 34px; background: #fff; }
  .head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; }
  .logo { height: 58px; width: auto; display: block; }
  .meta { text-align: right; font-size: 12px; color: #575757; }
  .meta .title { font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 22px; letter-spacing: 0.06em; color: #000; line-height: 1.1; }
  .meta strong { display: block; font-size: 14px; color: #000; font-weight: 600; margin-top: 4px; }
  .rule { height: 6px; background: ${Y}; border-radius: 2px; margin-bottom: 20px; }
  h2 { font-family: 'Poppins', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
       color: #000; margin: 22px 0 8px; padding-left: 9px; border-left: 4px solid ${Y}; line-height: 1.2; }
  /* The canvas is taller than the building needs; crop to the interesting part. */
  .hero { width: 100%; height: 3.4in; object-fit: cover; object-position: 50% 58%;
          border-radius: 8px; border: 1px solid #d8d8d8; display: block; }
  .cols { display: flex; gap: 26px; align-items: flex-start; }
  .cols > * { flex: 1; min-width: 0; }
  table { width: 100%; border-collapse: collapse; }
  table.spec th { text-align: left; font-weight: 400; color: #575757; width: 38%; padding: 4px 0; vertical-align: top; font-size: 12px; }
  table.spec td { padding: 4px 0; font-size: 12px; }
  table.items th { text-align: left; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 10.5px; text-transform: uppercase;
                   letter-spacing: 0.05em; color: #fff; background: #000; padding: 7px 8px; }
  table.items td { padding: 7px 8px; border-bottom: 1px solid #d8d8d8; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #f4f4f4; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sub { font-size: 11px; color: #727272; }
  .muted { color: #727272; }
  .totals { margin-left: auto; width: 330px; margin-top: 10px; }
  .totals tr td { padding: 4px 10px; }
  .totals tr.grand td { font-family: 'Poppins', sans-serif; font-size: 17px; font-weight: 700; background: ${Y}; color: #000; padding: 9px 10px; }
  .callout { background: #f4f4f4; border-left: 4px solid ${Y}; border-radius: 4px; padding: 12px 14px; font-size: 12px; margin-top: 4px; }
  .foot { margin-top: 26px; padding-top: 12px; border-top: 2px solid #000; font-size: 11px; color: #575757; display: flex; gap: 14px; align-items: flex-start; }
  .foot .badge { width: 40px; height: 40px; flex: none; }
  .foot .co { font-family: 'Poppins', sans-serif; font-weight: 600; color: #000; font-size: 12px; }
  .link { word-break: break-all; color: #000; text-decoration: underline; text-decoration-color: ${Y}; text-decoration-thickness: 2px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style></head>
<body>
  <div class="head">
    <img class="logo" src="${BRAND.wordmarkInline}" alt="${esc(brand.companyName)}">
    <div class="meta">
      <div class="title">${internal ? 'INTERNAL QUOTE' : 'QUOTE'}</div>
      <strong>${esc(quoteNo)}</strong>${esc(date)}
    </div>
  </div>
  <div class="rule"></div>

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
    <img class="badge" src="${BRAND.badgeInline}" alt="">
    <div>
    <div class="co">${esc(brand.companyName)} &middot; ${esc(brand.contactPhone)} &middot; ${esc(brand.contactEmail)}${site ? ` &middot; ${esc(site)}` : ''}</div>
    Pricing is an estimate based on the selections shown and is valid for 30 days. Final pricing is confirmed
    after a site review; permits, site access and ground conditions may affect the installed cost.
    <br><br><a class="link" href="${esc(shareLink)}">Reopen this exact design in the designer</a>
    &mdash; the link is preserved if you save this page as a PDF.
    </div>
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
