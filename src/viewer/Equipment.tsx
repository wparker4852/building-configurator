// 3D stand-ins for what is laid out on the 2D floor plan.
//
// Deliberately generic — a body, a cab and wheels for vehicles, posts for a
// lift, a box for everything else — sized from each item's footprint and
// height. Enough to judge fit and headroom in the 3D and walk-in views without
// shipping any models.

import * as THREE from 'three';
import type { PlanItem } from '../core/types';
import type { Fit } from '../core/floorPlan';

const TIRE = '#1f2124';
const GLASS = '#6f8ea6';
const STEEL = '#9aa1a8';

function Box({
  size,
  at,
  color,
  warn,
  opacity,
}: {
  size: [number, number, number];
  at: [number, number, number];
  color: string;
  warn: boolean;
  opacity?: number;
}) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={0.55}
        metalness={0.15}
        emissive={warn ? '#c0281e' : '#000000'}
        emissiveIntensity={warn ? 0.35 : 0}
        transparent={opacity != null}
        opacity={opacity ?? 1}
      />
    </mesh>
  );
}

/** Four wheels, axles across X, `inset` from each end. */
function Wheels({ w, len, r, width = 0.6, inset, rearR }: { w: number; len: number; r: number; width?: number; inset: number; rearR?: number }) {
  const rows: [number, number][] = [
    [-len / 2 + inset, r],
    [len / 2 - inset, rearR ?? r],
  ];
  return (
    <group>
      {rows.flatMap(([z, rr]) =>
        [-1, 1].map((s) => (
          <mesh key={`${z}:${s}`} position={[s * (w / 2 - width / 2), rr, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[rr, rr, width, 18]} />
            <meshStandardMaterial color={TIRE} roughness={0.85} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Shape({ it, warn }: { it: PlanItem; warn: boolean }) {
  const w = it.w;
  const len = it.h;
  const tall = it.tall ?? 4;
  const c = it.color;
  const r = THREE.MathUtils.clamp(tall * 0.17, 0.35, 1.6);

  switch (it.kind) {
    case 'car':
    case 'suv': {
      const base = r * 0.55;
      const bodyH = tall * 0.42;
      const cabH = Math.max(0.5, tall - base - bodyH);
      const cabLen = len * (it.kind === 'suv' ? 0.62 : 0.48);
      return (
        <group>
          <Box size={[w, bodyH, len]} at={[0, base + bodyH / 2, 0]} color={c} warn={warn} />
          <Box size={[w * 0.86, cabH, cabLen]} at={[0, base + bodyH + cabH / 2, len * 0.06]} color={GLASS} warn={warn} />
          <Wheels w={w} len={len} r={r} inset={r * 1.5} />
        </group>
      );
    }
    case 'truck': {
      const base = r * 0.55;
      const bodyH = tall * 0.4;
      const cabH = Math.max(0.5, tall - base - bodyH);
      const cabLen = len * 0.3;
      return (
        <group>
          <Box size={[w, bodyH, len]} at={[0, base + bodyH / 2, 0]} color={c} warn={warn} />
          <Box size={[w * 0.92, cabH, cabLen]} at={[0, base + bodyH + cabH / 2, -len / 2 + len * 0.36]} color={GLASS} warn={warn} />
          {/* Bed sides. */}
          {[-1, 1].map((s) => (
            <Box key={s} size={[0.2, 0.5, len * 0.42]} at={[s * (w / 2 - 0.1), base + bodyH + 0.25, len * 0.27]} color={c} warn={warn} />
          ))}
          <Wheels w={w} len={len} r={r} inset={r * 1.8} />
        </group>
      );
    }
    case 'rv': {
      const base = r * 0.55;
      const h = tall - base;
      return (
        <group>
          <Box size={[w, h, len]} at={[0, base + h / 2, 0]} color={c} warn={warn} />
          <Box size={[w * 0.9, h * 0.28, 0.1]} at={[0, base + h * 0.72, -len / 2 - 0.02]} color={GLASS} warn={warn} />
          <Box size={[w * 1.001, h * 0.06, len * 0.9]} at={[0, base + h * 0.45, 0]} color="#e9e4da" warn={warn} />
          <Wheels w={w} len={len} r={r} inset={len * 0.18} />
        </group>
      );
    }
    case 'tractor': {
      const rear = tall * 0.3;
      const front = rear * 0.55;
      const hoodH = tall * 0.32;
      const cabH = tall - hoodH - front * 0.6;
      return (
        <group>
          <Box size={[w * 0.4, hoodH, len * 0.6]} at={[0, front * 0.6 + hoodH / 2, -len * 0.18]} color={c} warn={warn} />
          <Box size={[w * 0.62, cabH, len * 0.3]} at={[0, front * 0.6 + hoodH + cabH / 2 - hoodH * 0.4, len * 0.2]} color={GLASS} warn={warn} opacity={0.75} />
          <Wheels w={w} len={len} r={front} rearR={rear} width={w * 0.2} inset={rear} />
        </group>
      );
    }
    case 'atv':
    case 'moto':
    case 'mower': {
      const base = r * 0.9;
      const h = Math.max(0.4, tall * 0.5 - base * 0.5);
      return (
        <group>
          <Box size={[w * (it.kind === 'moto' ? 0.35 : 0.8), h, len * 0.8]} at={[0, base + h / 2, 0]} color={c} warn={warn} />
          {it.kind !== 'moto' && (
            <Box size={[w * 0.5, tall - base - h, 0.12]} at={[0, base + h + (tall - base - h) / 2, len * 0.15]} color={STEEL} warn={warn} />
          )}
          <Wheels w={it.kind === 'moto' ? 0.5 : w} len={len} r={r} width={it.kind === 'moto' ? 0.4 : 0.6} inset={r * 1.1} />
        </group>
      );
    }
    case 'boat': {
      const trailerH = 1.6;
      return (
        <group>
          <Box size={[w * 0.9, 0.3, len]} at={[0, trailerH - 0.15, 0]} color={STEEL} warn={warn} />
          <Box size={[w * 0.85, tall - trailerH - 0.6, len * 0.78]} at={[0, trailerH + (tall - trailerH - 0.6) / 2, len * 0.06]} color={c} warn={warn} />
          <mesh position={[0, trailerH + (tall - trailerH) * 0.35, -len * 0.33 - len * 0.1]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[w * 0.42, len * 0.2, 4]} />
            <meshStandardMaterial color={c} roughness={0.5} />
          </mesh>
          <Wheels w={w * 0.9} len={len * 0.3} r={0.9} inset={0.9} />
        </group>
      );
    }
    case 'lift2':
      return (
        <group>
          {[-1, 1].map((s) => (
            <Box key={s} size={[0.9, tall, 0.9]} at={[s * (w / 2 - 0.45), tall / 2, 0]} color={c} warn={warn} />
          ))}
          <Box size={[w - 1.8, 0.35, 0.5]} at={[0, tall - 0.2, 0]} color={c} warn={warn} />
          {[-1, 1].map((s) => (
            <Box key={`arm${s}`} size={[w * 0.35, 0.2, 0.3]} at={[s * (w / 2 - 0.9 - w * 0.175), 0.5, 0]} color={STEEL} warn={warn} />
          ))}
        </group>
      );
    case 'lift4':
      return (
        <group>
          {[
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sz]) => (
            <Box key={`${sx}${sz}`} size={[0.7, tall, 0.7]} at={[sx * (w / 2 - 0.35), tall / 2, sz * (len / 2 - 0.35)]} color={c} warn={warn} />
          ))}
          {/* Runways, lowered. */}
          {[-1, 1].map((s) => (
            <Box key={`rw${s}`} size={[w * 0.22, 0.3, len - 1.6]} at={[s * w * 0.22, 0.6, 0]} color={STEEL} warn={warn} />
          ))}
        </group>
      );
    case 'kayak':
      return <Box size={[w * 0.7, tall * 0.5, len]} at={[0, tall * 0.75, 0]} color={c} warn={warn} />;
    default:
      return <Box size={[w, tall, len]} at={[0, tall / 2, 0]} color={c} warn={warn} />;
  }
}

/**
 * Plan items in the scene. Plan x is world x and plan y is world z; the plan
 * turns items clockwise as seen from above, which is a negative turn about +Y.
 */
export default function Equipment({ items, fits }: { items: PlanItem[]; fits: Fit[] }) {
  return (
    <group>
      {items.map((it, i) => (
        <group key={it.id} position={[it.x, 0.01, it.y]} rotation={[0, (-it.rot * Math.PI) / 180, 0]}>
          <Shape it={it} warn={fits[i] !== 'ok'} />
        </group>
      ))}
    </group>
  );
}
