// Assembles the three.js scene graph for a building from its computed geometry.
//
// Wall coordinates are wall-local: x runs along the wall (centered), y is up
// from the floor, and +z always points OUT of the building. That makes every
// wall, door and window use the same math regardless of which side it is on.

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { BuildingConfig, Catalog, ColorOption, MaterialOption } from '../core/types';
import type { BuildingGeometry, HoleRect, WallSpec } from '../core/geometry';
import { finishTexture, floorTexture, galvalumeTexture, roughnessFor, tiled, tiledNormal } from './materials';

/**
 * Colour and normal maps for a panelled surface. Ribbed steel gets the AG rib
 * normal map; a wood- or stone-look colour prints over the same ribs.
 */
function usePanelMaps(
  texture: MaterialOption['texture'],
  color: ColorOption,
  repeatX: number,
  repeatY: number,
  horizontal: boolean,
) {
  return useMemo(() => {
    const printed = color.finish === 'wood' || color.finish === 'stone';
    const map = printed
      ? finishTexture(color.finish as 'wood' | 'stone', color.hex, color.variant, repeatX, repeatY)
      : tiled(texture, color.hex, repeatX, repeatY, horizontal);
    const ribbed = texture === 'ribbed';
    const normalMap = ribbed ? tiledNormal(horizontal, repeatX, repeatY) : null;
    return { map, normalMap };
  }, [texture, color.hex, color.finish, color.variant, repeatX, repeatY, horizontal]);
}

const NORMAL_SCALE = new THREE.Vector2(1.4, 1.4);

interface Skin {
  siding: MaterialOption;
  roofing: MaterialOption;
  sidingColor: ColorOption;
  roofColor: ColorOption;
  trimColor: ColorOption;
  wainscotColor: ColorOption | null;
  /** True when wall panels run horizontally. */
  sidingHorizontal: boolean;
  /** True when roof panels run lengthwise rather than ridge-to-eave. */
  roofHorizontal: boolean;
}

function useSkin(cfg: BuildingConfig, catalog: Catalog): Skin {
  return useMemo(() => {
    const color = (id: string) => catalog.colors.find((c) => c.id === id) ?? catalog.colors[0];
    const build = catalog.roofBuilds.find((b) => b.id === cfg.roofBuild);
    return {
      siding: catalog.sidings.find((s) => s.id === cfg.sidingId) ?? catalog.sidings[0],
      roofing: catalog.roofings.find((r) => r.id === cfg.roofingId) ?? catalog.roofings[0],
      sidingColor: color(cfg.sidingColorId),
      roofColor: color(cfg.roofColorId),
      trimColor: color(cfg.trimColorId),
      wainscotColor: cfg.wainscotColorId ? color(cfg.wainscotColorId) : null,
      sidingHorizontal: cfg.sidingOrientation !== 'vertical',
      roofHorizontal: (build?.panels ?? 'vertical') === 'horizontal',
    };
  }, [
    cfg.sidingId, cfg.roofingId, cfg.sidingColorId, cfg.roofColorId, cfg.trimColorId,
    cfg.wainscotColorId, cfg.sidingOrientation, cfg.roofBuild, catalog,
  ]);
}

/** Disposes the previous geometry whenever a new one is built. */
function useDisposableGeometry<T extends THREE.BufferGeometry>(factory: () => T, deps: unknown[]): T {
  const geom = useMemo(factory, deps);
  const prev = useRef<T | null>(null);
  useLayoutEffect(() => {
    const stale = prev.current;
    prev.current = geom;
    if (stale && stale !== geom) stale.dispose();
    return () => {
      // Dispose on unmount only; swaps are handled above.
      if (prev.current === geom) geom.dispose();
    };
  }, [geom]);
  return geom;
}

// ── Doors and windows ────────────────────────────────────────────────────────

function Glass({ width, height, z }: { width: number; height: number; z: number }) {
  return (
    <mesh position={[0, 0, z]}>
      <boxGeometry args={[width, height, 0.05]} />
      <meshStandardMaterial
        color="#a8c6d8"
        transparent
        opacity={0.55}
        roughness={0.08}
        metalness={0.15}
        emissive="#6f93ab"
        emissiveIntensity={0.18}
      />
    </mesh>
  );
}

function OpeningMesh({
  hole,
  thickness,
  trim,
}: {
  hole: HoleRect;
  thickness: number;
  trim: ColorOption;
}) {
  const w = hole.x1 - hole.x0;
  const h = hole.y1 - hole.y0;
  const cx = hole.cx;
  const cy = (hole.y0 + hole.y1) / 2;
  const trimRough = roughnessFor(trim.metallic ?? 0.25);
  const { category } = hole.type;

  const doorTex = useMemo(
    () => (category === 'overhead' ? tiled('ribbed', trim.hex, 1, Math.max(1, h / 1.75), true) : null),
    [category, trim.hex, h],
  );

  // Trim casing sits just proud of the outside face.
  const casing = 0.28;
  const casingZ = thickness + 0.03;

  return (
    <group position={[cx, cy, 0]}>
      {/* The frame-out steel (jambs, header, sill) is part of the frame, in
          core/geometry.ts, so it also shows with the panels off. */}

      {/* Casing: top, bottom, left, right. A framed opening gets steel only. */}
      <group visible={category !== 'framed'}>
        <mesh position={[0, h / 2 + casing / 2, casingZ]} castShadow>
          <boxGeometry args={[w + casing * 2, casing, 0.09]} />
          <meshStandardMaterial color={trim.hex} roughness={trimRough} metalness={trim.metallic ?? 0.2} />
        </mesh>
        {hole.y0 > 0.05 && (
          <mesh position={[0, -h / 2 - casing / 2, casingZ]} castShadow>
            <boxGeometry args={[w + casing * 2, casing, 0.09]} />
            <meshStandardMaterial color={trim.hex} roughness={trimRough} metalness={trim.metallic ?? 0.2} />
          </mesh>
        )}
        <mesh position={[-w / 2 - casing / 2, 0, casingZ]} castShadow>
          <boxGeometry args={[casing, h + casing * 2, 0.09]} />
          <meshStandardMaterial color={trim.hex} roughness={trimRough} metalness={trim.metallic ?? 0.2} />
        </mesh>
        <mesh position={[w / 2 + casing / 2, 0, casingZ]} castShadow>
          <boxGeometry args={[casing, h + casing * 2, 0.09]} />
          <meshStandardMaterial color={trim.hex} roughness={trimRough} metalness={trim.metallic ?? 0.2} />
        </mesh>
      </group>

      {category === 'overhead' && (
        <mesh position={[0, 0, thickness * 0.45]} castShadow>
          <boxGeometry args={[w - 0.06, h - 0.06, 0.12]} />
          <meshStandardMaterial map={doorTex} color="#ffffff" roughness={0.55} metalness={0.25} />
        </mesh>
      )}

      {category === 'walk' && (
        <>
          <mesh position={[0, 0, thickness * 0.5]} castShadow>
            <boxGeometry args={[w - 0.12, h - 0.1, 0.11]} />
            <meshStandardMaterial color={trim.hex} roughness={0.6} metalness={trim.metallic ?? 0.15} />
          </mesh>
          {hole.type.id.includes('glass') && <Glass width={w - 0.75} height={h * 0.32} z={thickness * 0.5 + 0.06} />}
          <mesh position={[w / 2 - 0.42, -0.15, thickness * 0.5 + 0.1]} castShadow>
            <boxGeometry args={[0.1, 0.42, 0.08]} />
            <meshStandardMaterial color="#8b8f94" roughness={0.35} metalness={0.85} />
          </mesh>
        </>
      )}

      {category === 'window' && (
        <>
          <mesh position={[0, 0, thickness * 0.55]}>
            <boxGeometry args={[w - 0.1, h - 0.1, 0.07]} />
            <meshStandardMaterial color={trim.hex} roughness={0.6} metalness={trim.metallic ?? 0.15} />
          </mesh>
          <Glass width={w - 0.42} height={h - 0.42} z={thickness * 0.55 + 0.04} />
          {w >= 3.5 && (
            <mesh position={[0, 0, thickness * 0.55 + 0.07]}>
              <boxGeometry args={[0.09, h - 0.42, 0.05]} />
              <meshStandardMaterial color={trim.hex} roughness={0.6} />
            </mesh>
          )}
        </>
      )}
    </group>
  );
}

// ── Walls ────────────────────────────────────────────────────────────────────

/**
 * The contrasting band around the base of the walls. Built as its own
 * extrusion clipped to the wainscot height so that doors and windows punch
 * through it exactly as they do the wall behind.
 */
function Wainscot({ wall, catalog, color }: { wall: WallSpec; catalog: Catalog; color: ColorOption }) {
  const height = catalog.rules.wainscotHeight;
  const t = catalog.rules.wallThickness;
  const half = wall.length / 2;

  const geometry = useDisposableGeometry(() => {
    const shape = new THREE.Shape([
      new THREE.Vector2(-half, 0),
      new THREE.Vector2(half, 0),
      new THREE.Vector2(half, height),
      new THREE.Vector2(-half, height),
    ]);
    for (const hole of wall.holes) {
      if (hole.y0 >= height) continue;
      const path = new THREE.Path();
      const top = Math.min(hole.y1, height);
      path.moveTo(hole.x0, hole.y0);
      path.lineTo(hole.x1, hole.y0);
      path.lineTo(hole.x1, top);
      path.lineTo(hole.x0, top);
      path.closePath();
      shape.holes.push(path);
    }
    return new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 1 });
  }, [half, height, JSON.stringify(wall.holes.map((h) => [h.x0, h.x1, h.y0, h.y1]))]);

  const { map, normalMap } = usePanelMaps('ribbed', color, 1 / 3, 1 / 3, true);

  return (
    <mesh geometry={geometry} position={[0, 0, t]} castShadow receiveShadow>
      <meshStandardMaterial
        map={map}
        normalMap={normalMap}
        normalScale={NORMAL_SCALE}
        color="#ffffff"
        roughness={roughnessFor(color.metallic ?? 0.3)}
        metalness={(color.metallic ?? 0.3) * 0.5}
      />
    </mesh>
  );
}

/**
 * Base angle: the L-trim that closes the bottom of the siding at grade. Cut
 * out wherever a door comes down to the floor.
 */
function BaseTrim({ wall, thickness, trim }: { wall: WallSpec; thickness: number; trim: ColorOption }) {
  const half = wall.length / 2;
  const leg = 0.18;
  const runs: [number, number][] = [];
  let cursor = -half;
  const doors = wall.holes.filter((h) => h.y0 < 0.05).sort((a, b) => a.x0 - b.x0);
  for (const d of doors) {
    if (d.x0 > cursor) runs.push([cursor, d.x0]);
    cursor = Math.max(cursor, d.x1);
  }
  if (half > cursor) runs.push([cursor, half]);
  const rough = roughnessFor(trim.metallic ?? 0.25);
  return (
    <group>
      {runs
        .filter(([a, b]) => b - a > 0.2)
        .map(([a, b]) => (
          <group key={a}>
            <mesh position={[(a + b) / 2, leg / 2, thickness + 0.012]} castShadow>
              <boxGeometry args={[b - a, leg, 0.024]} />
              <meshStandardMaterial color={trim.hex} roughness={rough} metalness={(trim.metallic ?? 0.25) * 0.6} />
            </mesh>
            <mesh position={[(a + b) / 2, 0.012, thickness + leg / 2]} receiveShadow>
              <boxGeometry args={[b - a, 0.024, leg]} />
              <meshStandardMaterial color={trim.hex} roughness={rough} metalness={(trim.metallic ?? 0.25) * 0.6} />
            </mesh>
          </group>
        ))}
    </group>
  );
}

function Wall({
  wall,
  catalog,
  skin,
}: {
  wall: WallSpec;
  catalog: Catalog;
  skin: Skin;
}) {
  const t = catalog.rules.wallThickness;

  const geometry = useDisposableGeometry(() => {
    const shape = new THREE.Shape(wall.outline.map((p) => new THREE.Vector2(p.x, p.y)));
    for (const hole of wall.holes) {
      const path = new THREE.Path();
      path.moveTo(hole.x0, hole.y0);
      path.lineTo(hole.x1, hole.y0);
      path.lineTo(hole.x1, hole.y1);
      path.lineTo(hole.x0, hole.y1);
      path.closePath();
      shape.holes.push(path);
    }
    return new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
    // Outline and holes both change with nearly every edit.
  }, [JSON.stringify(wall.outline), JSON.stringify(wall.holes.map((h) => [h.x0, h.x1, h.y0, h.y1])), t]);

  // Extrude UVs are in feet, so a repeat of 1/tile gives one panel per `tile` feet.
  const tile = skin.siding.tileHeight ?? 3;
  const { map, normalMap } = usePanelMaps(skin.siding.texture, skin.sidingColor, 1 / tile, 1 / tile, skin.sidingHorizontal);

  // Steel siding shows bare galvalume on the inside. Drawn as a skin just
  // inboard of the wall, facing in, so it only renders from inside.
  const steel = skin.siding.texture === 'ribbed' || skin.siding.texture === 'board-batten';
  const inner = useDisposableGeometry(() => {
    const shape = new THREE.Shape(wall.outline.map((p) => new THREE.Vector2(p.x, p.y)));
    for (const hole of wall.holes) {
      const path = new THREE.Path();
      path.moveTo(hole.x0, hole.y0);
      path.lineTo(hole.x1, hole.y0);
      path.lineTo(hole.x1, hole.y1);
      path.lineTo(hole.x0, hole.y1);
      path.closePath();
      shape.holes.push(path);
    }
    return new THREE.ShapeGeometry(shape, 1);
  }, [JSON.stringify(wall.outline), JSON.stringify(wall.holes.map((h) => [h.x0, h.x1, h.y0, h.y1]))]);
  const galv = useMemo(() => {
    const tex = galvalumeTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(1 / 3, 1 / 3);
    if (skin.sidingHorizontal) tex.rotation = Math.PI / 2;
    return tex;
  }, [skin.sidingHorizontal]);

  return (
    <group position={wall.position} rotation={[0, wall.rotationY, 0]}>
      {steel && (
        <mesh geometry={inner} position={[0, 0, -0.006]}>
          <meshStandardMaterial
            map={galv}
            side={THREE.BackSide}
            metalness={0.5}
            roughness={0.42}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      )}
      <BaseTrim wall={wall} thickness={t} trim={skin.trimColor} />
      <mesh geometry={geometry} castShadow receiveShadow>
        {/* Group 0 is the front/back faces, group 1 the extruded edges. */}
        <meshStandardMaterial
          attach="material-0"
          map={map}
          normalMap={normalMap}
          normalScale={NORMAL_SCALE}
          color="#ffffff"
          roughness={roughnessFor(skin.sidingColor.metallic ?? 0.3)}
          metalness={(skin.sidingColor.metallic ?? 0.3) * 0.5}
        />
        <meshStandardMaterial
          attach="material-1"
          color={skin.trimColor.hex}
          roughness={roughnessFor(skin.trimColor.metallic ?? 0.25)}
          metalness={(skin.trimColor.metallic ?? 0.25) * 0.5}
        />
      </mesh>
      {skin.wainscotColor && <Wainscot wall={wall} catalog={catalog} color={skin.wainscotColor} />}
      {wall.holes.map((hole) => (
        <OpeningMesh
          key={hole.opening.id}
          hole={hole}
          thickness={t}
          trim={skin.trimColor}
        />
      ))}
    </group>
  );
}

// ── Roof ─────────────────────────────────────────────────────────────────────

function Roof({ cfg, catalog, geo, skin }: { cfg: BuildingConfig; catalog: Catalog; geo: BuildingGeometry; skin: Skin }) {
  const t = catalog.rules.roofThickness;
  const tile = skin.roofing.tileHeight ?? 3;
  const trimRough = roughnessFor(skin.trimColor.metallic ?? 0.25);

  const peak = Math.max(...geo.profile.map((p) => p.y));
  // A rounded roof curves over the ridge; only squared builds get a cap.
  const hasRidge = geo.baseProfile.length >= 3 && !geo.rounded;
  const runLength = cfg.length + 2 * cfg.gableOverhang;
  // Slope of the two runs that meet at the ridge.
  const ridge = geo.baseProfile[Math.floor(geo.baseProfile.length / 2)];
  const before = geo.baseProfile[Math.floor(geo.baseProfile.length / 2) - 1] ?? ridge;
  const ridgeAngle = Math.atan2(ridge.y - before.y, ridge.x - before.x || 1);

  return (
    <group>
      {geo.roofPlanes.map((plane) => (
        <RoofPlaneMesh key={plane.key} plane={plane} thickness={t} tile={tile} skin={skin} />
      ))}

      {/* Ridge cap: 29 ga sheet bent to the roof's own pitch, lapping 6"
          down each slope and lying flat on the panels. */}
      {hasRidge && (
        <group position={[0, peak + t / Math.cos(ridgeAngle) + 0.012, 0]}>
          {[-1, 1].map((side) => (
            <group key={side} rotation={[0, 0, -side * ridgeAngle]}>
              <mesh position={[side * 0.25, 0, 0]} castShadow>
                <boxGeometry args={[0.5, 0.024, runLength + 0.05]} />
                <meshStandardMaterial
                  color={skin.trimColor.hex}
                  roughness={trimRough}
                  metalness={(skin.trimColor.metallic ?? 0.25) * 0.6}
                />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* Fascia along the two outer roof edges. A rounded roof has no flat eave to trim. */}
      {(geo.rounded ? [] : [geo.roofPlanes[0], geo.roofPlanes[geo.roofPlanes.length - 1]]).map((plane, i) => {
        if (!plane) return null;
        const dir = i === 0 ? -1 : 1;
        const [px, py] = plane.position;
        const ex = px + dir * Math.cos(plane.rotationZ) * (plane.slopeLength / 2);
        const ey = py + dir * Math.sin(plane.rotationZ) * (plane.slopeLength / 2);
        return (
          <mesh key={`fascia-${i}`} position={[ex, ey - 0.26, 0]} castShadow>
            <boxGeometry args={[0.16, 0.55, runLength]} />
            <meshStandardMaterial
              color={skin.trimColor.hex}
              roughness={trimRough}
              metalness={(skin.trimColor.metallic ?? 0.25) * 0.6}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function RoofPlaneMesh({
  plane,
  thickness,
  tile,
  skin,
}: {
  plane: BuildingGeometry['roofPlanes'][number];
  thickness: number;
  tile: number;
  skin: Skin;
}) {
  // On the slab's top face, u runs up the slope and v runs along the ridge.
  // Ribs drawn across v therefore run ridge-to-eave (a vertical roof); ribs
  // drawn across u run lengthwise (a regular or boxed-eave roof).
  const shingle = skin.roofing.texture === 'shingle';
  // Box face UVs run 0..1, so the repeat is simply panels per face.
  const repeat: [number, number] = shingle
    ? [plane.slopeLength / tile, plane.runLength / tile]
    : skin.roofHorizontal
      ? [plane.slopeLength / tile, 1]
      : [1, plane.runLength / tile];
  const ribsAcrossV = !shingle && !skin.roofHorizontal;
  const { map, normalMap } = usePanelMaps(
    shingle ? 'shingle' : 'ribbed',
    skin.roofColor,
    repeat[0],
    repeat[1],
    ribsAcrossV,
  );
  const under = useMemo(() => {
    const tex = galvalumeTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(repeat[0], repeat[1]);
    if (!ribsAcrossV) tex.rotation = Math.PI / 2;
    return tex;
  }, [repeat[0], repeat[1], ribsAcrossV]);

  return (
    <mesh position={plane.position} rotation={[0, 0, plane.rotationZ]} castShadow receiveShadow>
      <boxGeometry args={[plane.slopeLength, thickness, plane.runLength]} />
      {/* Box faces: +x, -x, +y (weather side), -y (underside), +z, -z. */}
      {[0, 1, 2, 4, 5].map((i) => (
        <meshStandardMaterial
          key={i}
          attach={`material-${i}`}
          map={map}
          normalMap={i === 2 ? normalMap : null}
          normalScale={NORMAL_SCALE}
          color="#ffffff"
          roughness={roughnessFor(skin.roofColor.metallic ?? 0.3)}
          metalness={(skin.roofColor.metallic ?? 0.3) * 0.5}
        />
      ))}
      {shingle ? (
        <meshStandardMaterial attach="material-3" color="#9a8f7c" roughness={0.9} />
      ) : (
        <meshStandardMaterial attach="material-3" map={under} metalness={0.5} roughness={0.42} />
      )}
    </mesh>
  );
}

// ── Structure and site ───────────────────────────────────────────────────────

/**
 * The tube-steel frame, drawn as a single instanced mesh. A 200' building at
 * 4' on center is over 400 tubes, so instancing is what keeps this cheap.
 */
const STEEL = '#c3c8cc';
const UPGRADE_STEEL = '#8e979f';

function Frame({ members }: { members: BuildingGeometry['frame'] }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    // The leg upgrade (second leg, its base rail, ladder rungs) is a shade
    // darker, so the steel being charged for reads against the standard frame.
    const steel = new THREE.Color(STEEL);
    const upgrade = new THREE.Color(UPGRADE_STEEL);
    members.forEach((m, i) => {
      euler.set(m.rotation[0], m.rotation[1], m.rotation[2]);
      quat.setFromEuler(euler);
      pos.set(m.position[0], m.position[1], m.position[2]);
      scl.set(m.size[0], m.size[1], m.size[2]);
      matrix.compose(pos, quat, scl);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, m.upgrade ? upgrade : steel);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [members]);

  return (
    // The instance count is fixed at construction, so remount when it changes.
    <instancedMesh key={members.length} ref={ref} args={[undefined, undefined, members.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      {/* Low metalness on purpose: there is no environment map in the scene,
          and a high-metalness surface with nothing to reflect renders black. */}
      {/* White so the per-instance colour is the colour. */}
      <meshStandardMaterial color="#ffffff" metalness={0.18} roughness={0.52} />
    </instancedMesh>
  );
}

function CornerTrim({ cfg, geo, skin }: { cfg: BuildingConfig; geo: BuildingGeometry; skin: Skin }) {
  const present = Object.fromEntries(geo.walls.map((w) => [w.id, w.present]));
  const halfW = cfg.width / 2;
  const halfL = cfg.length / 2;
  const leftH = geo.eaves.left;
  const rightH = geo.eaves.right;
  const rough = roughnessFor(skin.trimColor.metallic ?? 0.25);

  const corners: { x: number; z: number; h: number; walls: [string, string] }[] = [
    { x: -halfW, z: halfL, h: leftH, walls: ['left', 'front'] },
    { x: halfW, z: halfL, h: rightH, walls: ['right', 'front'] },
    { x: -halfW, z: -halfL, h: leftH, walls: ['left', 'back'] },
    { x: halfW, z: -halfL, h: rightH, walls: ['right', 'back'] },
  ];

  return (
    <group>
      {corners
        .filter((c) => present[c.walls[0]] && present[c.walls[1]])
        .map((c, i) => (
          <mesh key={`corner-${i}`} position={[c.x - Math.sign(c.x) * 0.16, c.h / 2, c.z - Math.sign(c.z) * 0.16]} castShadow>
            <boxGeometry args={[0.34, c.h, 0.34]} />
            <meshStandardMaterial color={skin.trimColor.hex} roughness={rough} metalness={(skin.trimColor.metallic ?? 0.25) * 0.6} />
          </mesh>
        ))}
    </group>
  );
}

function Floor({ cfg, catalog }: { cfg: BuildingConfig; catalog: Catalog }) {
  const floor = catalog.floors.find((f) => f.id === cfg.floorId);
  const pad = 0.6;
  const w = cfg.width + pad;
  const l = cfg.length + pad;
  const kind = floor?.texture;
  const map = useMemo(() => {
    if (!floor || !kind) return null;
    // Poured surfaces tile at 8', loose ones at 4'.
    const tile = kind === 'gravel' || kind === 'dirt' ? 4 : 8;
    const tex = floorTexture(kind, floor.hex).clone();
    tex.needsUpdate = true;
    tex.repeat.set(w / tile, l / tile);
    return tex;
  }, [kind, floor?.hex, w, l]);
  if (!floor || floor.thickness <= 0) return null;
  const rough = kind === 'concrete' ? 0.82 : kind === 'wood' ? 0.75 : 0.97;
  return (
    <mesh position={[0, -floor.thickness / 2 + 0.01, 0]} receiveShadow>
      <boxGeometry args={[w, floor.thickness, l]} />
      <meshStandardMaterial map={map} color={map ? '#ffffff' : floor.hex} roughness={rough} metalness={0.02} />
    </mesh>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function Building({
  cfg,
  catalog,
  geo,
  frameOnly = false,
}: {
  cfg: BuildingConfig;
  catalog: Catalog;
  geo: BuildingGeometry;
  /** Strip the skin and show just the steel, the way a fabricator reads it. */
  frameOnly?: boolean;
}) {
  const skin = useSkin(cfg, catalog);

  if (frameOnly) {
    return (
      <group>
        <Frame members={geo.frame} />
      </group>
    );
  }

  return (
    <group>
      <Floor cfg={cfg} catalog={catalog} />
      <Frame members={geo.frame} />
      {geo.walls.filter((w) => w.present).map((wall) => (
        <Wall key={wall.id} wall={wall} catalog={catalog} skin={skin} />
      ))}
      <CornerTrim cfg={cfg} geo={geo} skin={skin} />
      <Roof cfg={cfg} catalog={catalog} geo={geo} skin={skin} />
    </group>
  );
}
