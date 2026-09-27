// The 3D canvas: lighting, ground, camera presets, the walk-in view, overlays
// and screenshot capture.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, Sky } from '@react-three/drei';
import * as THREE from 'three';
import type { BuildingConfig, Catalog, PlanItem } from '../core/types';
import type { BuildingGeometry } from '../core/geometry';
import { feetInches } from '../core/format';
import Building from './Building';
import Equipment from './Equipment';
import { checkFit, placedRect } from '../core/floorPlan';
import { groundTexture } from './materials';
import type { HeadOffset } from './headTracking';

export type ViewPreset = 'iso' | 'front' | 'back' | 'side' | 'top';

/** Vertical field of view, shared by the camera and the framing math. */
const FOV = 38;
/** The walk-in view starts wide, the way a phone camera sees a room. */
const INSIDE_FOV = 80;

export interface CameraView {
  preset: ViewPreset;
  /** Bumped by the UI to re-trigger the fly-to even if the preset is unchanged. */
  nonce: number;
}

/** What the viewport overlays. */
export interface Layers {
  dimensions: boolean;
  /** FRONT / BACK / LEFT / RIGHT painted on the ground. */
  orientation: boolean;
  /** Sky and grass; off gives a plain studio backdrop for clean screenshots. */
  scenery: boolean;
  /** Vehicles and equipment from the floor plan. */
  equipment: boolean;
}

/** Unit direction the camera sits along for each preset. */
const DIRECTIONS: Record<ViewPreset, [number, number, number]> = {
  iso: [0.95, 0.62, 1.15],
  front: [0, 0.22, 1.6],
  back: [0, 0.22, -1.6],
  side: [1.6, 0.22, 0],
  top: [0.001, 2.0, 0.001],
};

function CameraRig({ view, radius, focusY }: { view: CameraView; radius: number; focusY: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null;
  const animateUntil = useRef(0);
  const goal = useRef(new THREE.Vector3());
  const focus = useRef(new THREE.Vector3());

  useEffect(() => {
    const dir = new THREE.Vector3(...DIRECTIONS[view.preset]).normalize();
    goal.current.copy(dir).multiplyScalar(radius).setY(dir.y * radius + focusY * 0.4);
    focus.current.set(0, focusY, 0);
    // Give the fly-to a fixed budget so manual orbiting is never fought over.
    animateUntil.current = performance.now() + 900;
  }, [view.preset, view.nonce, radius, focusY]);

  useFrame((_, dt) => {
    if (performance.now() > animateUntil.current) return;
    const t = 1 - Math.pow(0.0015, dt);
    camera.position.lerp(goal.current, t);
    if (controls) {
      controls.target.lerp(focus.current, t);
      controls.update();
    }
  });

  return null;
}

/**
 * Standing inside the building at eye height. Drag to look around, scroll to
 * widen or narrow the lens. Orbit controls are off while this is mounted.
 */
function InsideCamera({
  eye,
  stand,
  look,
}: {
  eye: number;
  /** Where on the floor to stand, in world x/z. */
  stand: { x: number; z: number };
  look: React.MutableRefObject<{ yaw: number; pitch: number }>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const prev = { fov: camera.fov, near: camera.near, pos: camera.position.clone(), quat: camera.quaternion.clone() };
    camera.fov = INSIDE_FOV;
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    // Face across the building from where we stand; from the back that is
    // the front gable, where the big door usually is.
    look.current = { yaw: stand.z > 0.5 ? Math.PI : 0, pitch: -0.05 };

    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      look.current.yaw += (e.clientX - drag.x) * 0.004;
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - (e.clientY - drag.y) * 0.004, -1.45, 1.45);
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.05, 45, 125);
      camera.updateProjectionMatrix();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
      camera.fov = prev.fov;
      camera.near = prev.near;
      camera.position.copy(prev.pos);
      camera.quaternion.copy(prev.quat);
      camera.updateProjectionMatrix();
    };
    // Re-aim only when the standing spot moves to the other half.
  }, [camera, gl, look, stand.z > 0.5]);

  useFrame(() => {
    const { yaw, pitch } = look.current;
    camera.position.set(stand.x, eye, stand.z);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(camera.position.clone().add(dir));
  });
  return null;
}

/**
 * Applies the head-tracking offset for one frame only: nudge the camera,
 * render, put it back. Orbit controls never see the offset, so it cannot
 * accumulate into drift. Mounted only while tracking is on, because a
 * positive-priority frame callback takes over rendering.
 */
function HeadTrackRender({ offset, inside, focusY }: { offset: HeadOffset; inside: boolean; focusY: number }) {
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3 } | null;
  useFrame(({ gl, scene, camera }) => {
    const pos = camera.position.clone();
    const quat = camera.quaternion.clone();
    if (inside) {
      camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -offset.theta * 0.35);
      camera.rotateX(-offset.phi * 0.35);
    } else {
      const target = controls?.target ?? new THREE.Vector3(0, focusY, 0);
      const s = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
      s.theta += offset.theta;
      s.phi = THREE.MathUtils.clamp(s.phi + offset.phi, 0.05, Math.PI / 2 - 0.03);
      s.radius = Math.max(6, s.radius + offset.zoom);
      camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(s));
      camera.lookAt(target);
    }
    gl.render(scene, camera);
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
  }, 1);
  return null;
}

/**
 * Where to stand in the walk-in view: 3' in from the back wall on the
 * centerline, unless something from the floor plan is parked there; then the
 * first clear spot among a few sensible places.
 */
function standingSpot(items: PlanItem[], geo: BuildingGeometry): { x: number; z: number } {
  const cw = geo.metrics.clearWidth / 2;
  const cl = geo.metrics.clearLength / 2;
  const inset = Math.min(3, cl * 0.4);
  const candidates = [
    { x: 0, z: -cl + inset },
    { x: 0, z: cl - inset },
    { x: 0, z: 0 },
    { x: -cw + inset, z: -cl + inset },
    { x: cw - inset, z: -cl + inset },
    { x: -cw + inset, z: cl - inset },
    { x: cw - inset, z: cl - inset },
  ];
  const clear = (p: { x: number; z: number }) =>
    items.every((it) => {
      const r = placedRect(it);
      return p.x < r.x0 - 0.75 || p.x > r.x1 + 0.75 || p.z < r.y0 - 0.75 || p.z > r.y1 + 0.75;
    });
  return candidates.find(clear) ?? candidates[0];
}

function Ground({ radius, scenery }: { radius: number; scenery: boolean }) {
  const tex = useMemo(() => groundTexture(), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <planeGeometry args={[radius * 14, radius * 14]} />
      {/* Keyed so the swap builds a fresh material rather than leaving the
          grass map on the old one. */}
      {scenery ? (
        <meshStandardMaterial key="grass" map={tex} roughness={1} metalness={0} />
      ) : (
        <meshStandardMaterial key="plain" color="#c9cfd4" roughness={1} metalness={0} />
      )}
    </mesh>
  );
}

function Lighting({ radius }: { radius: number }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const extent = radius * 1.4;
  return (
    <>
      <hemisphereLight args={['#c4dcf5', '#6d7d58', 0.62]} />
      <ambientLight intensity={0.22} />
      <directionalLight
        ref={ref}
        position={[radius * 1.1, radius * 1.45, radius * 0.75]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-camera-near={1}
        shadow-camera-far={radius * 8}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
      />
      {/* A dim fill from the opposite side keeps shaded walls readable. */}
      <directionalLight position={[-radius, radius * 0.6, -radius * 0.8]} intensity={0.35} />
    </>
  );
}

// ── Overlays ─────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  background: 'rgba(17,20,24,0.82)',
  color: '#fff',
  padding: '2px 7px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  transform: 'translate(-50%, -50%)',
};

type Side = 'front' | 'back' | 'left' | 'right';

/**
 * Which walls face the camera, re-evaluated every frame but only committed to
 * state when it changes. Dimension lines go on the sides you can see.
 */
function useFacing(halfW: number, halfL: number): Record<Side, boolean> {
  const [facing, setFacing] = useState<Record<Side, boolean>>({ front: true, back: false, left: false, right: true });
  const last = useRef('');
  useFrame(({ camera }) => {
    const p = camera.position;
    const next = { front: p.z > halfL, back: p.z < -halfL, left: p.x < -halfW, right: p.x > halfW };
    const key = `${+next.front}${+next.back}${+next.left}${+next.right}`;
    if (key !== last.current) {
      last.current = key;
      setFacing(next);
    }
  });
  return facing;
}

/** A dimension line: extension lines off two points, a measure line, ticks and a label. */
function DimLine({
  a,
  b,
  out,
  label,
  color = '#15181c',
}: {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Offset from the measured points to the measure line. */
  out: THREE.Vector3;
  label: string;
  color?: string;
}) {
  const a2 = a.clone().add(out);
  const b2 = b.clone().add(out);
  const over = out.clone().normalize().multiplyScalar(0.5);
  const along = b2.clone().sub(a2).normalize();
  const tick = over.clone().add(along).multiplyScalar(0.35);
  const mid = a2.clone().add(b2).multiplyScalar(0.5).add(over.clone().multiplyScalar(1.6));
  return (
    <group>
      <Line points={[a, a2.clone().add(over)]} color={color} lineWidth={1} dashed dashSize={0.35} gapSize={0.25} />
      <Line points={[b, b2.clone().add(over)]} color={color} lineWidth={1} dashed dashSize={0.35} gapSize={0.25} />
      <Line points={[a2, b2]} color={color} lineWidth={1.5} />
      <Line points={[a2.clone().sub(tick), a2.clone().add(tick)]} color={color} lineWidth={2} />
      <Line points={[b2.clone().sub(tick), b2.clone().add(tick)]} color={color} lineWidth={2} />
      <Html position={mid} style={labelStyle} zIndexRange={[10, 0]}>
        {label}
      </Html>
    </group>
  );
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Architectural dimensions on whichever sides face the camera. */
function Dimensions({ cfg, geo }: { cfg: BuildingConfig; geo: BuildingGeometry }) {
  const halfW = cfg.width / 2;
  const halfL = cfg.length / 2;
  const facing = useFacing(halfW, halfL);
  const off = 3 + Math.max(cfg.gableOverhang, cfg.eaveOverhang);
  const y = 0.06;

  const endZ = facing.back && !facing.front ? -halfL : halfL;
  const endDir = Math.sign(endZ);
  const sideX = facing.left && !facing.right ? -halfW : halfW;
  const sideDir = Math.sign(sideX);
  const eaveAt = sideDir < 0 ? geo.eaves.left : geo.eaves.right;

  return (
    <group>
      <DimLine a={v(-halfW, y, endZ)} b={v(halfW, y, endZ)} out={v(0, 0, endDir * off)} label={feetInches(cfg.width)} />
      <DimLine a={v(sideX, y, -halfL)} b={v(sideX, y, halfL)} out={v(sideDir * off, 0, 0)} label={feetInches(cfg.length)} />
      <DimLine
        a={v(sideX, 0, endZ)}
        b={v(sideX, eaveAt, endZ)}
        out={v(sideDir * 1.2, 0, endDir * 1.2)}
        label={`${feetInches(eaveAt)} eave`}
      />
      <DimLine
        a={v(0, 0, endZ + endDir * cfg.gableOverhang)}
        b={v(0, geo.metrics.peakHeight, endZ + endDir * cfg.gableOverhang)}
        out={v(0, 0, endDir * 1.5)}
        label={`${feetInches(geo.metrics.peakHeight)} peak`}
      />
    </group>
  );
}

/** Clear inside dimensions, drawn from where you stand in the walk-in view. */
function InsideDimensions({ geo }: { geo: BuildingGeometry }) {
  const m = geo.metrics;
  const cw = m.clearWidth / 2;
  const cl = m.clearLength / 2;
  const y = geo.tube;
  const color = '#e8632a';
  return (
    <group>
      <DimLine a={v(-cw, y, -cl)} b={v(cw, y, -cl)} out={v(0, 0.02, 0.6)} label={`${feetInches(m.clearWidth)} clear`} color={color} />
      <DimLine a={v(cw, y, -cl)} b={v(cw, y, cl)} out={v(-0.6, 0.02, 0)} label={`${feetInches(m.clearLength)} clear`} color={color} />
      <DimLine
        a={v(-cw, 0, cl)}
        b={v(-cw, m.sideClearHeight, cl)}
        out={v(0.5, 0, -0.5)}
        label={`${feetInches(m.sideClearHeight)} at wall`}
        color={color}
      />
      <Html position={[0, m.clearHeight - 0.4, cl * 0.4]} style={{ ...labelStyle, background: color }} zIndexRange={[10, 0]}>
        Clearance {feetInches(m.clearHeight)}
      </Html>
    </group>
  );
}

/**
 * A flat word painted on the ground. Drawn over everything, like the partner's
 * overlay labels, with the caller fading it out when its wall faces away.
 */
function GroundWord({
  text,
  width,
  materialRef,
}: {
  text: string;
  width: number;
  materialRef: (m: THREE.MeshBasicMaterial | null) => void;
}) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.font = 'bold 84px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(20,24,30,0.72)';
    ctx.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
      <planeGeometry args={[width, width / 4]} />
      <meshBasicMaterial ref={materialRef} map={tex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
    </mesh>
  );
}

/**
 * FRONT / BACK / LEFT / RIGHT on the ground. Outside, each word sits past its
 * wall reading from outside; in the walk-in view it sits just inside the wall
 * reading from the middle of the floor.
 */
function OrientationLabels({ cfg, inside, xray }: { cfg: BuildingConfig; inside: boolean; xray: boolean }) {
  const halfW = cfg.width / 2;
  const halfL = cfg.length / 2;
  const size = THREE.MathUtils.clamp(Math.min(cfg.width, cfg.length) * 0.3, 3, 10);
  // Outside, the words sit beyond the dimension lines (3' plus the overhang out).
  const out = inside ? -0.6 - size / 8 : 5.2 + size / 8 + Math.max(cfg.gableOverhang, cfg.eaveOverhang);
  const sides: { text: string; yaw: number; dist: number }[] = [
    { text: 'FRONT', yaw: 0, dist: halfL },
    { text: 'RIGHT', yaw: Math.PI / 2, dist: halfW },
    { text: 'BACK', yaw: Math.PI, dist: halfL },
    { text: 'LEFT', yaw: -Math.PI / 2, dist: halfW },
  ];
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  // Outside, a word fades out as its wall turns away from the camera — it is
  // drawn over the building, so a word on the far side would otherwise float
  // on top of it. With the panels off (frame only) or from inside, all show.
  useFrame(({ camera }) => {
    sides.forEach((s, i) => {
      const m = mats.current[i];
      if (!m) return;
      if (inside || xray) {
        m.opacity = 1;
        return;
      }
      const n = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
      const at = n.clone().multiplyScalar(s.dist + out);
      const facing = n.dot(camera.position.clone().sub(at).normalize());
      m.opacity = THREE.MathUtils.clamp((facing - 0.08) * 4, 0, 1);
    });
  });

  return (
    <group position={[0, 0.03, 0]}>
      {sides.map((s, i) => (
        <group key={s.text} rotation={[0, s.yaw, 0]}>
          {/* Flip the word in its own plane inside, so it reads from the center. */}
          <group position={[0, 0, s.dist + out]} rotation={[0, inside ? Math.PI : 0, 0]}>
            <GroundWord text={s.text} width={size} materialRef={(m) => (mats.current[i] = m)} />
          </group>
        </group>
      ))}
    </group>
  );
}

function Capture({ onReady }: { onReady?: (fn: () => string) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!onReady) return;
    onReady(() => {
      // Render on demand so the buffer is guaranteed fresh at capture time.
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/png');
    });
  }, [gl, scene, camera, onReady]);
  return null;
}

export interface SceneProps {
  cfg: BuildingConfig;
  catalog: Catalog;
  geo: BuildingGeometry;
  view: CameraView;
  /** Stand inside the building instead of orbiting it. */
  inside?: boolean;
  layers: Layers;
  frameOnly: boolean;
  /** Live head-tracking offset, or null when tracking is off. */
  headOffset?: HeadOffset | null;
  onCaptureReady?: (fn: () => string) => void;
}

export default function Scene({
  cfg, catalog, geo, view, inside = false, layers, frameOnly, headOffset, onCaptureReady,
}: SceneProps) {
  // Pull back far enough that the building's bounding sphere fits the vertical
  // field of view, with a margin so nothing clips at the edges.
  const radius = useMemo(() => {
    const bounding = 0.5 * Math.hypot(cfg.width, cfg.length, geo.metrics.peakHeight);
    return Math.max(24, (bounding / Math.sin((FOV * Math.PI) / 360)) * 1.28);
  }, [cfg.width, cfg.length, geo.metrics.peakHeight]);
  const focusY = geo.metrics.peakHeight * 0.4;
  const eye = Math.min(cfg.eaveHeight * 0.55, 6);
  const stand = useMemo(() => standingSpot(cfg.planItems ?? [], geo), [cfg.planItems, geo]);
  const look = useRef({ yaw: 0, pitch: 0 });
  const items = cfg.planItems ?? [];
  const fits = useMemo(() => checkFit(items, geo), [items, geo]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ fov: FOV, near: 0.5, far: 4000, position: [radius * 0.6, radius * 0.4, radius * 0.72] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      {layers.scenery ? (
        <Sky sunPosition={[radius, radius * 1.3, radius * 0.6]} turbidity={5} rayleigh={1.4} />
      ) : (
        <color attach="background" args={['#e4e9ee']} />
      )}
      <Lighting radius={radius} />
      <Ground radius={radius} scenery={layers.scenery} />
      <Building cfg={cfg} catalog={catalog} geo={geo} frameOnly={frameOnly} />
      {layers.equipment && items.length > 0 && <Equipment items={items} fits={fits} />}
      {layers.dimensions && !inside && <Dimensions cfg={cfg} geo={geo} />}
      {layers.dimensions && inside && <InsideDimensions geo={geo} />}
      {layers.orientation && <OrientationLabels cfg={cfg} inside={inside} xray={frameOnly} />}
      <OrbitControls
        makeDefault
        enabled={!inside}
        enableDamping
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={radius * 4}
        maxPolarAngle={Math.PI / 2 - 0.03}
        target={[0, focusY, 0]}
      />
      {inside ? <InsideCamera eye={eye} stand={stand} look={look} /> : <CameraRig view={view} radius={radius} focusY={focusY} />}
      {headOffset && <HeadTrackRender offset={headOffset} inside={inside} focusY={focusY} />}
      <Capture onReady={onCaptureReady} />
    </Canvas>
  );
}
