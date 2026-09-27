// Procedurally drawn panel textures.
//
// Everything is painted onto a canvas at runtime, so the configurator ships
// with no texture assets and any hex color in the catalog works immediately.

import * as THREE from 'three';
import type { TextureKind } from '../core/types';

const cache = new Map<string, THREE.Texture>();

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amount, 0, 1));
  return `#${c.getHexString()}`;
}

// ── AG panel profile ─────────────────────────────────────────────────────────
// Measured 29 ga agricultural panel, from the Walker Buildings configurator:
//   36" coverage, three major trapezoidal ribs 12" on center (at 1/6, 3/6, 5/6)
//   rib crown 1¼", each flank 7/8" wide, rib height ¾" (so a flank is ~23°)
//   one minor notch ½" wide midway between each pair of major ribs
//   a lap seam at the panel edge
// One texture tile is one 36" panel, which is why ribbed materials carry a
// tileHeight of 3.

const AG = {
  ribs: [1 / 6, 3 / 6, 5 / 6],
  crown: 1.25 / 36,
  flank: 0.875 / 36,
  notches: [2 / 6, 4 / 6],
  notch: 0.5 / 36,
  /** Surface tilt of a flank, as a normal-map channel offset. */
  tilt: Math.round(Math.sin(Math.atan2(0.75, 0.875)) * 127),
};

/**
 * Walk the panel profile across one tile, calling `paint` once per pixel
 * column (or row) with the colour lift to apply and the surface slope there
 * (-1 left flank, 0 flat, +1 right flank). Colour and normal maps share it so
 * the two can never drift apart.
 */
function walkProfile(size: number, paint: (p: number, lift: number, slope: number, depth: number) => void) {
  const px = (f: number) => Math.round(f * size);
  const crown = Math.max(2, px(AG.crown));
  const flank = Math.max(2, px(AG.flank));
  for (const c of AG.ribs) {
    const mid = px(c);
    for (let i = 0; i < flank; i++) {
      const t = Math.sin(((i + 0.5) / flank) * Math.PI);
      paint(mid - Math.round(crown / 2) - flank + i, -0.05 * t, -t, 0);
      paint(mid + Math.round(crown / 2) + i, -0.05 * t, t, 0);
    }
    for (let i = 0; i < crown; i++) paint(mid - Math.round(crown / 2) + i, 0.035, 0, 0);
  }
  for (const c of AG.notches) {
    const mid = px(c);
    const hw = Math.max(1, Math.round((AG.notch * size) / 2));
    for (let i = -hw; i <= hw; i++) {
      const t = 1 - Math.abs(i) / (hw + 1);
      paint(mid + i, -0.06 * t, i < 0 ? 0.35 * t : -0.35 * t, t);
    }
  }
  // Lap seam at the panel edge.
  paint(0, -0.16, 0, 0.5);
}

function drawRibs(ctx: CanvasRenderingContext2D, size: number, hex: string, horizontal: boolean) {
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);
  walkProfile(size, (p, lift) => {
    if (p < 0 || p >= size) return;
    ctx.fillStyle = shade(hex, lift);
    if (horizontal) ctx.fillRect(0, p, size, 1);
    else ctx.fillRect(p, 0, 1, size);
  });
}

/**
 * Tangent-space normal map of the AG profile. Paired with the colour texture,
 * PBR lighting picks out each rib flank on its own instead of the ribs being
 * painted on. For vertical ribs the tilt is across X (red); for ribs running
 * horizontally it is across Y (green).
 */
export function ribNormalMap(horizontal: boolean): THREE.Texture {
  const key = `normal:ribbed:${horizontal}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, size, size);
  walkProfile(size, (p, _lift, slope, depth) => {
    if (p < 0 || p >= size) return;
    const shift = Math.round(slope * AG.tilt);
    const b = Math.round(255 - depth * 55);
    ctx.fillStyle = horizontal ? `rgb(128,${128 - shift},${b})` : `rgb(${128 + shift},128,${b})`;
    if (horizontal) ctx.fillRect(0, p, size, 1);
    else ctx.fillRect(p, 0, 1, size);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/** A repeat-adjusted clone of the rib normal map, to pair with `tiled`. */
export function tiledNormal(horizontal: boolean, repeatX: number, repeatY: number): THREE.Texture {
  const tex = ribNormalMap(horizontal).clone();
  tex.needsUpdate = true;
  tex.repeat.set(Math.max(0.01, repeatX), Math.max(0.01, repeatY));
  return tex;
}

// ── Printed finishes ─────────────────────────────────────────────────────────
// Wood- and stone-look panels are a print on the same ribbed steel, so they
// take the rib normal map too. Patterns are seeded so they never reshuffle
// between renders.

function seeded(seed: number) {
  return (n: number) => {
    const v = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
}

/**
 * Hex to sRGB bytes for canvas painting. Parsed by hand: THREE.Color converts
 * to linear, which would paint every pattern far too dark.
 */
function rgb(hex: string) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
const css = (r: number, g: number, b: number, a = 1) => `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${a})`;

function drawWood(ctx: CanvasRenderingContext2D, w: number, h: number, hex: string, variant = 'pine') {
  const { r, g, b } = rgb(hex);
  const rng = seeded({ pine: 1, oak: 7, cherry: 13, weathered: 3 }[variant] ?? 1);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, w, h);
  // Long, gently wavy grain running the length of the panel.
  const lines = Math.round(w / 6);
  for (let i = 0; i < lines; i++) {
    const x0 = rng(i * 3) * w;
    const dark = variant === 'weathered' ? (rng(i * 3 + 2) > 0.5 ? 25 : -10) : rng(i * 3 + 2) > 0.5 ? 22 : -8;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.bezierCurveTo(
      x0 + (rng(i * 5) - 0.5) * 10, h * 0.3,
      x0 + (rng(i * 5 + 1) - 0.5) * 10, h * 0.7,
      x0 + (rng(i * 5 + 2) - 0.5) * 8, h,
    );
    ctx.lineWidth = 1 + rng(i * 3 + 1) * 4;
    ctx.strokeStyle = css(r - dark, g - dark, b - dark);
    ctx.stroke();
  }
  if (variant === 'oak' || variant === 'cherry') {
    for (let k = 0; k < 2; k++) {
      const kx = w * (0.3 + 0.4 * rng(90 + k));
      const ky = h * (0.25 + 0.5 * rng(95 + k));
      for (let ring = 4; ring >= 0; ring--) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, 3 + ring * 3, 2 + ring * 2, 0.2, 0, Math.PI * 2);
        ctx.strokeStyle = css(r - ring * 8 - 20, g - ring * 8 - 20, b - ring * 8, 0.7);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
  if (variant === 'weathered') {
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(200,210,215,${0.05 + rng(i * 7 + 1) * 0.08})`;
      ctx.fillRect(0, rng(i * 7) * h, w, 1 + rng(i * 7 + 2) * 2);
    }
  }
}

function drawStone(ctx: CanvasRenderingContext2D, w: number, h: number, hex: string, variant = 'ash') {
  const { r, g, b } = rgb(hex);
  const rng = seeded({ ash: 1, shadow: 5, smoke: 9 }[variant] ?? 1);
  const mortarLift = variant === 'shadow' ? -25 : variant === 'smoke' ? -10 : -20;
  ctx.fillStyle = css(r + mortarLift, g + mortarLift, b + mortarLift);
  ctx.fillRect(0, 0, w, h);
  // Stacked stone: irregular courses, staggered, each stone shaded top-lit.
  const mortar = 2;
  let y = 0;
  for (let ci = 0; y < h; ci++) {
    const ch = Math.round(8 + rng(ci * 3) * 7);
    let x = ci % 2 === 1 ? -Math.round(rng(ci * 7) * 12) : 0;
    for (let si = 0; x < w + 20; si++) {
      const sw = Math.round(14 + rng(ci * 11 + si * 3) * 18);
      const sr = r + (rng(ci * 7 + si) - 0.5) * 30;
      const sg = g + (rng(ci * 7 + si + 1) - 0.5) * 20;
      const sb = b + (rng(ci * 7 + si + 2) - 0.5) * 20;
      const grad = ctx.createLinearGradient(x, y, x + sw, y + ch);
      grad.addColorStop(0, css(sr + 12, sg + 12, sb + 12));
      grad.addColorStop(0.4, css(sr, sg, sb));
      grad.addColorStop(1, css(sr - 18, sg - 18, sb - 18));
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, y + 1, sw - 2, ch - 1);
      ctx.fillStyle = css(sr + 25, sg + 25, sb + 25);
      ctx.fillRect(x + 1, y + 1, sw - 2, 1);
      x += sw + mortar;
    }
    y += ch + mortar;
  }
}

/** A cached, repeating texture for a wood- or stone-look print. */
export function finishTexture(finish: 'wood' | 'stone', hex: string, variant: string | undefined, repeatX: number, repeatY: number): THREE.Texture {
  const key = `finish:${finish}:${variant}:${hex}`;
  let base = cache.get(key);
  if (!base) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    if (finish === 'wood') drawWood(ctx, size, size, hex, variant);
    else drawStone(ctx, size, size, hex, variant);
    base = new THREE.CanvasTexture(canvas);
    base.wrapS = THREE.RepeatWrapping;
    base.wrapT = THREE.RepeatWrapping;
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = 8;
    cache.set(key, base);
  }
  const tex = base.clone();
  tex.needsUpdate = true;
  tex.repeat.set(Math.max(0.01, repeatX), Math.max(0.01, repeatY));
  return tex;
}

/** A small preview of a color as the panel actually looks, for swatches. */
export function swatchDataUrl(hex: string, finish?: string, variant?: string): string {
  const key = `swatch:${finish}:${variant}:${hex}`;
  const hit = swatchCache.get(key);
  if (hit) return hit;
  const w = 96;
  const h = 72;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (finish === 'wood') drawWood(ctx, w, h, hex, variant);
  else if (finish === 'stone') drawStone(ctx, w, h, hex, variant);
  else {
    // Three ribs lit from the upper left, the way the partner's chart shows them.
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, w, h);
    for (let p = 0; p < 3; p++) {
      const cx = (w * (1 + p * 2)) / 6;
      const crown = w * 0.035;
      const flank = w * 0.025;
      ctx.fillStyle = shade(hex, -0.1);
      ctx.fillRect(cx - crown / 2 - flank, 0, flank, h);
      ctx.fillStyle = shade(hex, 0.14);
      ctx.fillRect(cx - crown / 2, 0, crown, h);
      ctx.fillStyle = shade(hex, -0.04);
      ctx.fillRect(cx + crown / 2, 0, flank, h);
    }
  }
  const url = canvas.toDataURL();
  swatchCache.set(key, url);
  return url;
}
const swatchCache = new Map<string, string>();

function drawBoardBatten(ctx: CanvasRenderingContext2D, size: number, hex: string) {
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);
  const boards = 3;
  const step = size / boards;
  for (let i = 0; i < boards; i++) {
    const p = i * step;
    const w = Math.max(6, step * 0.12);
    ctx.fillStyle = shade(hex, -0.13);
    ctx.fillRect(p, 0, w, size);
    ctx.fillStyle = shade(hex, 0.12);
    ctx.fillRect(p + w, 0, w * 0.45, size);
  }
}

function drawLap(ctx: CanvasRenderingContext2D, size: number, hex: string) {
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);
  const courses = 4;
  const step = size / courses;
  for (let i = 0; i < courses; i++) {
    const y = i * step;
    const grad = ctx.createLinearGradient(0, y, 0, y + step);
    grad.addColorStop(0, shade(hex, -0.12));
    grad.addColorStop(0.18, shade(hex, 0.04));
    grad.addColorStop(1, shade(hex, -0.02));
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, size, step);
  }
}

function drawShingle(ctx: CanvasRenderingContext2D, size: number, hex: string) {
  ctx.fillStyle = shade(hex, -0.12);
  ctx.fillRect(0, 0, size, size);
  const rows = 5;
  const cols = 4;
  const h = size / rows;
  const w = size / cols;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : w / 2;
    for (let c = -1; c <= cols; c++) {
      const x = c * w + offset;
      const y = r * h;
      ctx.fillStyle = shade(hex, (r * 7 + c * 5) % 3 === 0 ? 0.05 : -0.01);
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    }
  }
}

function drawSmooth(ctx: CanvasRenderingContext2D, size: number, hex: string) {
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);
  // A faint grid of panel joints keeps large walls from looking like plastic.
  ctx.fillStyle = shade(hex, -0.07);
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, 0, 2, size);
}

/** A cached, repeating texture for one material kind and color. */
export function panelTexture(kind: TextureKind, hex: string, horizontal = false): THREE.Texture {
  const key = `${kind}:${hex}:${horizontal}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  switch (kind) {
    case 'ribbed':
      drawRibs(ctx, size, hex, horizontal);
      break;
    case 'board-batten':
      drawBoardBatten(ctx, size, hex);
      break;
    case 'lap':
      drawLap(ctx, size, hex);
      break;
    case 'shingle':
      drawShingle(ctx, size, hex);
      break;
    default:
      drawSmooth(ctx, size, hex);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/**
 * A repeat-adjusted clone. Clones share the source image, so this is cheap,
 * but each clone owns its repeat settings.
 */
export function tiled(kind: TextureKind, hex: string, repeatX: number, repeatY: number, horizontal = false): THREE.Texture {
  const tex = panelTexture(kind, hex, horizontal).clone();
  tex.needsUpdate = true;
  tex.repeat.set(Math.max(0.01, repeatX), Math.max(0.01, repeatY));
  return tex;
}

/** Ground texture: mown grass with a subtle mottle. */
export function groundTexture(): THREE.Texture {
  const key = 'ground';
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#7d9460';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const l = Math.random() * 0.1 - 0.05;
    ctx.fillStyle = shade('#7d9460', l);
    ctx.fillRect(x, y, 2 + Math.random() * 3, 1 + Math.random() * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(40, 40);
  cache.set(key, tex);
  return tex;
}

/**
 * Slab surfaces: concrete with control joints, asphalt, gravel, compacted
 * dirt, treated decking. One tile is 8' for poured surfaces and 4' for loose
 * ones; the caller sets the repeat.
 */
export function floorTexture(kind: 'concrete' | 'asphalt' | 'gravel' | 'dirt' | 'wood', hex: string): THREE.Texture {
  const key = `floor:${kind}:${hex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = seeded(kind.length * 17);
  const { r, g, b } = rgb(hex);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);

  if (kind === 'concrete') {
    for (let i = 0; i < 900; i++) {
      const v = (rng(i) - 0.5) * 40;
      ctx.fillStyle = css(r + v, g + v, b + v - 3);
      ctx.beginPath();
      ctx.arc(rng(i + 1000) * size, rng(i + 2000) * size, 1 + rng(i + 3000) * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Trowel streaks and a few hairline cracks.
    for (let i = 0; i < 20; i++) {
      ctx.strokeStyle = css(r + 6, g + 6, b + 6, 0.3);
      ctx.lineWidth = 0.8;
      const y = rng(i + 4000) * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = css(r - 70, g - 70, b - 70, 0.3);
      ctx.lineWidth = 0.6;
      let cx = rng(i + 5000) * size;
      let cy = rng(i + 6000) * size;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let j = 0; j < 8; j++) {
        cx += (rng(i * 10 + j + 7000) - 0.5) * 40;
        cy += (rng(i * 10 + j + 8000) - 0.5) * 40;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    // Saw-cut control joints at the tile edge.
    ctx.strokeStyle = css(r - 60, g - 60, b - 60, 0.55);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  } else if (kind === 'asphalt') {
    for (let i = 0; i < 1400; i++) {
      const v = 30 + rng(i) * 80;
      ctx.fillStyle = css(v, v, v);
      ctx.beginPath();
      ctx.arc(rng(i + 1000) * size, rng(i + 2000) * size, 0.5 + rng(i + 3000) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'gravel') {
    for (let i = 0; i < 1100; i++) {
      const v = (rng(i) - 0.5) * 80;
      ctx.save();
      ctx.translate(rng(i + 1000) * size, rng(i + 2000) * size);
      ctx.rotate(rng(i + 3000) * Math.PI);
      const rx = 3 + rng(i + 4000) * 7;
      const ry = 2 + rng(i + 5000) * 5;
      ctx.fillStyle = css(r + v, g + v * 0.95, b + v * 0.88);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
  } else if (kind === 'dirt') {
    for (let i = 0; i < 60; i++) {
      const v = (rng(i) - 0.5) * 40;
      ctx.fillStyle = css(r + v, g + v, b + v, 0.35);
      ctx.beginPath();
      ctx.arc(rng(i + 1000) * size, rng(i + 2000) * size, 10 + rng(i + 3000) * 50, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 300; i++) {
      const v = (rng(i + 9000) - 0.5) * 50;
      ctx.fillStyle = css(r + v, g + v * 0.85, b + v * 0.7);
      ctx.fillRect(rng(i + 4000) * size, rng(i + 5000) * size, 1 + rng(i + 6000) * 3, 1 + rng(i + 7000) * 3);
    }
  } else {
    // Decking boards, 6" wide, with staggered butt joints.
    const board = size / 16;
    for (let i = 0; i < 16; i++) {
      const v = (rng(i) - 0.5) * 24;
      ctx.fillStyle = css(r + v, g + v, b + v);
      ctx.fillRect(0, i * board, size, board - 2);
      ctx.fillStyle = css(r - 50, g - 50, b - 50, 0.6);
      ctx.fillRect(rng(i + 100) * size, i * board, 2, board - 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/** Bare galvalume — the unpainted underside of every panel, seen from inside. */
export function galvalumeTexture(): THREE.Texture {
  const key = 'galvalume';
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c8cdd2';
  ctx.fillRect(0, 0, size, size);
  // Spangle: faint blotches of lighter and darker zinc-aluminium crystal.
  const rng = seeded(4);
  for (let i = 0; i < 160; i++) {
    ctx.beginPath();
    ctx.arc(rng(i) * size, rng(i + 100) * size, 5 + rng(i + 200) * 9, 0, Math.PI * 2);
    const a = 0.015 + rng(i + 300) * 0.025;
    ctx.fillStyle = rng(i + 400) > 0.5 ? `rgba(255,255,255,${a})` : `rgba(100,110,120,${a})`;
    ctx.fill();
  }
  walkProfile(size, (p, lift) => {
    ctx.fillStyle = shade('#c8cdd2', lift * 0.8);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(p, 0, 1, size);
    ctx.globalAlpha = 1;
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Roughness that matches how glossy a finish looks. */
export function roughnessFor(metallic = 0.3): number {
  return THREE.MathUtils.clamp(0.85 - metallic * 0.45, 0.25, 0.95);
}
