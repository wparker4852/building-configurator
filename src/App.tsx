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
    root.style.setProperty('--accent-soft', tint(catalog.branding.accent, 0.9));
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
