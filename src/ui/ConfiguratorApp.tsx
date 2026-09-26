// The configurator shell: 3D stage, option panel and price rail.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Audience, BuildingConfig, Catalog } from '../core/types';
import { buildGeometry } from '../core/geometry';
import { money, priceBuilding } from '../core/pricing';
import { normalizeConfig } from '../core/validate';
import { defaultConfigFor } from '../core/catalog';
import { readConfigFromUrl, shareLinkFor, writeConfigToUrl } from '../core/serialize';
import { saveLead } from '../core/leads';
import Scene, { type CameraView, type ViewPreset } from '../viewer/Scene';
import OptionPanel from './OptionPanel';
import PriceSummary from './PriceSummary';
import QuoteDialog from './QuoteDialog';
import { buildQuoteHtml, openQuoteDocument, quoteNumber, type Lead } from './quoteDoc';

const VIEWS: { id: ViewPreset; label: string }[] = [
  { id: 'iso', label: '3D' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
  { id: 'top', label: 'Top' },
];

/** Notify a host page when the widget is running inside an iframe. */
function postToHost(message: Record<string, unknown>) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage(message, '*');
  } catch {
    // Cross-origin parents that reject messages are not an error here.
  }
}

export default function ConfiguratorApp({
  catalog,
  audience,
  embed,
  initialModelId,
  onOpenAdmin,
}: {
  catalog: Catalog;
  audience: Audience;
  embed: boolean;
  initialModelId?: string | null;
  onOpenAdmin?: () => void;
}) {
  const [cfg, setCfg] = useState<BuildingConfig>(() => {
    const fromUrl = readConfigFromUrl();
    const startModel =
      initialModelId && catalog.models.some((m) => m.id === initialModelId)
        ? initialModelId
        : catalog.models[0].id;
    const seed = fromUrl ?? defaultConfigFor(startModel, catalog);
    return normalizeConfig(seed, catalog);
  });
  const [view, setView] = useState<CameraView>({ preset: 'iso', nonce: 0 });
  const [showDimensions, setShowDimensions] = useState(true);
  const [frameOnly, setFrameOnly] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const captureRef = useRef<(() => string) | null>(null);

  const geo = useMemo(() => buildGeometry(cfg, catalog), [cfg, catalog]);
  const quote = useMemo(() => priceBuilding(cfg, catalog, geo), [cfg, catalog, geo]);

  // Keep the URL in step with the design so a refresh or a copied link works.
  useEffect(() => {
    const t = setTimeout(() => writeConfigToUrl(cfg), 300);
    return () => clearTimeout(t);
  }, [cfg]);

  useEffect(() => {
    postToHost({ type: 'bc:ready' });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const update = useCallback(
    (patch: Partial<BuildingConfig>) => setCfg((prev) => normalizeConfig({ ...prev, ...patch }, catalog)),
    [catalog],
  );

  const setModel = useCallback(
    (modelId: string) => setCfg(normalizeConfig(defaultConfigFor(modelId, catalog), catalog)),
    [catalog],
  );

  const share = useCallback(async () => {
    const link = shareLinkFor(cfg);
    try {
      await navigator.clipboard.writeText(link);
      setToast('Design link copied to your clipboard');
    } catch {
      window.prompt('Copy this link to save or share your design:', link);
    }
  }, [cfg]);

  const submitQuote = useCallback(
    (lead: Lead) => {
      const quoteNo = quoteNumber();
      const shareLink = shareLinkFor(cfg);
      let image: string | null = null;
      try {
        image = captureRef.current?.() ?? null;
      } catch {
        // A tainted or lost context just means the quote prints without the render.
      }

      saveLead({
        quoteNo,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        zip: lead.zip,
        notes: lead.notes,
        modelId: cfg.modelId,
        total: quote.total,
        shareLink,
        audience,
      });

      postToHost({
        type: 'bc:lead',
        quoteNo,
        modelId: cfg.modelId,
        total: quote.total,
        shareLink,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        zip: lead.zip,
      });

      openQuoteDocument(
        buildQuoteHtml({ cfg, catalog, geo, quote, lead, image, audience, shareLink, quoteNo }),
      );
      setQuoteOpen(false);
      setToast(audience === 'internal' ? `Quote sheet ${quoteNo} generated` : "Thanks — we'll be in touch shortly");
    },
    [cfg, catalog, geo, quote, audience],
  );

  const model = catalog.models.find((m) => m.id === cfg.modelId);

  return (
    <div className={`app${embed ? ' embed' : ''}`}>
      <header className="topbar">
        <div className="brand">
          {catalog.branding.productName}
          <span className="co">{catalog.branding.companyName}</span>
        </div>
        <div className="spacer" />
        <span className="badge">{model?.name}</span>
        {audience === 'internal' && <span className="badge internal">Internal</span>}
        {onOpenAdmin && (
          <button className="btn sm ghost" onClick={onOpenAdmin}>
            Admin
          </button>
        )}
      </header>

      <div className="layout">
        <OptionPanel
          cfg={cfg}
          catalog={catalog}
          geo={geo}
          audience={audience}
          update={update}
          setModel={setModel}
        />

        <div className="stage">
          <div className="stage-tools">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                className="chip"
                aria-pressed={view.preset === v.id}
                onClick={() => setView((s) => ({ preset: v.id, nonce: s.nonce + 1 }))}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="stage-tools right">
            <button className="chip" aria-pressed={frameOnly} onClick={() => setFrameOnly((s) => !s)}>
              Frame only
            </button>
            <button className="chip" aria-pressed={showDimensions} onClick={() => setShowDimensions((s) => !s)}>
              Dimensions
            </button>
          </div>
          <Scene
            cfg={cfg}
            catalog={catalog}
            geo={geo}
            view={view}
            showDimensions={showDimensions}
            frameOnly={frameOnly}
            onCaptureReady={(fn) => {
              captureRef.current = fn;
            }}
          />
        </div>

        <PriceSummary
          cfg={cfg}
          catalog={catalog}
          geo={geo}
          quote={quote}
          audience={audience}
          onRequestQuote={() => setQuoteOpen(true)}
          onShare={share}
          shareLabel="Save & share design"
        />
      </div>

      {quoteOpen && (
        <QuoteDialog
          audience={audience}
          total={money(quote.total)}
          onClose={() => setQuoteOpen(false)}
          onSubmit={submitQuote}
        />
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#16191d',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
            zIndex: 60,
          }}
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
