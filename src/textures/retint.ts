import { Buffer } from "node:buffer";
import { parseHex } from "./colors.js";
import { decodePng } from "./pngDecode.js";
import { encodePng } from "./png.js";

export interface RetintOptions {
  primaryColorHex: string;
  secondaryColorHex?: string;
  glowing?: boolean;
  /**
   * Ore-style retint: blend the recolored pixel back toward the source by the
   * source's chroma. Neutral (stone) pixels stay nearly untouched; high-chroma
   * (ore fleck) pixels are fully recolored. Used for `_ore` block faces so the
   * stone background reads as stone after the swap.
   */
  oreMode?: boolean;
}

interface Hsl { h: number; s: number; l: number }

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rN = r / 255, gN = g / 255, bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rN) h = ((gN - bN) / d) + (gN < bN ? 6 : 0);
    else if (max === gN) h = ((bN - rN) / d) + 2;
    else h = ((rN - gN) / d) + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hh / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1) { r1 = c; g1 = x; }
  else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; }
  else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = l - c / 2;
  return {
    r: Math.max(0, Math.min(255, Math.round((r1 + m) * 255))),
    g: Math.max(0, Math.min(255, Math.round((g1 + m) * 255))),
    b: Math.max(0, Math.min(255, Math.round((b1 + m) * 255))),
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Continuous, luminance-preserving recolor.
 *
 * For every opaque source pixel:
 *   - convert to HSL
 *   - keep the source's lightness L (so shape, shading, edges, sparkle are intact)
 *   - swap the hue toward `primaryColorHex` and blend saturation between
 *     source and target so neutral source pixels stay mostly neutral and
 *     saturated source pixels become saturated in the new hue
 *   - if `secondaryColorHex` is provided, dark pixels mix toward that color
 *     so the user can shape the shadow tint
 *   - if `glowing`, biases L upward slightly
 *   - if `oreMode`, chroma-weighted blend with the source so low-chroma
 *     (stone) pixels stay nearly untouched
 *
 * Alpha is preserved exactly. The transformation is continuous — pixels are
 * never collapsed into a small set of bands, so a 16x16 source with N
 * distinct luminance levels keeps roughly N distinct output luminances.
 */
export function retintRgba(srcRgba: Uint8Array, opts: RetintOptions): Uint8Array {
  const primary = parseHex(opts.primaryColorHex);
  const secondary = opts.secondaryColorHex ? parseHex(opts.secondaryColorHex) : null;
  const glowing = opts.glowing ?? false;
  const oreMode = opts.oreMode ?? false;

  const tHsl = rgbToHsl(primary.r, primary.g, primary.b);
  const sHsl = secondary ? rgbToHsl(secondary.r, secondary.g, secondary.b) : null;

  const out = new Uint8Array(srcRgba.length);
  for (let i = 0; i < srcRgba.length; i += 4) {
    const a = srcRgba[i + 3]!;
    if (a === 0) {
      out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
      continue;
    }
    const sr = srcRgba[i]!, sg = srcRgba[i + 1]!, sb = srcRgba[i + 2]!;
    const src = rgbToHsl(sr, sg, sb);

    // -- Hue: swap to primary --
    const outH = tHsl.h;

    // -- Saturation: blend target with source's saturation profile so
    //    neutral source pixels stay relatively muted in the new hue and
    //    saturated source pixels become saturated. Even pure-grey targets
    //    (#000000, #808080) remain grey because tHsl.s is 0.
    const satMix = 0.4 + 0.6 * src.s;
    let outS = tHsl.s * satMix;

    // -- Lightness: preserve source L exactly. For glowing, lift L a touch
    //    in the highlight range so bright pixels read as glowing. Don't lift
    //    pure-black outline pixels — that would erase silhouettes.
    let outL = src.l;
    if (glowing) outL = Math.min(1, outL + (1 - outL) * 0.25 * src.l);

    // -- Convert primary tint --
    let { r, g, b } = hslToRgb(outH, outS, outL);

    // -- Secondary tint at the dark end. Mix toward secondary's color in the
    //    L < 0.45 range so users can shape shadow chroma without eating
    //    luminance. The mix curve is smooth so we don't introduce a band.
    if (sHsl) {
      const w = smoothstep(0.45, 0.05, src.l); // 1 at L=0.05, 0 at L≥0.45
      if (w > 0) {
        // Compute the secondary-hue tint at this pixel's L (preserving
        // luminance) and lerp.
        const sec = hslToRgb(sHsl.h, sHsl.s * satMix, outL);
        r = Math.round(r * (1 - w) + sec.r * w);
        g = Math.round(g * (1 - w) + sec.g * w);
        b = Math.round(b * (1 - w) + sec.b * w);
      }
    }

    // -- Ore mode: blend back toward source by chroma. Neutral pixels (stone)
    //    keep their original color; saturated pixels (ore flecks) get fully
    //    recolored. Smoothstep avoids a hard threshold.
    if (oreMode) {
      const chroma = (Math.max(sr, sg, sb) - Math.min(sr, sg, sb)) / 255;
      // chroma 0.06 → 0 (stone-grey), chroma 0.22 → 1 (ore fleck)
      const w = smoothstep(0.06, 0.22, chroma);
      r = Math.round(sr * (1 - w) + r * w);
      g = Math.round(sg * (1 - w) + g * w);
      b = Math.round(sb * (1 - w) + b * w);
    }

    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }
  return out;
}

/**
 * Decode a source PNG, retint it, and return a re-encoded PNG.
 * Throws on bad PNG input — callers fall back to procedural generation.
 */
export function retintPng(srcPng: Buffer, opts: RetintOptions): Buffer {
  const decoded = decodePng(srcPng);
  const tinted = retintRgba(decoded.rgba, opts);
  return encodePng(decoded.width, decoded.height, tinted);
}
