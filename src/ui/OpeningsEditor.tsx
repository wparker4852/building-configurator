// Add, place and remove doors and windows.

import { useMemo, useState } from 'react';
import type { BuildingConfig, Catalog, Opening, OpeningType, WallId } from '../core/types';
import { WALL_IDS } from '../core/types';
import { headroomAt, openingCenterX, openingSize, roofProfile, wallLength, wallTopEdge, wallsPresent } from '../core/geometry';
import { clampOpening } from '../core/validate';
import { newOpeningId } from '../core/catalog';
import { money } from '../core/pricing';
import { Field, Slider } from './controls';

const WALL_LABEL: Record<WallId, string> = {
  front: 'Front',
  back: 'Back',
  left: 'Left side',
  right: 'Right side',
};

/** First offset along a wall where an opening of this width fits without overlapping. */
function findFreeOffset(cfg: BuildingConfig, catalog: Catalog, wall: WallId, width: number): number | null {
  const len = wallLength(cfg, wall);
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
  const present = wallsPresent(cfg);
  const buildable = WALL_IDS.filter((w) => present[w]);
  const [addType, setAddType] = useState(catalog.openingTypes[0]?.id ?? '');
  const [addWall, setAddWall] = useState<WallId>(buildable[0] ?? 'front');

  const profile = useMemo(
    () => roofProfile(cfg, catalog.roofStyles.find((r) => r.id === cfg.roofStyle)),
    [cfg, catalog],
  );

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

  const add = () => {
    const type = typeOf(addType);
    if (!type) return;
    const offset = findFreeOffset(cfg, catalog, addWall, type.width);
    if (offset === null) return;
    const candidate: Opening = {
      id: newOpeningId(),
      catalogId: type.id,
      wall: addWall,
      offset,
      sill: type.defaultSill,
    };
    const fitted = clampOpening(candidate, cfg, catalog);
    if (!fitted) return;
    update({ openings: [...cfg.openings, fitted] });
  };

  const addType_ = typeOf(addType);
  const canAdd =
    !!addType_ && buildable.includes(addWall) && findFreeOffset(cfg, catalog, addWall, addType_.width) !== null;

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
          if (!type) return null;
          const { width, height } = openingSize(op, type);
          const len = wallLength(cfg, op.wall);
          const maxOffset = Math.max(0, len - width);
          const top = wallTopEdge(cfg, op.wall, profile);
          const cx = openingCenterX(op.offset, width, len);
          const room = headroomAt(top, cx - width / 2, cx + width / 2) - 0.35;
          const maxSill = Math.max(0, room - height);
          const onDeadWall = !present[op.wall];

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
                      ? 'On an open side — not built'
                      : type.resizable
                        ? `${width}' × ${height}' framed out`
                        : `${money(type.price)} each`}
                  </span>
                </span>
                <button className="btn sm ghost" onClick={() => remove(op.id)} aria-label={`Remove ${type.name}`}>
                  Remove
                </button>
              </div>

              <select value={op.wall} onChange={(e) => setOpening(op.id, { wall: e.target.value as WallId })}>
                {WALL_IDS.map((w) => (
                  <option key={w} value={w} disabled={!present[w]}>
                    {WALL_LABEL[w]}
                    {present[w] ? '' : ' (open side)'}
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
          <select value={addWall} onChange={(e) => setAddWall(e.target.value as WallId)} style={{ flex: 1 }}>
            {buildable.map((w) => (
              <option key={w} value={w}>
                {WALL_LABEL[w]}
              </option>
            ))}
          </select>
          <button className="btn sm primary" onClick={add} disabled={!canAdd} style={{ opacity: canAdd ? 1 : 0.45 }}>
            Add
          </button>
        </div>
        {!canAdd && addType_ && (
          <span className="field-note">
            No room left on the {WALL_LABEL[addWall].toLowerCase()} for a {addType_.width}&prime; opening.
          </span>
        )}
      </Field>
    </>
  );
}
