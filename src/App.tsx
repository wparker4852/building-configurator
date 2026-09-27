// Entry shell. Everything is driven off the URL so the same build serves the
// public site, the embedded widget and the internal tool:
//
//   /                       customer configurator
//   /?mode=internal         internal configurator (cost, margin, discount)
//   /?mode=internal&view=admin   catalog + leads admin
//   /?embed=1               chromeless, for the iframe widget
//   #d=<token>              a saved design

import { useEffect, useMemo, useState } from 'react';
import type { Audience, Catalog } from './core/types';
import { loadCatalog } from './core/catalog';
import ConfiguratorApp from './ui/ConfiguratorApp';
import AdminApp from './ui/AdminApp';
import './ui/theme.css';

type Screen = 'configurator' | 'admin';

/** Perceived brightness of a hex color, 0..1. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Darken a hex color toward black. */
function shadeDown(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  const k = (c: number) => Math.round(c * (1 - amount));
  const hex6 = ((1 << 24) | (k((n >> 16) & 255) << 16) | (k((n >> 8) & 255) << 8) | k(n & 255)).toString(16).slice(1);
  return `#${hex6}`;
}

/** Lighten a hex color toward white, for the accent tint. */
function tint(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#f6f7f9';
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const audience: Audience = params.get('mode') === 'internal' ? 'internal' : 'customer';
  const embed = params.get('embed') === '1';

  const [catalog, setCatalog] = useState<Catalog>(() => loadCatalog());
  const [screen, setScreen] = useState<Screen>(
    audience === 'internal' && params.get('view') === 'admin' ? 'admin' : 'configurator',
  );

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', catalog.branding.accent);
    root.style.setProperty('--accent-soft', tint(catalog.branding.accent, 0.85));
    // Text that sits on the accent: black on a light brand colour (Walker
    // yellow), white on a dark one. And a darker shade for thin lines and
    // small marks, where the raw accent would wash out against white.
    root.style.setProperty('--accent-ink', luminance(catalog.branding.accent) > 0.55 ? '#000000' : '#ffffff');
    root.style.setProperty('--accent-strong', shadeDown(catalog.branding.accent, 0.33));
    document.title = `${catalog.branding.productName} — ${catalog.branding.companyName}`;
  }, [catalog.branding]);

  if (screen === 'admin') {
    return <AdminApp catalog={catalog} setCatalog={setCatalog} onBack={() => setScreen('configurator')} />;
  }

  return (
    <ConfiguratorApp
      catalog={catalog}
      audience={audience}
      embed={embed}
      initialModelId={params.get('model')}
      onOpenAdmin={audience === 'internal' && !embed ? () => setScreen('admin') : undefined}
    />
  );
}
