// The Lean-Tos panel: add a lean-to to any side, size and place it, choose its
// pitch and walls, and connect two that meet at a corner into one roof line.

import type { BuildingConfig, CornerId, ExteriorWalls, LeanTo, LeanToWallId, WallId, WallKind } from '../core/types';
import { WALL_IDS } from '../core/types';
import {
  CORNERS, LEAN_TO_MIN_LENGTH, LEAN_TO_PITCHES, LEAN_TO_WIDTH, connectableCorners, hostOf, leanToLabel, leanToMaxEave,
} from '../core/leanTo';
import { RadioGroup } from './controls';

const SIDE_NAME: Record<WallId, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };
const KIND_LABEL: Record<WallKind, string> = { open: 'Open', closed: 'Closed', half: 'Half Wall', gable: 'Gable', columns: 'Columns' };
const WALL_LABEL: Record<LeanToWallId, string> = { outer: 'Outer', left: 'Left end', right: 'Right end' };

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

export default function LeanToEditor({
  cfg,
  update,
}: {
  cfg: BuildingConfig;
  update: (patch: Partial<BuildingConfig>) => void;
}) {
  const leanTos = cfg.leanTos ?? [];
  const free = WALL_IDS.filter((s) => !leanTos.some((l) => l.side === s));
  const corners = connectableCorners(cfg);

  const set = (id: string, patch: Partial<LeanTo>) =>
    update({ leanTos: leanTos.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const remove = (id: string) => update({ leanTos: leanTos.filter((l) => l.id !== id) });
  const add = (side: WallId) => {
    const width = 12;
    const pitch = 3;
    update({
      leanTos: [
        ...leanTos,
        {
          id: `lt-${side}`,
          side,
          width,
          length: hostOf(cfg, side).len,
          offset: 0,
          eaveHeight: leanToMaxEave(cfg, side, width, pitch),
          pitch,
          exteriorWalls: 'none',
          walls: { outer: 'open', left: 'open', right: 'open' },
        },
      ],
    });
  };

  return (
    <>
      <p className="field-note" style={{ margin: 0 }}>
        Priced from the materials it takes (steel, panels, trim, anchors, screws). See Admin &rarr; Materials.
      </p>

      {leanTos.map((lt) => {
        const hostLen = Math.floor(hostOf(cfg, lt.side).len);
        const maxEave = leanToMaxEave(cfg, lt.side, lt.width, lt.pitch);
        // Ends at a connected corner are closed off by the corner, not chosen.
        const connectedEnds = new Set(
          (Object.keys(CORNERS) as CornerId[])
            .filter((c) => cfg.leanToCorners?.[c])
            .flatMap((c) => CORNERS[c].filter((e) => e.side === lt.side).map((e) => e.end)),
        );
        const wallIds = (['outer', 'left', 'right'] as LeanToWallId[]).filter((w) => w === 'outer' || !connectedEnds.has(w));
        return (
          <div key={lt.id} className="lt-card">
            <div className="lt-head">
              <strong>{leanToLabel(lt.side)}</strong>
              <button className="btn sm ghost" onClick={() => remove(lt.id)}>
                Remove
              </button>
            </div>

            <div className="row2">
              <label className="field">
                <span className="field-label">Width (out from wall)</span>
                <select value={lt.width} onChange={(e) => set(lt.id, { width: Number(e.target.value) })}>
                  {range(LEAN_TO_WIDTH.min, LEAN_TO_WIDTH.max).map((w) => (
                    <option key={w} value={w}>{w}&prime;</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Length (along wall)</span>
                <select value={lt.length} onChange={(e) => set(lt.id, { length: Number(e.target.value) })}>
                  {range(LEAN_TO_MIN_LENGTH, hostLen).map((l) => (
                    <option key={l} value={l}>{l}&prime;{l === hostLen ? ' (full)' : ''}</option>
                  ))}
                </select>
              </label>
            </div>

            {lt.length < hostLen && (
              <label className="field">
                <span className="field-label">Starts from the left end of the {SIDE_NAME[lt.side].toLowerCase()} wall</span>
                <select value={lt.offset} onChange={(e) => set(lt.id, { offset: Number(e.target.value) })}>
                  {range(0, hostLen - lt.length).map((o) => (
                    <option key={o} value={o}>{o}&prime;</option>
                  ))}
                </select>
              </label>
            )}

            <div className="row2">
              <label className="field">
                <span className="field-label">Eave height</span>
                <select value={lt.eaveHeight} onChange={(e) => set(lt.id, { eaveHeight: Number(e.target.value) })}>
                  {range(4, Math.max(4, maxEave)).map((h) => (
                    <option key={h} value={h}>{h}&prime;</option>
                  ))}
                </select>
                <span className="field-note">High side {(lt.eaveHeight + (lt.width * lt.pitch) / 12).toFixed(1)}&prime;</span>
              </label>
              <RadioGroup
                label="Roof Pitch"
                options={LEAN_TO_PITCHES.map((p) => ({
                  value: String(p),
                  label: `${p}:12`,
                  // Too steep to fit under the main eave at this width.
                  disabled: leanToMaxEave(cfg, lt.side, lt.width, p) < 4,
                  title: leanToMaxEave(cfg, lt.side, lt.width, p) < 4 ? 'Rises above the main eave at this width' : undefined,
                }))}
                value={String(lt.pitch)}
                onChange={(v) => set(lt.id, { pitch: Number(v) })}
              />
            </div>

            <RadioGroup
              label="Walls"
              options={[
                { value: 'none', label: 'None' },
                { value: 'enclosed', label: 'Fully Enclosed' },
                { value: 'custom', label: 'Custom' },
              ] as { value: ExteriorWalls; label: string }[]}
              value={lt.exteriorWalls}
              onChange={(exteriorWalls) => set(lt.id, { exteriorWalls })}
            />
            {lt.exteriorWalls === 'custom' && (
              <div className="wall-grid">
                {wallIds.map((w) => (
                  <label key={w} className="wall-row">
                    <span>{WALL_LABEL[w]}</span>
                    <select
                      value={lt.walls[w]}
                      onChange={(e) => set(lt.id, { exteriorWalls: 'custom', walls: { ...lt.walls, [w]: e.target.value as WallKind } })}
                    >
                      {(['open', 'closed', 'half', 'columns'] as WallKind[]).map((k) => (
                        <option key={k} value={k}>{KIND_LABEL[k]}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {corners.length > 0 && (
        <div className="field">
          <span className="field-label">Corners</span>
          {corners.map((c) => {
            const [a, b] = CORNERS[c];
            return (
              <label key={c} className="check">
                <input
                  type="checkbox"
                  checked={!!cfg.leanToCorners?.[c]}
                  onChange={(e) => update({ leanToCorners: { ...cfg.leanToCorners, [c]: e.target.checked } })}
                />
                Connect {SIDE_NAME[a.side]} &amp; {SIDE_NAME[b.side]} into one roof line
              </label>
            );
          })}
          <span className="field-note">
            Connected lean-tos share one width, pitch and eave (the {`front/back`} one leads) and wrap the corner with a hip roof.
          </span>
        </div>
      )}

      {free.length > 0 && (
        <div className="lt-add">
          <span className="field-label">Add a lean-to</span>
          <div className="lt-add-row">
            {free.map((s) => (
              <button key={s} className="btn sm" onClick={() => add(s)}>
                + {SIDE_NAME[s]}
              </button>
            ))}
          </div>
          {leanTos.length > 1 && corners.length === 0 && (
            <span className="field-note">To connect two at a corner, run both all the way to that corner (full length, or start at that end).</span>
          )}
        </div>
      )}
    </>
  );
}
