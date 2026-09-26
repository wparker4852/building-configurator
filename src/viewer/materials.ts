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

function drawRibs(ctx: CanvasRenderingContext2D, size: number, hex: string, horizontal: boolean) {
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);

  // One "tile" of the texture is one panel width; draw a major seam plus
  // minor ribs, with a highlight and shadow on each so the profile reads.
  const ribs = 6;
  const step = size / ribs;
  for (let i = 0; i < ribs; i++) {
    const p = i * step;
    const major = i === 0;
    const w = major ? Math.max(3, step * 0.14) : Math.max(2, step * 0.09);

    ctx.fillStyle = shade(hex, major ? -0.16 : -0.1);
    if (horizontal) ctx.fillRect(0, p, size, w);
    else ctx.fillRect(p, 0, w, size);

    ctx.fillStyle = shade(hex, major ? 0.11 : 0.075);
    if (horizontal) ctx.fillRect(0, p + w, size, w * 0.7);
    else ctx.fillRect(p + w, 0, w * 0.7, size);
  }
}

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

/** Roughness that matches how glossy a finish looks. */
export function roughnessFor(metallic = 0.3): number {
  return THREE.MathUtils.clamp(0.85 - metallic * 0.45, 0.25, 0.95);
}
