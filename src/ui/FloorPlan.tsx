// The 2D floor plan: a scaled top-down view to lay out vehicles and equipment
// and see whether they fit. From the Walker Buildings configurator, extended
// to draw the real doors, windows and legs, to judge fit against the clear
// inside dimensions rather than the outside ones, and to save the layout with
// the design.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuildingConfig, PlanItem, WallId } from '../core/types';
import type { BuildingGeometry } from '../core/geometry';
import { FLOOR_PLAN_ITEMS, checkFit, newPlanItemId, placedRect, type Fit } from '../core/floorPlan';
import { feetInches } from '../core/format';

const MARGIN = 64;
const BG = '#f0ede8';

/** Black or white, whichever reads on a fill. */
function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.55 ? '#111' : '#fff';
}

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  /** Whole-plan rotation in degrees, to match how the customer's lot is laid out. */
  rot: number;
}

type Menu =
  | { kind: 'item'; x: number; y: number; id: string }
  | { kind: 'plan'; x: number; y: number }
  | null;

export default function FloorPlan({
  cfg,
  geo,
  update,
}: {
  cfg: BuildingConfig;
  geo: BuildingGeometry;
  update: (patch: Partial<BuildingConfig>) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0, rot: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [editing, setEditing] = useState<PlanItem | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Items are edited locally while dragging and committed on release, so the
  // 3D scene is not rebuilt on every mouse move.
  const [draft, setDraft] = useState<PlanItem[]>(cfg.planItems ?? []);
  const dragging = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const panning = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  useEffect(() => {
    if (!dragging.current) setDraft(cfg.planItems ?? []);
  }, [cfg.planItems]);

  const commit = useCallback((items: PlanItem[]) => {
    setDraft(items);
    update({ planItems: items });
  }, [update]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit the building to the canvas, then apply zoom.
  const turned = view.rot % 180 !== 0;
  const fitScale = Math.max(
    3,
    Math.min(
      (size.w - MARGIN * 2) / (turned ? cfg.length : cfg.width),
      (size.h - MARGIN * 2) / (turned ? cfg.width : cfg.length),
    ),
  );
  const S = fitScale * view.zoom;

  // Canvas -> plan feet. drawPlan applies the forward transform itself.
  const toWorld = useCallback(
    (cx: number, cy: number) => {
      const a = (-view.rot * Math.PI) / 180;
      const dx = cx - size.w / 2;
      const dy = cy - size.h / 2;
      return {
        x: (dx * Math.cos(a) - dy * Math.sin(a)) / S - view.panX,
        y: (dx * Math.sin(a) + dy * Math.cos(a)) / S - view.panY,
      };
    },
    [view, S, size],
  );

  const fits = useMemo(() => checkFit(draft, geo), [draft, geo]);
  const hitTest = useCallback(
    (wx: number, wy: number) => {
      for (let i = draft.length - 1; i >= 0; i--) {
        const r = placedRect(draft[i]);
        if (wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1) return draft[i];
      }
      return null;
    },
    [draft],
  );

  // ── Draw ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, size.w, size.h);
    drawPlan(ctx, { cfg, geo, S, view, size, items: draft, fits, selected });
  }, [cfg, geo, S, view, size, draft, fits, selected]);

  // ── Pointer ──────────────────────────────────────────────────────────────
  const local = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    const p = local(e);
    const w = toWorld(p.x, p.y);
    const hit = hitTest(w.x, w.y);
    canvasRef.current!.setPointerCapture(e.pointerId);
    if (hit) {
      setSelected(hit.id);
      dragging.current = { id: hit.id, dx: w.x - hit.x, dy: w.y - hit.y, moved: false };
    } else {
      setSelected(null);
      panning.current = { sx: e.clientX, sy: e.clientY, px: view.panX, py: view.panY };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) {
      const p = local(e);
      const w = toWorld(p.x, p.y);
      const d = dragging.current;
      // Snap to 6" unless Alt is held.
      const snap = (n: number) => (e.altKey ? n : Math.round(n * 2) / 2);
      d.moved = true;
      setDraft((items) => items.map((it) => (it.id === d.id ? { ...it, x: snap(w.x - d.dx), y: snap(w.y - d.dy) } : it)));
    } else if (panning.current) {
      const pn = panning.current;
      const a = (-view.rot * Math.PI) / 180;
      const dx = (e.clientX - pn.sx) / S;
      const dy = (e.clientY - pn.sy) / S;
      setView((vw) => ({
        ...vw,
        panX: pn.px + dx * Math.cos(a) - dy * Math.sin(a),
        panY: pn.py + dx * Math.sin(a) + dy * Math.cos(a),
      }));
    }
  };

  const onPointerUp = () => {
    if (dragging.current?.moved) commit(draft);
    dragging.current = null;
    panning.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    // Zoom about the cursor: keep the world point under it fixed.
    const p = local(e);
    const before = toWorld(p.x, p.y);
    const zoom = Math.min(12, Math.max(0.3, view.zoom * (e.deltaY < 0 ? 1.12 : 0.893)));
    const k = zoom / view.zoom;
    const a = (view.rot * Math.PI) / 180;
    const dx = p.x - size.w / 2;
    const dy = p.y - size.h / 2;
    const rx = dx * Math.cos(-a) - dy * Math.sin(-a);
    const ry = dx * Math.sin(-a) + dy * Math.cos(-a);
    const Sn = S * k;
    setView((vw) => ({ ...vw, zoom, panX: rx / Sn - before.x, panY: ry / Sn - before.y }));
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = local(e);
    const w = toWorld(p.x, p.y);
    const hit = hitTest(w.x, w.y);
    if (hit) {
      setSelected(hit.id);
      setMenu({ kind: 'item', x: p.x, y: p.y, id: hit.id });
    } else {
      setMenu({ kind: 'plan', x: p.x, y: p.y });
    }
  };

  // ── Item actions ─────────────────────────────────────────────────────────
  const modify = (id: string, fn: (it: PlanItem) => PlanItem | null) =>
    commit(draft.flatMap((it) => (it.id === id ? (fn(it) ?? []) : [it])));

  const add = (kind: string) => {
    const preset = FLOOR_PLAN_ITEMS.find((p) => p.kind === kind) ?? FLOOR_PLAN_ITEMS[0];
    const spot = freeSpot(draft, preset.w, preset.h, geo.metrics.clearWidth, geo.metrics.clearLength);
    const item: PlanItem = {
      id: newPlanItemId(),
      kind: preset.kind,
      label: preset.label,
      w: preset.w,
      h: preset.h,
      tall: preset.tall,
      x: spot.x,
      y: spot.y,
      rot: 0,
      color: preset.color,
    };
    commit([...draft, item]);
    setSelected(item.id);
    setPaletteOpen(false);
    if (kind === 'custom') setEditing(item);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || editing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        modify(selected, () => null);
        setSelected(null);
      } else if (e.key === 'r' || e.key === 'R') {
        modify(selected, (it) => ({ ...it, rot: (it.rot + 90) % 360 }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedItem = draft.find((it) => it.id === selected) ?? null;
  const bad = fits.filter((f) => f !== 'ok').length;

  return (
    <div className="plan" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, cursor: dragging.current ? 'grabbing' : 'default', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      />

      <div className="plan-tools">
        <button className="chip" aria-pressed={paletteOpen} onClick={() => setPaletteOpen((o) => !o)}>
          + Add vehicle or equipment
        </button>
        {paletteOpen && (
          <div className="plan-palette">
            {FLOOR_PLAN_ITEMS.map((p) => (
              <button key={p.kind} className="plan-palette-item" onClick={() => add(p.kind)}>
                <span className="ic">{p.icon}</span>
                <span>
                  <span className="n">{p.label}</span>
                  <span className="d">
                    {p.w}&prime; &times; {p.h}&prime;
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="plan-status">
        <span>
          Clear inside {feetInches(geo.metrics.clearWidth)} &times; {feetInches(geo.metrics.clearLength)}
        </span>
        {draft.length > 0 && (
          <span className={bad ? 'bad' : 'good'}>
            {bad ? `${bad} item${bad === 1 ? '' : 's'} won't fit` : 'Everything fits'}
          </span>
        )}
        <span className="hint">Drag to move · R rotates · right-click for more · scroll to zoom</span>
      </div>

      {menu && (
        <div className="plan-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {menu.kind === 'item' ? (
            <>
              <button onClick={() => { modify(menu.id, (it) => ({ ...it, rot: (it.rot + 90) % 360 })); setMenu(null); }}>↻ Rotate 90°</button>
              <button onClick={() => { modify(menu.id, (it) => ({ ...it, rot: (it.rot + 270) % 360 })); setMenu(null); }}>↺ Rotate −90°</button>
              <button
                onClick={() => {
                  const src = draft.find((it) => it.id === menu.id);
                  if (src) commit([...draft, { ...src, id: newPlanItemId(), x: src.x + 1, y: src.y + 1 }]);
                  setMenu(null);
                }}
              >
                ⧉ Duplicate
              </button>
              <button onClick={() => { setEditing(draft.find((it) => it.id === menu.id) ?? null); setMenu(null); }}>✎ Edit…</button>
              <hr />
              <button className="danger" onClick={() => { modify(menu.id, () => null); setSelected(null); setMenu(null); }}>
                Delete
              </button>
            </>
          ) : (
            <>
              <div className="cap">Plan</div>
              <button onClick={() => { setView((vw) => ({ ...vw, rot: (vw.rot + 90) % 360 })); setMenu(null); }}>↻ Rotate view 90°</button>
              <button onClick={() => { setView((vw) => ({ ...vw, rot: (vw.rot + 270) % 360 })); setMenu(null); }}>↺ Rotate view −90°</button>
              <button onClick={() => { setView({ zoom: 1, panX: 0, panY: 0, rot: 0 }); setMenu(null); }}>⟳ Reset view</button>
              <hr />
              <button className="danger" disabled={!draft.length} onClick={() => { commit([]); setSelected(null); setMenu(null); }}>
                Clear items
              </button>
            </>
          )}
        </div>
      )}

      {editing && (
        <ItemEditor
          item={editing}
          onCancel={() => setEditing(null)}
          onApply={(next) => {
            modify(next.id, () => next);
            setEditing(null);
          }}
        />
      )}

      {selectedItem && !editing && (
        <div className="plan-selected">
          <strong>{selectedItem.label}</strong> {feetInches(selectedItem.w)} &times; {feetInches(selectedItem.h)}
          {selectedItem.tall != null && <> &times; {feetInches(selectedItem.tall)} tall</>}
          {fits[draft.indexOf(selectedItem)] === 'outside' && <span className="bad"> · past the clear floor</span>}
          {fits[draft.indexOf(selectedItem)] === 'overlap' && <span className="bad"> · overlaps another item</span>}
          {fits[draft.indexOf(selectedItem)] === 'too-tall' && (
            <span className="bad"> · taller than the {feetInches(geo.metrics.clearHeight)} under the truss</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Somewhere on the clear floor a new item can go without landing on another,
 * scanning from the middle outward on a 6" grid. Falls back to the center.
 */
function freeSpot(items: PlanItem[], w: number, h: number, clearW: number, clearL: number) {
  const rects = items.map(placedRect);
  const free = (x: number, y: number) =>
    rects.every((r) => x + w / 2 <= r.x0 || x - w / 2 >= r.x1 || y + h / 2 <= r.y0 || y - h / 2 >= r.y1);
  const maxX = Math.max(0, clearW / 2 - w / 2);
  const maxY = Math.max(0, clearL / 2 - h / 2);
  const steps = (max: number) => {
    const out = [0];
    for (let d = 0.5; d <= max + 1e-6; d += 0.5) out.push(-d, d);
    return out;
  };
  for (const x of steps(maxX)) for (const y of steps(maxY)) if (free(x, y)) return { x, y };
  return { x: 0, y: 0 };
}

function ItemEditor({ item, onApply, onCancel }: { item: PlanItem; onApply: (i: PlanItem) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(item.label);
  const [w, setW] = useState(item.w);
  const [h, setH] = useState(item.h);
  const [tall, setTall] = useState(item.tall ?? 4);
  const [color, setColor] = useState(item.color);
  return (
    <div className="plan-edit" onPointerDown={(e) => e.stopPropagation()}>
      <div className="t">Edit item</div>
      <label>
        Label
        <input value={label} maxLength={24} autoFocus onChange={(e) => setLabel(e.target.value)} />
      </label>
      <div className="row3">
        <label>
          Width (ft)
          <input type="number" min={0.5} max={200} step={0.5} value={w} onChange={(e) => setW(Number(e.target.value))} />
        </label>
        <label>
          Length (ft)
          <input type="number" min={0.5} max={200} step={0.5} value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
        <label>
          Height (ft)
          <input type="number" min={0.25} max={40} step={0.25} value={tall} onChange={(e) => setTall(Number(e.target.value))} />
        </label>
      </div>
      <label>
        Color
        <span className="color-row">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          <span className="preview" style={{ background: color, color: textOn(color) }}>
            {label || 'Preview'}
          </span>
        </span>
      </label>
      <div className="actions">
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn sm primary"
          onClick={() => onApply({ ...item, label: label.trim() || item.label, w: w > 0 ? w : item.w, h: h > 0 ? h : item.h, tall: tall > 0 ? tall : item.tall, color })}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ── Canvas drawing ───────────────────────────────────────────────────────────

interface DrawArgs {
  cfg: BuildingConfig;
  geo: BuildingGeometry;
  S: number;
  view: ViewState;
  size: { w: number; h: number };
  items: PlanItem[];
  fits: Fit[];
  selected: string | null;
}

function drawPlan(ctx: CanvasRenderingContext2D, a: DrawArgs) {
  const { cfg, geo, S, view, size, items, fits, selected } = a;
  const W = cfg.width;
  const L = cfg.length;

  ctx.save();
  ctx.translate(size.w / 2, size.h / 2);
  ctx.rotate((view.rot * Math.PI) / 180);
  ctx.scale(S, S);
  ctx.translate(view.panX, view.panY);
  const px = 1 / S; // one screen pixel, in feet

  // Grid, 1' fine and 5' bold, inside the footprint.
  ctx.lineWidth = px * 0.6;
  for (let x = -W / 2; x <= W / 2 + 1e-6; x += 1) {
    ctx.strokeStyle = Math.round(x + W / 2) % 5 === 0 ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.moveTo(x, -L / 2);
    ctx.lineTo(x, L / 2);
    ctx.stroke();
  }
  for (let y = -L / 2; y <= L / 2 + 1e-6; y += 1) {
    ctx.strokeStyle = Math.round(y + L / 2) % 5 === 0 ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.moveTo(-W / 2, y);
    ctx.lineTo(W / 2, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(-W / 2, -L / 2, W, L);

  // Clear floor: inside faces of the legs and end bents.
  const cw = geo.metrics.clearWidth / 2;
  const cl = geo.metrics.clearLength / 2;
  ctx.setLineDash([px * 6, px * 4]);
  ctx.strokeStyle = 'rgba(232,99,42,0.7)';
  ctx.lineWidth = px * 1.2;
  ctx.strokeRect(-cw, -cl, cw * 2, cl * 2);
  ctx.setLineDash([]);

  // Legs and endwall studs, where they meet the floor.
  ctx.fillStyle = '#6b737c';
  for (const m of geo.frame) {
    if (m.kind !== 'leg' && m.kind !== 'endwall-stud') continue;
    if (m.position[1] - m.size[1] / 2 > 0.05) continue;
    ctx.fillRect(m.position[0] - geo.tube / 2, m.position[2] - geo.tube / 2, geo.tube, geo.tube);
  }

  // Walls: solid where built, dashed where open, broken at each opening.
  const edges: Record<WallId, [number, number, number, number]> = {
    front: [-W / 2, L / 2, W / 2, L / 2],
    back: [W / 2, -L / 2, -W / 2, -L / 2],
    right: [W / 2, L / 2, W / 2, -L / 2],
    left: [-W / 2, -L / 2, -W / 2, L / 2],
  };
  for (const wall of geo.walls) {
    const [x0, y0, x1, y1] = edges[wall.id];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    // Wall-local x runs left to right as seen from outside, which is this edge's direction.
    const at = (t: number) => [x0 + ux * (t + len / 2), y0 + uy * (t + len / 2)] as const;
    ctx.lineWidth = px * (wall.present ? 3 : 1.2);
    ctx.strokeStyle = '#222';
    ctx.setLineDash(wall.present ? [] : [px * 5, px * 4]);
    const cuts = wall.present ? [...wall.holes].sort((p, q) => p.x0 - q.x0) : [];
    let t = -len / 2;
    for (const h of cuts) {
      if (h.x0 > t) {
        ctx.beginPath();
        ctx.moveTo(...at(t));
        ctx.lineTo(...at(h.x0));
        ctx.stroke();
      }
      t = Math.max(t, h.x1);
    }
    ctx.beginPath();
    ctx.moveTo(...at(t));
    ctx.lineTo(...at(len / 2));
    ctx.stroke();
    ctx.setLineDash([]);

    // Openings: roll-ups and walk doors in orange, windows in blue.
    for (const h of cuts) {
      const [ax, ay] = at(h.x0);
      const [bx, by] = at(h.x1);
      const door = h.y0 < 0.05;
      ctx.strokeStyle = door ? '#e8632a' : '#3b82c4';
      ctx.lineWidth = px * (door ? 5 : 3);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      if (h.type.category === 'walk') {
        // Door swing, inward.
        const nx = -uy;
        const ny = ux;
        const r = h.x1 - h.x0;
        ctx.strokeStyle = 'rgba(232,99,42,0.6)';
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - nx * r, ay - ny * r);
        const start = Math.atan2(-ny, -nx);
        const end = Math.atan2(uy, ux);
        ctx.arc(ax, ay, r, start, end, Math.sign(Math.sin(end - start)) < 0);
        ctx.stroke();
      }
    }
  }

  // Items.
  items.forEach((it, i) => {
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate((it.rot * Math.PI) / 180);
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    drawSilhouette(ctx, it, px);
    ctx.shadowColor = 'transparent';
    const fit = fits[i];
    if (fit !== 'ok' || it.id === selected) {
      ctx.strokeStyle = fit !== 'ok' ? '#d0342c' : '#e8632a';
      ctx.lineWidth = px * 1.6;
      ctx.setLineDash(it.id === selected ? [px * 4, px * 3] : []);
      ctx.strokeRect(-it.w / 2 - px * 4, -it.h / 2 - px * 4, it.w + px * 8, it.h + px * 8);
      ctx.setLineDash([]);
    }
    // Labels stay upright relative to the item.
    const fs = Math.max(7, Math.min(12, S * 0.45)) * px;
    ctx.fillStyle = textOn(it.color);
    ctx.font = `bold ${fs}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.label, 0, it.h * 0.28);
    ctx.globalAlpha = 0.75;
    ctx.font = `${fs * 0.85}px ui-monospace, monospace`;
    ctx.fillText(`${it.w}'×${it.h}'`, 0, it.h * 0.28 + fs * 1.2);
    ctx.globalAlpha = 1;
    ctx.restore();
  });

  ctx.restore();

  // Dimensions and wall names, drawn in screen space so text stays upright.
  const toC = (x: number, y: number) => {
    const ang = (view.rot * Math.PI) / 180;
    const qx = (x + view.panX) * S;
    const qy = (y + view.panY) * S;
    return { x: size.w / 2 + qx * Math.cos(ang) - qy * Math.sin(ang), y: size.h / 2 + qx * Math.sin(ang) + qy * Math.cos(ang) };
  };
  const dim = (ax: number, ay: number, bx: number, by: number, ox: number, oy: number, text: string, name: string) => {
    const off = 22 / S;
    const p = toC(ax + ox * off, ay + oy * off);
    const q = toC(bx + ox * off, by + oy * off);
    // A dimension running up the screen has its text turned sideways, so the
    // wall name has to sit further out to clear it.
    const upright = Math.abs(q.y - p.y) > Math.abs(q.x - p.x);
    const nameOff = (upright ? 62 : 40) / S;
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    for (const e of [p, q]) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(e.x - (dy / l) * 6, e.y + (dx / l) * 6);
      ctx.lineTo(e.x + (dy / l) * 6, e.y - (dx / l) * 6);
      ctx.stroke();
    }
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    let ang = Math.atan2(q.y - p.y, q.x - p.x);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.rotate(ang);
    ctx.fillStyle = BG;
    ctx.font = 'bold 12px ui-monospace, monospace';
    const tw = ctx.measureText(text).width;
    ctx.fillRect(-tw / 2 - 4, -8, tw + 8, 16);
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
    const n = toC((ax + bx) / 2 + ox * nameOff, (ay + by) / 2 + oy * nameOff);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, n.x, n.y);
  };
  dim(-W / 2, L / 2, W / 2, L / 2, 0, 1, feetInches(W), 'FRONT');
  dim(-W / 2, -L / 2, W / 2, -L / 2, 0, -1, feetInches(W), 'BACK');
  dim(W / 2, -L / 2, W / 2, L / 2, 1, 0, feetInches(L), 'RIGHT');
  dim(-W / 2, -L / 2, -W / 2, L / 2, -1, 0, feetInches(L), 'LEFT');
}

/** Recognisable top-down shapes, from the Walker configurator. Units are feet. */
function drawSilhouette(ctx: CanvasRenderingContext2D, it: PlanItem, px: number) {
  const iw = it.w;
  const ih = it.h;
  const fill = it.color;
  ctx.fillStyle = `${fill}cc`;
  ctx.strokeStyle = fill;
  ctx.lineWidth = px * 1.5;
  const rrect = (x: number, y: number, w: number, h: number, r = 0.25) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  };
  const dark = (a: number) => `rgba(30,30,30,${a})`;

  switch (it.kind) {
    case 'car':
    case 'suv': {
      rrect(-iw / 2, -ih / 2, iw, ih, iw * 0.18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(180,220,255,0.5)';
      rrect(-iw * 0.38, -ih / 2 + ih * 0.15, iw * 0.76, ih * 0.22);
      ctx.fill();
      rrect(-iw * 0.32, ih / 2 - ih * 0.3, iw * 0.64, ih * 0.18);
      ctx.fill();
      ctx.fillStyle = dark(0.7);
      const wr = iw * 0.12;
      const wh = ih * 0.1;
      for (const [wx, wy] of [
        [-iw / 2 + wr * 0.4, -ih / 2 + wh], [iw / 2 - wr * 1.4, -ih / 2 + wh],
        [-iw / 2 + wr * 0.4, ih / 2 - wh * 3], [iw / 2 - wr * 1.4, ih / 2 - wh * 3],
      ]) {
        rrect(wx, wy, wr, wh * 2, 0.15);
        ctx.fill();
      }
      break;
    }
    case 'truck':
    case 'rv': {
      rrect(-iw / 2, -ih / 2, iw, ih, iw * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      rrect(-iw / 2, -ih / 2, iw, ih * 0.38, iw * 0.1);
      ctx.fill();
      ctx.fillStyle = 'rgba(180,220,255,0.45)';
      rrect(-iw * 0.35, -ih / 2 + ih * 0.05, iw * 0.7, ih * 0.18);
      ctx.fill();
      ctx.fillStyle = dark(0.7);
      const wr = iw * 0.13;
      const wh = ih * 0.07;
      for (const [wx, wy] of [
        [-iw / 2, -ih / 2 + wh], [iw / 2 - wr, -ih / 2 + wh],
        [-iw / 2, ih / 2 - wh * 3], [iw / 2 - wr, ih / 2 - wh * 3],
      ]) {
        rrect(wx, wy, wr, wh * 2, 0.15);
        ctx.fill();
      }
      break;
    }
    case 'tractor': {
      rrect(-iw / 2, -ih / 2, iw, ih * 0.55, iw * 0.12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      rrect(-iw * 0.3, -ih / 2, iw * 0.6, ih * 0.3);
      ctx.fill();
      ctx.fillStyle = dark(0.75);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * (iw / 2 - iw * 0.14), ih * 0.1, iw * 0.14, ih * 0.19, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(s * (iw / 2 - iw * 0.09), -ih * 0.28, iw * 0.075, ih * 0.11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'atv':
    case 'moto': {
      rrect(-iw / 2, -ih / 2, iw, ih, iw * 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = dark(0.7);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(0, s * (ih / 2 - ih * 0.12), iw * 0.38, ih * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'boat': {
      ctx.beginPath();
      ctx.moveTo(0, -ih / 2);
      ctx.bezierCurveTo(iw / 2, -ih / 2 + ih * 0.15, iw / 2, -ih / 2 + ih * 0.7, (iw / 2) * 0.7, ih / 2);
      ctx.lineTo((-iw / 2) * 0.7, ih / 2);
      ctx.bezierCurveTo(-iw / 2, -ih / 2 + ih * 0.7, -iw / 2, -ih / 2 + ih * 0.15, 0, -ih / 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'mower': {
      rrect(-iw / 2, -ih / 2, iw, ih, iw * 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(iw, ih) * 0.38, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lift2':
    case 'lift4': {
      ctx.fillStyle = 'rgba(180,180,180,0.15)';
      rrect(-iw / 2, -ih / 2, iw, ih);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `${fill}ee`;
      if (it.kind === 'lift2') {
        const pw = iw * 0.14;
        rrect(-iw / 2 + iw * 0.05, -ih * 0.46, pw, ih * 0.92);
        ctx.fill();
        rrect(iw / 2 - iw * 0.05 - pw, -ih * 0.46, pw, ih * 0.92);
        ctx.fill();
      } else {
        const pr = iw * 0.1;
        for (const [a, b] of [[-0.38, -0.38], [0.28, -0.38], [-0.38, 0.28], [0.28, 0.28]]) {
          rrect(iw * a, ih * b, pr, pr, 0.1);
          ctx.fill();
        }
      }
      break;
    }
    case 'air': {
      ctx.beginPath();
      ctx.ellipse(0, 0, iw / 2, ih / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'kayak': {
      ctx.beginPath();
      ctx.moveTo(0, -ih / 2);
      ctx.bezierCurveTo(iw / 2, -ih / 2 + ih * 0.12, iw / 2, ih / 2 - ih * 0.12, 0, ih / 2);
      ctx.bezierCurveTo(-iw / 2, ih / 2 - ih * 0.12, -iw / 2, -ih / 2 + ih * 0.12, 0, -ih / 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'bench':
    case 'chest': {
      rrect(-iw / 2, -ih / 2, iw, ih);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = px;
      const n = Math.max(2, Math.floor(ih / 1.2));
      for (let k = 1; k < n; k++) {
        const y = -ih / 2 + (ih / n) * k;
        ctx.beginPath();
        ctx.moveTo(-iw / 2 + px * 2, y);
        ctx.lineTo(iw / 2 - px * 2, y);
        ctx.stroke();
      }
      break;
    }
    default: {
      rrect(-iw / 2, -ih / 2, iw, ih);
      ctx.fill();
      ctx.stroke();
    }
  }
}
