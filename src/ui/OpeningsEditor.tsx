// Add, place and remove doors and windows — on the main walls or any lean-to wall.

import { useMemo, useState } from 'react';
import type { BuildingConfig, Catalog, Opening, OpeningType, WallRef } from '../core/types';
import { headroomAt, openingCenterX, openingSize } from '../core/geometry';
import { allWallRefs, wallInfo } from '../core/leanTo';
import { clampOpening } from '../core/validate';
import { newOpeningId } from '../core/catalog';
import { money } from '../core/pricing';
import { Field, Slider } from './controls';

/** First offset along a wall where an opening of this width fits without overlapping. */
function findFreeOffset(cfg: BuildingConfig, len: number, wall: WallRef, catalog: Catalog, width: number): number | null {
  if (width > len) return null;

  const taken = cfg.openings
    .filter((o) => o.wall === wall)
    .map((o) => {
      const t = catalog.openingTypes.find((x) => x.id === o.catalogId);
      return t ? { a: o.offset - 0.5, b: o.offset + openingSize(o, t).width + 0.5 } : null;
    })
    .filter((x): x is { a: number; b: number } => x !== null);

  const centered = (len - width) / 2;
  const candidates = [centered];
  for (let x = 0.5; x + width <= len; x += 0.5) candidates.push(x);

  for (const offset of candidates) {
    if (offset < 0 || offset + width > len) continue;
    if (taken.some((t) => offset < t.b && offset + width > t.a)) continue;
    return Math.round(offset * 2) / 2;
  }
  return null;
}

export default function OpeningsEditor({
  cfg,
  catalog,
  update,
}: {
  cfg: BuildingConfig;
  catalog: Catalog;
  update: (patch: Partial<BuildingConfig>) => void;
}) {
  // Every wall an opening could go in; only fully closed ones get it built.
  const walls = useMemo(() => allWallRefs(cfg, catalog), [cfg, catalog]);
  const buildable = walls.filter((w) => w.takesOpenings);
  const [addType, setAddType] = useState(catalog.openingTypes[0]?.id ?? '');
  const [addWallPick, setAddWall] = useState<WallRef>('front');
  const addWall = buildable.some((w) => w.ref === addWallPick) ? addWallPick : (buildable[0]?.ref ?? 'front');

  const typeOf = (id: string) => catalog.openingTypes.find((t) => t.id === id);

  const setOpening = (id: string, patch: Partial<Opening>) => {
    update({
      openings: cfg.openings.map((o) => {
        if (o.id !== id) return o;
        return clampOpening({ ...o, ...patch }, cfg, catalog) ?? o;
      }),
    });
  };

  const remove = (id: string) => update({ openings: cfg.openings.filter((o) => o.id !== id) });

  /** The opening that would be added, fitted to the wall — or why it cannot be. */
  const candidate = (): { opening: Opening | null; reason?: string } => {
    const type = typeOf(addType);
    const info = wallInfo(cfg, catalog, addWall);
    if (!type || !info) return { opening: null };
    const offset = findFreeOffset(cfg, info.length, addWall, catalog, type.width);
    if (offset === null) return { opening: null, reason: `No room left on the ${info.label.toLowerCase()} for a ${type.width}′ opening.` };
    const fitted = clampOpening(
      { id: newOpeningId(), catalogId: type.id, wall: addWall, offset, sill: type.defaultSill },
      cfg,
      catalog,
    );
    if (!fitted) return { opening: null, reason: `A ${type.name.toLowerCase()} does not fit under the ${info.label.toLowerCase()}'s roof line.` };
    return { opening: fitted };
  };
  const next = candidate();

  const grouped = new Map<string, OpeningType[]>();
  for (const t of catalog.openingTypes) {
    const list = grouped.get(t.category) ?? [];
    list.push(t);
    grouped.set(t.category, list);
  }

  return (
    <>
      {cfg.openings.length === 0 && (
        <p className="field-note" style={{ margin: 0 }}>
          No doors or windows yet.
        </p>
      )}

      <div className="list">
        {cfg.openings.map((op) => {
          const type = typeOf(op.catalogId);
          const info = wallInfo(cfg, catalog, op.wall);
          if (!type || !info) return null;
          const { width, height } = openingSize(op, type);
          const len = info.length;
          const maxOffset = Math.max(0, len - width);
          const cx = openingCenterX(op.offset, width, len);
          const room = headroomAt(info.top, cx - width / 2, cx + width / 2) - 0.35;
          const maxSill = Math.max(0, room - height);
          const onDeadWall = !info.takesOpenings;

          return (
            <div
              key={op.id}
              className="row"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, opacity: onDeadWall ? 0.55 : 1 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="grow">
                  <span className="n">{type.name}</span>
                  <span className="d">
                    {onDeadWall
                      ? 'Wall is not fully closed — not built'
                      : type.resizable
                        ? `${width}' × ${height}' framed out`
                        : `${money(type.price)} each`}
                  </span>
                </span>
                <button className="btn sm ghost" onClick={() => remove(op.id)} aria-label={`Remove ${type.name}`}>
                  Remove
                </button>
              </div>

              <select value={op.wall} onChange={(e) => setOpening(op.id, { wall: e.target.value as WallRef })}>
                {walls.map((w) => (
                  <option key={w.ref} value={w.ref} disabled={!w.takesOpenings}>
                    {w.label}
                    {w.takesOpenings ? '' : ' (not closed)'}
                  </option>
                ))}
              </select>

              {type.resizable && (
                <>
                  <Slider
                    label="Opening width"
                    value={width}
                    min={type.minWidth ?? 2}
                    max={Math.min(type.maxWidth ?? 20, len)}
                    step={0.25}
                    onChange={(n) => setOpening(op.id, { width: n })}
                    format={(n) => `${n.toFixed(2).replace(/\.?0+$/, '')}'`}
                  />
                  <Slider
                    label="Opening height"
                    value={height}
                    min={type.minHeight ?? 2}
                    max={Math.min(type.maxHeight ?? 16, Math.max(type.minHeight ?? 2, room))}
                    step={0.25}
                    onChange={(n) => setOpening(op.id, { height: n })}
                    format={(n) => `${n.toFixed(2).replace(/\.?0+$/, '')}'`}
                  />
                </>
              )}

              <Slider
                label="Position from left"
                value={Math.min(op.offset, maxOffset)}
                min={0}
                max={maxOffset}
                step={0.5}
                onChange={(n) => setOpening(op.id, { offset: n })}
                format={(n) => `${n.toFixed(1)}'`}
              />

              {/* Only windows and framed openings may sit above the floor. */}
              {type.allowSill && maxSill > 0.05 && (
                <Slider
                  label="Height off floor"
                  value={Math.min(op.sill, maxSill)}
                  min={0}
                  max={Math.round(maxSill * 2) / 2}
                  step={0.5}
                  onChange={(n) => setOpening(op.id, { sill: n })}
                  format={(n) => `${n.toFixed(1)}'`}
                />
              )}
            </div>
          );
        })}
      </div>

      <Field label="Add a door or window">
        <select value={addType} onChange={(e) => setAddType(e.target.value)}>
          {[...grouped.entries()].map(([category, types]) => (
            <optgroup key={category} label={category}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {money(t.price)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select value={addWall} onChange={(e) => setAddWall(e.target.value as WallRef)} style={{ flex: 1 }}>
            {buildable.map((w) => (
              <option key={w.ref} value={w.ref}>
                {w.label}
              </option>
            ))}
          </select>
          <button
            className="btn sm primary"
            onClick={() => next.opening && update({ openings: [...cfg.openings, next.opening] })}
            disabled={!next.opening}
            style={{ opacity: next.opening ? 1 : 0.45 }}
          >
            Add
          </button>
        </div>
        {!buildable.length && <span className="field-note">Close a wall (Sides &amp; Ends or Lean-Tos) to add doors and windows.</span>}
        {next.reason && <span className="field-note">{next.reason}</span>}
      </Field>
    </>
  );
}
