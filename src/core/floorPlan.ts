// The 2D floor plan: what people park in these buildings, and whether it fits.
//
// Sizes are typical top-down footprints in feet (width across × length), from
// the Walker Buildings configurator's item palette.

import type { PlanItem } from './types';
import type { BuildingGeometry } from './geometry';

export interface PlanPreset {
  kind: string;
  label: string;
  w: number;
  h: number;
  /** Typical height in feet, for the 3D stand-in and the headroom check. */
  tall: number;
  color: string;
  icon: string;
}

export const FLOOR_PLAN_ITEMS: PlanPreset[] = [
  { kind: 'car', label: 'Car', w: 6, h: 16, tall: 4.8, color: '#4a7fc1', icon: '🚗' },
  { kind: 'truck', label: 'Pickup Truck', w: 7, h: 21, tall: 6.4, color: '#5a6a7a', icon: '🛻' },
  { kind: 'suv', label: 'SUV', w: 6.5, h: 17, tall: 6, color: '#6a5a9a', icon: '🚙' },
  { kind: 'tractor', label: 'Tractor', w: 8, h: 14, tall: 8.5, color: '#8a6a2a', icon: '🚜' },
  { kind: 'atv', label: 'ATV / UTV', w: 5, h: 8, tall: 6, color: '#6a8a3a', icon: '🏎' },
  { kind: 'boat', label: 'Boat + Trailer', w: 8, h: 28, tall: 7.5, color: '#2a7a8a', icon: '⛵' },
  { kind: 'mower', label: 'Zero-Turn', w: 5, h: 6, tall: 3.8, color: '#5a7a2a', icon: '🌿' },
  { kind: 'lift2', label: '2-Post Lift', w: 12, h: 22, tall: 12, color: '#c14a4a', icon: '🔧' },
  { kind: 'lift4', label: '4-Post Lift', w: 11, h: 20, tall: 7.5, color: '#c16a4a', icon: '🔩' },
  { kind: 'bench', label: 'Workbench', w: 2, h: 8, tall: 3, color: '#8a6a4a', icon: '🪚' },
  { kind: 'chest', label: 'Tool Chest', w: 2.5, h: 4, tall: 4, color: '#7a4a2a', icon: '🧰' },
  { kind: 'air', label: 'Air Compressor', w: 2.5, h: 3, tall: 4, color: '#4a6a8a', icon: '💨' },
  { kind: 'moto', label: 'Motorcycle', w: 3, h: 7, tall: 4, color: '#2a4a6a', icon: '🏍' },
  { kind: 'rv', label: 'RV / Motorhome', w: 8.5, h: 35, tall: 12, color: '#7a5a3a', icon: '🚐' },
  { kind: 'kayak', label: 'Kayak / Canoe', w: 2.5, h: 14, tall: 1.5, color: '#3a7a6a', icon: '🛶' },
  { kind: 'custom', label: 'Custom Box', w: 4, h: 4, tall: 4, color: '#8892a4', icon: '▭' },
];

/** Footprint of an item as placed, axis-aligned (rotations are quarter turns). */
export function placedRect(it: PlanItem) {
  const turned = it.rot % 180 !== 0;
  const w = turned ? it.h : it.w;
  const h = turned ? it.w : it.h;
  return { x0: it.x - w / 2, x1: it.x + w / 2, y0: it.y - h / 2, y1: it.y + h / 2 };
}

export type Fit = 'ok' | 'outside' | 'overlap' | 'too-tall';

/**
 * Whether each item fits: inside the clear floor (inside faces of the legs and
 * end bents, not the outside dimensions), not on top of another item, and
 * under the lowest truss member.
 */
export function checkFit(items: PlanItem[], geo: BuildingGeometry): Fit[] {
  const cw = geo.metrics.clearWidth / 2;
  const cl = geo.metrics.clearLength / 2;
  const rects = items.map(placedRect);
  const eps = 0.01;
  return rects.map((r, i) => {
    if (r.x0 < -cw - eps || r.x1 > cw + eps || r.y0 < -cl - eps || r.y1 > cl + eps) return 'outside';
    const hit = rects.some(
      (o, j) => j !== i && r.x0 < o.x1 - eps && r.x1 > o.x0 + eps && r.y0 < o.y1 - eps && r.y1 > o.y0 + eps,
    );
    if (hit) return 'overlap';
    return (items[i].tall ?? 0) > geo.metrics.clearHeight + eps ? 'too-tall' : 'ok';
  });
}

let seq = 0;
export function newPlanItemId(): string {
  seq += 1;
  return `i${Date.now().toString(36)}${seq.toString(36)}`;
}
