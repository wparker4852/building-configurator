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

/** Camera presets, kept for the internal view (they expose geometry bugs). */
const VIEWS: { id: ViewPreset; label: string }[] = [
  { id: 'iso', label: 'Corner' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
  { id: 'top', label: 'Top' },
];

/** How many changes Undo can step back through. */
const HISTORY = 60;

/** Notify a host page when the widget is running inside an iframe. */
function postToHost(message: Record<string, unknown>) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage(message, '*');
  } catch {
    // Cross-origin parents that reject messages are not an error here.
  }
}

// ── Toolbar icons (inline, 20px, currentColor) ───────────────────────────────

const Icon = {
  undo: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  ),
  // Tape measure: dimensions on/off.
  measure: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="12" r="6" />
      <circle cx="9" cy="12" r="1.6" />
      <path d="M9 18h12v-3M17 18v-2M13 18v-2" />
    </svg>
  ),
  // Bents: the bare frame on/off.
  frame: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V9l4-3 4 3v11M12 20V9l4-3 4 3v11" />
      <path d="M3 20h18" />
    </svg>
  ),
  // Broom: clear doors, windows and floor-plan items.
  broom: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m19 3-7.5 7.5" />
      <path d="M9.5 9.5 14.5 14.5 11 21H4.5c0-3.5 1.5-8 5-11.5Z" />
      <path d="M7 21c.5-2 1.5-4 3-5.5M10 21c.4-1.4 1-2.6 2-3.6" />
    </svg>
  ),
  head: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18.5V16a6 6 0 1 1 9.6 4.8" />
      <path d="M15.5 21v-2.5h2.2a1.3 1.3 0 0 0 1.3-1.3V15l1.5-.6-1.5-3" />
      <path d="M2 9.5 4 11 2 12.5M22 9.5" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3 21 8l-9 5-9-5 9-5Z" />
      <path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5" />
    </svg>
  ),
  // Standing inside: the walk-in view.
  inside: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11 12 4l9 7v9H3v-9Z" />
      <circle cx="12" cy="11" r="1.6" />
      <path d="M12 13v4M10 20l2-3 2 3M9.5 15h5" />
    </svg>
  ),
};

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
  // Undo/redo: snapshots of the design before each change. Held in refs (not
  // state updaters) so a change is recorded exactly once; the counter only
  // re-renders the toolbar.
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const past = useRef<BuildingConfig[]>([]);
  const future = useRef<BuildingConfig[]>([]);
  const [, setHistoryTick] = useState(0);
  const commit = useCallback((next: BuildingConfig) => {
    cfgRef.current = next;
    setCfg(next);
    setHistoryTick((t) => t + 1);
  }, []);

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
    (patch: Partial<BuildingConfig>) => {
      const prev = cfgRef.current;
      past.current = [...past.current.slice(-(HISTORY - 1)), prev];
      future.current = [];
      commit(normalizeConfig({ ...prev, ...patch }, catalog));
    },
    [catalog, commit],
  );

  const undo = useCallback(() => {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [cfgRef.current, ...future.current].slice(0, HISTORY);
    commit(prev);
  }, [commit]);
  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current.slice(-(HISTORY - 1)), cfgRef.current];
    commit(next);
  }, [commit]);
  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y), except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const clearItems = useCallback(() => {
    const count = cfg.openings.length + (cfg.planItems?.length ?? 0);
    if (!count) return;
    if (!window.confirm('Remove all doors, windows and floor-plan items? You can undo this.')) return;
    update({ openings: [], planItems: [] });
  }, [cfg.openings.length, cfg.planItems, update]);

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

  const toolButton = (label: string, icon: React.ReactNode, onClick: () => void, opts: { pressed?: boolean; disabled?: boolean } = {}) => (
    <button
      className="tool"
      title={label}
      aria-label={label}
      aria-pressed={opts.pressed}
      disabled={opts.disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div className={`app${embed ? ' embed' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <img className="logo" src={BRAND.wordmark} alt={catalog.branding.companyName} />
          <span className="divider" />
          <span className="product">{catalog.branding.productName}</span>
        </div>
        <div className="spacer" />
        {audience === 'internal' && <span className="badge internal">Internal</span>}
        {onOpenAdmin && (
          <button className="btn sm ghost" onClick={onOpenAdmin}>
            Admin
          </button>
        )}
      </header>

      <div className="layout">
        <OptionPanel cfg={cfg} catalog={catalog} geo={geo} audience={audience} update={update} />

        <div className="stage">
          {/* Top left: edit history and what the view shows. */}
          <div className="toolbar" role="toolbar" aria-label="Design tools">
            {toolButton('Undo (Ctrl+Z)', Icon.undo, undo, { disabled: !past.current.length })}
            {toolButton('Redo (Ctrl+Shift+Z)', Icon.redo, redo, { disabled: !future.current.length })}
            <span className="tool-sep" />
            {toolButton('Dimensions', Icon.measure, () => setLayers((l) => ({ ...l, dimensions: !l.dimensions })), {
              pressed: layers.dimensions,
            })}
            {toolButton('Frame only', Icon.frame, () => setFrameOnly((s) => !s), { pressed: frameOnly })}
            {toolButton('Clear doors, windows & items', Icon.broom, clearItems, {
              disabled: !cfg.openings.length && !cfg.planItems?.length,
            })}
          </div>

          {/* Camera presets: internal only, for checking geometry. */}
          {audience === 'internal' && mode === '3d' && (
            <div className="stage-tools right">
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
          )}

          {/* Bottom left: head tracking, layers, and the Inside / 3D / 2D switch. */}
          <div className="dock">
            {mode !== '2d' && (
              <div className="pop-wrap">
                {toolButton('Head tracking', Icon.head, () => setHeadOpen((o) => !o), { pressed: tracking === 'on' || headOpen })}
                {headOpen && (
                  <div className="popover up">
                    <div className="ht-status">
                      <span className={`dot ${tracking}`} />
                      {tracking === 'on' ? 'Tracking' : tracking === 'starting' ? 'Starting camera…' : 'Head tracking off'}
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
            )}
            {mode !== '2d' && (
              <div className="pop-wrap">
                {toolButton('Layers', Icon.layers, () => setLayersOpen((o) => !o), { pressed: layersOpen })}
                {layersOpen && (
                  <div className="popover up" onMouseLeave={() => setLayersOpen(false)}>
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
            )}
            <div className="mode-switch" role="group" aria-label="View">
              <button aria-pressed={mode === 'inside'} title="Inside view" aria-label="Inside view" onClick={() => setMode('inside')}>
                {Icon.inside}
              </button>
              <button
                aria-pressed={mode === '3d'}
                onClick={() => {
                  if (mode === 'inside') setView((s) => ({ preset: 'iso', nonce: s.nonce + 1 }));
                  setMode('3d');
                }}
              >
                3D
              </button>
              <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>
                2D
              </button>
            </div>
          </div>

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
        />

        {/* Phones only: the total and the main action stay in reach while the
            full breakdown sits in the page below the options. */}
        <div className="mobile-bar">
          <div className="grow">
            <div className="t">{money(quote.total)}</div>
            <div className="s">
              <button onClick={() => document.getElementById('price-details')?.scrollIntoView({ behavior: 'smooth' })}>
                See details
              </button>
            </div>
          </div>
          <button className="btn primary" onClick={() => setQuoteOpen(true)}>
            {audience === 'internal' ? 'Quote sheet' : 'Request my quote'}
          </button>
        </div>
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
