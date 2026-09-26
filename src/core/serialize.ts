// Config <-> URL round-tripping.
//
// A design lives entirely in the URL hash, so a customer can send their
// building to a salesperson (or reload the page) with nothing stored anywhere.

import type { BuildingConfig } from './types';

const PREFIX = '#d=';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Shorten the payload by dropping defaults that the normalizer restores. */
function compact(cfg: BuildingConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  if (!cfg.discountPct) delete out.discountPct;
  if (!cfg.zip) delete out.zip;
  if (Object.keys(cfg.quantities ?? {}).length === 0) delete out.quantities;
  // Openings carry generated ids that do not need to travel.
  out.openings = cfg.openings.map((o) => [o.catalogId, o.wall, o.offset, o.sill]);
  return out;
}

function expand(raw: Record<string, unknown>): BuildingConfig {
  const openings = Array.isArray(raw.openings)
    ? (raw.openings as unknown[]).map((o, i) => {
        if (Array.isArray(o)) {
          const [catalogId, wall, offset, sill] = o as [string, BuildingConfig['openings'][number]['wall'], number, number];
          return { id: `u${i}`, catalogId, wall, offset, sill };
        }
        return o as BuildingConfig['openings'][number];
      })
    : [];
  return { ...(raw as unknown as BuildingConfig), openings, quantities: (raw.quantities as Record<string, number>) ?? {} };
}

export function encodeConfig(cfg: BuildingConfig): string {
  return toBase64Url(JSON.stringify(compact(cfg)));
}

export function decodeConfig(token: string): BuildingConfig | null {
  try {
    const parsed = JSON.parse(fromBase64Url(token));
    if (!parsed || typeof parsed !== 'object' || !parsed.modelId) return null;
    return expand(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Read a design out of the current URL hash, if there is one. */
export function readConfigFromUrl(): BuildingConfig | null {
  const hash = window.location.hash;
  if (!hash.startsWith(PREFIX)) return null;
  return decodeConfig(hash.slice(PREFIX.length));
}

/** Replace the hash without adding a history entry. */
export function writeConfigToUrl(cfg: BuildingConfig): void {
  const url = `${window.location.pathname}${window.location.search}${PREFIX}${encodeConfig(cfg)}`;
  window.history.replaceState(null, '', url);
}

/** A full shareable link for the current design. */
export function shareLinkFor(cfg: BuildingConfig): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}${PREFIX}${encodeConfig(cfg)}`;
}
