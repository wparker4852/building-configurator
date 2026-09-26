// The 3D canvas: lighting, ground, camera presets and screenshot capture.

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, Sky } from '@react-three/drei';
import * as THREE from 'three';
import type { BuildingConfig, Catalog } from '../core/types';
import type { BuildingGeometry } from '../core/geometry';
import Building from './Building';
import { groundTexture } from './materials';

export type ViewPreset = 'iso' | 'front' | 'back' | 'side' | 'top';

/** Vertical field of view, shared by the camera and the framing math. */
const FOV = 38;

export interface CameraView {
  preset: ViewPreset;
  /** Bumped by the UI to re-trigger the fly-to even if the preset is unchanged. */
  nonce: number;
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

function Ground({ radius }: { radius: number }) {
  const tex = useMemo(() => groundTexture(), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <planeGeometry args={[radius * 14, radius * 14]} />
      <meshStandardMaterial map={tex} roughness={1} metalness={0} />
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

function label(ft: number) {
  const whole = Math.floor(ft);
  const inches = Math.round((ft - whole) * 12);
  return inches === 0 ? `${whole}'` : `${whole}'${inches}"`;
}

function Dimensions({ cfg, geo }: { cfg: BuildingConfig; geo: BuildingGeometry }) {
  const halfW = cfg.width / 2;
  const halfL = cfg.length / 2;
  const off = 2.5;
  const style: React.CSSProperties = {
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

  return (
    <group>
      <Html position={[0, 0.1, halfL + off]} style={style} zIndexRange={[10, 0]}>
        {label(cfg.width)} wide
      </Html>
      <Html position={[halfW + off, 0.1, 0]} style={style} zIndexRange={[10, 0]}>
        {label(cfg.length)} long
      </Html>
      <Html position={[halfW + 0.6, cfg.eaveHeight, halfL + 0.6]} style={style} zIndexRange={[10, 0]}>
        {label(cfg.eaveHeight)} eave
      </Html>
      <Html position={[0, geo.metrics.peakHeight + 1.1, 0]} style={style} zIndexRange={[10, 0]}>
        {label(geo.metrics.peakHeight)} peak
      </Html>
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
  showDimensions: boolean;
  frameOnly: boolean;
  onCaptureReady?: (fn: () => string) => void;
}

export default function Scene({ cfg, catalog, geo, view, showDimensions, frameOnly, onCaptureReady }: SceneProps) {
  // Pull back far enough that the building's bounding sphere fits the vertical
  // field of view, with a margin so nothing clips at the edges.
  const radius = useMemo(() => {
    const bounding = 0.5 * Math.hypot(cfg.width, cfg.length, geo.metrics.peakHeight);
    return Math.max(24, (bounding / Math.sin((FOV * Math.PI) / 360)) * 1.28);
  }, [cfg.width, cfg.length, geo.metrics.peakHeight]);
  const focusY = geo.metrics.peakHeight * 0.4;

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
      <Sky sunPosition={[radius, radius * 1.3, radius * 0.6]} turbidity={5} rayleigh={1.4} />
      <Lighting radius={radius} />
      <Ground radius={radius} />
      <Building cfg={cfg} catalog={catalog} geo={geo} frameOnly={frameOnly} />
      {showDimensions && <Dimensions cfg={cfg} geo={geo} />}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={radius * 4}
        maxPolarAngle={Math.PI / 2 - 0.03}
        target={[0, focusY, 0]}
      />
      <CameraRig view={view} radius={radius} focusY={focusY} />
      <Capture onReady={onCaptureReady} />
    </Canvas>
  );
}
