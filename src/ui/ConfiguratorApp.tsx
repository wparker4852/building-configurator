// The configurator shell: 3D stage, option panel and price rail.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Audience, BuildingConfig, Catalog } from '../core/types';
import { buildGeometry } from '../core/geometry';
import { money, priceBuilding } from '../core/pricing';
import { normalizeConfig } from '../core/validate';
import { defaultConfigFor } from '../core/catalog';
import { readConfigFromUrl, shareLinkFor, writeConfigToUrl } from '../core/serialize';
import { saveLead } from '../core/leads';
import { getSupplier } from '../core/suppliers';
import Scene, { type CameraView, type Layers, type ViewPreset } from '../viewer/Scene';
import { startHeadTracking, type HeadOffset } from '../viewer/headTracking';
import OptionPanel from './OptionPanel';
import FloorPlan from './FloorPlan';
import PriceSummary from './PriceSummary';
import QuoteDialog from './QuoteDialog';
import { BRAND } from './brand';
import { buildQuoteHtml, openQuoteDocument, quoteNumber, type Lead } from './quoteDoc';

const VIEWS: { id: ViewPreset; label: string }[] = [
  { id: 'iso', label: 'Corner' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
  { id: 'top', label: 'Top' },
];

const FEEDBACK_URL: string | undefined = import.meta.env.VITE_FEEDBACK_URL;

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
  /** Orbit outside, stand inside, or look down on the floor plan. */
  const [mode, setMode] = useState<'3d' | 'inside' | '2d'>('3d');
  const [layers, setLayers] = useState<Layers>({ dimensions: true, orientation: false, scenery: true, equipment: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const [frameOnly, setFrameOnly] = useState(false);

  // Head tracking: the offset object is shared with the renderer, which reads
  // it every frame; React only tracks whether tracking is running.
  const headOffset = useRef<HeadOffset>({ theta: 0, phi: 0, zoom: 0 });
  const stopTracking = useRef<(() => void) | null>(null);
  const sensitivity = useRef(0.5);
  const [tracking, setTracking] = useState<'off' | 'starting' | 'on'>('off');
  const [trackError, setTrackError] = useState<string | null>(null);
  const [headOpen, setHeadOpen] = useState(false);
  const [sensPct, setSensPct] = useState(50);

  const startTracking = useCallback(async () => {
    if (tracking !== 'off') return;
    setTracking('starting');
    setTrackError(null);
    try {
      stopTracking.current = await startHeadTracking(headOffset.current, () => sensitivity.current);
      setTracking('on');
    } catch (err) {
      setTracking('off');
      setTrackError(err instanceof Error && err.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'Head tracking could not start.');
    }
  }, [tracking]);
  const endTracking = useCallback(() => {
    stopTracking.current?.();
    stopTracking.current = null;
    setTracking('off');
  }, []);
  useEffect(() => () => stopTracking.current?.(), []);
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

  // What the legs are at this size, and from what height the book upgrades them.
  const supplier = getSupplier(cfg.supplierId);
  const upgradeFrom = supplier.legHeightsFor(cfg.width).find((h) => supplier.legStyleFor(cfg.width, h) !== 'single');
  const legNote =
    geo.legStyle === 'ladder'
      ? `Ladder legs: paired legs 7" apart with rungs every 20" (added steel shown darker)`
      : geo.legStyle === 'double'
        ? `Double legs + double base rail (added steel shown darker)`
        : upgradeFrom != null
          ? `Single legs · ${supplier.name} doubles them from ${upgradeFrom}'`
          : 'Single legs';

  return (
    <div className={`app${embed ? ' embed' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <img className="logo" src={BRAND.wordmark} alt={catalog.branding.companyName} />
          <span className="divider" />
          <span className="product">{catalog.branding.productName}</span>
        </div>
        <div className="spacer" />
        <span className="badge">{model?.name}</span>
        {audience === 'internal' && <span className="badge internal">Internal</span>}
        {/* Test builds only: the deploy sets VITE_FEEDBACK_URL to a GitHub issue form. */}
        {FEEDBACK_URL && (
          <a
            className="btn sm"
            style={{ textDecoration: 'none' }}
            href={`${FEEDBACK_URL}&link=${encodeURIComponent(shareLinkFor(cfg))}`}
            target="_blank"
            rel="noreferrer"
          >
            Feedback
          </a>
        )}
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
            <div className="mode-pill" role="group" aria-label="View">
              {(
                [
                  ['inside', 'Inside'],
                  ['3d', '3D'],
                  ['2d', '2D plan'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={mode === id}
                  onClick={() => {
                    setMode(id);
                    if (id === '3d' && mode === 'inside') setView((s) => ({ preset: 'iso', nonce: s.nonce + 1 }));
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === '3d' &&
              VIEWS.map((v) => (
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
          {mode !== '2d' && (
            <div className="stage-tools right">
              <button className="chip" aria-pressed={frameOnly} onClick={() => setFrameOnly((s) => !s)}>
                Frame only
              </button>
              <div className="pop-wrap">
                <button className="chip" aria-pressed={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
                  Layers
                </button>
                {layersOpen && (
                  <div className="popover" onMouseLeave={() => setLayersOpen(false)}>
                    {(
                      [
                        ['dimensions', 'Dimensions'],
                        ['orientation', 'Orientation labels'],
                        ['equipment', 'Vehicles & equipment'],
                        ['scenery', 'Sky & grass'],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="check">
                        <input
                          type="checkbox"
                          checked={layers[k]}
                          onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="pop-wrap">
                <button
                  className="chip"
                  aria-pressed={tracking === 'on'}
                  onClick={() => setHeadOpen((o) => !o)}
                  title="Steer the view by moving your head, using your webcam"
                >
                  Head tracking
                </button>
                {headOpen && (
                  <div className="popover">
                    <div className="ht-status">
                      <span className={`dot ${tracking}`} />
                      {tracking === 'on' ? 'Tracking' : tracking === 'starting' ? 'Starting camera…' : 'Off'}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn sm primary" disabled={tracking !== 'off'} onClick={startTracking}>
                        Start
                      </button>
                      <button className="btn sm" disabled={tracking !== 'on'} onClick={endTracking}>
                        Stop
                      </button>
                    </div>
                    <label className="field-label" style={{ display: 'block', marginTop: 10 }}>
                      Sensitivity <span style={{ float: 'right' }}>{sensPct}%</span>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={sensPct}
                        onChange={(e) => {
                          setSensPct(Number(e.target.value));
                          sensitivity.current = Number(e.target.value) / 100;
                        }}
                      />
                    </label>
                    {trackError && <div className="field-note" style={{ color: 'var(--red)' }}>{trackError}</div>}
                    <div className="field-note">Uses your webcam in the browser only. Nothing is recorded or sent.</div>
                  </div>
                )}
              </div>
            </div>
          )}
          <Scene
            cfg={cfg}
            catalog={catalog}
            geo={geo}
            view={view}
            inside={mode === 'inside'}
            // The 3D labels are DOM overlays, so they would sit on top of the plan.
            layers={mode === '2d' ? { ...layers, dimensions: false, orientation: false } : layers}
            frameOnly={frameOnly}
            headOffset={tracking === 'on' && mode !== '2d' ? headOffset.current : null}
            onCaptureReady={(fn) => {
              captureRef.current = fn;
            }}
          />
          {mode === 'inside' && <div className="stage-hint">Drag to look around · scroll to widen the lens</div>}
          {frameOnly && mode !== '2d' && <div className="stage-hint frame-note">{legNote}</div>}
          {mode === '2d' && <FloorPlan cfg={cfg} geo={geo} update={update} />}
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
