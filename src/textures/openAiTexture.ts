import { Buffer } from "node:buffer";
import { decodePng } from "./pngDecode.js";
import { encodePng } from "./png.js";
import type { ModFeature, ModSpec } from "../types.js";

/**
 * Optional OpenAI-image-API source for custom item/weapon/tool textures.
 *
 * Only used when BOTH env vars are set:
 *   - OPENAI_API_KEY=<key>
 *   - MODFORGE_AI_TEXTURES=1
 *
 * Vanilla retextures never call this — they always go through the
 * MODFORGE_VANILLA_ASSETS_DIR retint pipeline.
 *
 * The OpenAI call is isolated: the provider only returns image bytes, and
 * the calling generator decides the file path. Prompt output never names
 * a file or directory.
 */

/** Raw provider contract — returns the API's PNG bytes, or null on failure. */
export type AiTextureProvider = (
  prompt: string,
  signal: AbortSignal,
) => Promise<Buffer | null>;

const AI_REQUEST_TIMEOUT_MS = 60_000;
const TARGET_SIZE = 16;

let providerOverride: AiTextureProvider | null = null;

/** Test seam: install a mock provider. Pass `null` to clear. */
export function setAiTextureProvider(p: AiTextureProvider | null): void {
  providerOverride = p;
}

export function aiTexturesEnabled(): boolean {
  return (
    process.env.MODFORGE_AI_TEXTURES === "1" &&
    typeof process.env.OPENAI_API_KEY === "string" &&
    process.env.OPENAI_API_KEY.length > 0
  );
}

/** True when MODFORGE_AI_DEBUG=1 — enables [AI texture] tracing. */
export function aiDebugEnabled(): boolean {
  return process.env.MODFORGE_AI_DEBUG === "1";
}

/**
 * Safe debug logger. Logs are gated on MODFORGE_AI_DEBUG=1 and never include
 * the API key or any header value. Prompts, feature ids, HTTP status codes,
 * and rejection reasons are safe to surface.
 */
function debugLog(message: string): void {
  if (!aiDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[AI texture] ${message}`);
}

/** One-line reason for `aiTexturesEnabled() === false`, never naming the key. */
function disabledReason(): string {
  if (process.env.MODFORGE_AI_TEXTURES !== "1") {
    return "MODFORGE_AI_TEXTURES is not set to 1";
  }
  const key = process.env.OPENAI_API_KEY;
  if (typeof key !== "string" || key.length === 0) {
    return "OPENAI_API_KEY is not set";
  }
  return "unknown";
}

/**
 * Default provider — calls the OpenAI Images API and returns PNG bytes.
 * Fully gated on env vars; never throws; returns null on any failure.
 *
 * Debug logging (MODFORGE_AI_DEBUG=1) reports the HTTP status code and
 * any safe failure reason. The API key is NEVER logged.
 */
const defaultProvider: AiTextureProvider = async (prompt, signal) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    debugLog("default provider: OPENAI_API_KEY missing — returning null");
    return null;
  }
  try {
    debugLog(`default provider: POST https://api.openai.com/v1/images/generations (model=gpt-image-1, size=1024x1024, prompt length=${prompt.length})`);
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
        n: 1,
        background: "transparent",
        output_format: "png",
      }),
    });
    debugLog(`default provider: HTTP ${res.status}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || b64.length === 0) {
      debugLog("default provider: response missing data[0].b64_json");
      return null;
    }
    return Buffer.from(b64, "base64");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (signal.aborted) {
      debugLog(`default provider: aborted (timeout after ${AI_REQUEST_TIMEOUT_MS}ms)`);
    } else {
      debugLog(`default provider: fetch threw — ${reason}`);
    }
    return null;
  }
};

/** Detailed result — the variant precompute uses internally so it can
 *  surface a per-feature reason in the README's Limitations section. */
export type AiTextureResult =
  | { ok: true; png: Buffer }
  | { ok: false; reason: string };

/**
 * Generate a 16x16 PNG via the AI provider, downsampled and validated.
 * Returns null when the AI path is disabled, the provider fails, or the
 * returned image fails validation. Callers fall back to procedural.
 *
 * Kept returning Buffer | null for stability; precompute uses the detailed
 * `generateAiTextureDetailed` so it can surface a reason.
 */
export async function generateAiTexture(prompt: string): Promise<Buffer | null> {
  const r = await generateAiTextureDetailed(prompt);
  return r.ok ? r.png : null;
}

export async function generateAiTextureDetailed(
  prompt: string,
): Promise<AiTextureResult> {
  if (!aiTexturesEnabled()) {
    return { ok: false, reason: `AI disabled (${disabledReason()})` };
  }
  const provider = providerOverride ?? defaultProvider;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AI_REQUEST_TIMEOUT_MS);
  let raw: Buffer | null;
  try {
    raw = await provider(prompt, ac.signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    debugLog(`provider threw: ${msg}`);
    return { ok: false, reason: `provider threw: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
  if (!raw) {
    if (ac.signal.aborted) {
      return { ok: false, reason: `provider timed out after ${AI_REQUEST_TIMEOUT_MS}ms` };
    }
    return { ok: false, reason: "provider returned no image" };
  }
  return postProcessAiImage(raw);
}

/**
 * Decode raw PNG bytes from the provider, downsample to 16x16, ensure an
 * alpha channel (chroma-key the corner color when fully opaque), and validate
 * that the result is a usable item icon (not empty, not a full square).
 *
 * Returns the re-encoded 16x16 PNG bytes on success, null on any failure.
 *
 * Exported for unit tests so we can validate the post-processing path
 * without involving the network at all.
 */
export function postProcessAiImage(raw: Buffer): AiTextureResult {
  let decoded: { width: number; height: number; rgba: Uint8Array };
  try {
    decoded = decodePng(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    debugLog(`post-processing rejected: PNG decode failed — ${msg}`);
    return { ok: false, reason: `PNG decode failed: ${msg}` };
  }
  const { width, height } = decoded;
  if (width <= 0 || height <= 0) {
    return { ok: false, reason: `invalid dimensions ${width}x${height}` };
  }

  // Defensive copy — chroma-keyCorners and recovery passes mutate.
  let rgba = new Uint8Array(decoded.rgba);

  // If the source has no alpha at all, the provider ignored `background:
  // transparent`. Reject obvious flat fills, otherwise chroma-key the modal
  // corner color so subsequent bbox + downsample have a real silhouette.
  if (!hasTransparentPixels(rgba)) {
    if (isMonochromaticFlat(rgba)) {
      return { ok: false, reason: "image is a full square (uniform fill — silhouette missing)" };
    }
    chromaKeyCorners(rgba, width, height);
  }

  // ---- Pass 1: pad to square + resample (no aggressive cropping). Works
  //      for AI outputs that already fill the canvas reasonably well. ----
  const passA = padAndResample(rgba, width, height, /*cropTight*/ false);
  const validA = passA ? validateIcon(passA) : { ok: false as const, reason: "no opaque pixels in pass 1" };
  if (passA && validA.ok) {
    return { ok: true, png: encodePng(TARGET_SIZE, TARGET_SIZE, pixelCleanIcon(passA)) };
  }

  // ---- Pass 2 (recovery): only if pass 1 was sparse/empty. Crop to the
  //      alpha bounding box (with a small margin), pad to square, and
  //      resample. This rescues thin / centered subjects that lost too
  //      many pixels under the global resample. ----
  const sparseRejection =
    !validA.ok && /too empty|too sparse|no opaque/i.test(validA.reason);
  if (!sparseRejection) {
    debugLog(`post-processing rejected: ${(validA as { reason: string }).reason}`);
    return { ok: false, reason: (validA as { reason: string }).reason };
  }

  debugLog("post-processing recovery: bbox-cropping + re-resampling");
  const passB = padAndResample(rgba, width, height, /*cropTight*/ true);
  if (!passB) {
    // Either no opaque pixels at all, or the alpha bounding box was too
    // small (< 5px on its longest axis) to be a meaningful icon.
    return { ok: false, reason: validA.reason };
  }
  const validB = validateIcon(passB);
  if (validB.ok) {
    return { ok: true, png: encodePng(TARGET_SIZE, TARGET_SIZE, pixelCleanIcon(passB)) };
  }
  debugLog(`post-processing rejected (after recovery): ${validB.reason}`);
  return { ok: false, reason: validB.reason };
}

/**
 * Pixel-art cleanup for a 16x16 RGBA buffer fresh out of resampleMaxAlpha.
 *
 * Steps (in order):
 *   1. Alpha snap: <64 → 0, ≥64 → 255 (no semi-transparent pixels)
 *   2. Remove isolated single-pixel noise via 8-connected components
 *   3. Quantize the opaque palette to ≤ MAX_PALETTE colors (median cut)
 *   4. Darken outline pixels for sharper silhouette edge
 *
 * Output is byte-stable for the same input — safe to run inside the
 * deterministic post-processing path.
 */
export function pixelCleanIcon(rgba: Uint8Array): Uint8Array {
  const W = TARGET_SIZE, H = TARGET_SIZE;
  const out = new Uint8Array(rgba);

  // 1. Alpha snap.
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]!;
    if (a < 64) {
      out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
    } else {
      out[i + 3] = 255;
    }
  }

  // 2. Drop 8-connected components of size 1 — that's the precise definition
  //    of "isolated noise pixel" the spec calls out. Diagonal weapon lines
  //    have 8-neighbor opaque pixels along their length, so they survive.
  removeIsolatedNoise(out, W, H);

  // 3. Edge contrast: darken outline pixels (skip the brightest quartile so
  //    we don't crush highlights on a polished blade). Runs BEFORE quantize
  //    so the darkened edge variants get folded into the final palette.
  applyEdgeContrast(out, W, H);

  // 4. Quantize opaque palette to ≤ MAX_PALETTE colors so the icon reads as
  //    pixel art instead of soft AI gradients. Last so the palette is the
  //    final authority on output colours.
  quantizeIconColors(out, MAX_PALETTE);

  return out;
}

const MAX_PALETTE = 12;
const EDGE_DARKEN_FACTOR = 0.78;

function removeIsolatedNoise(rgba: Uint8Array, W: number, H: number): void {
  // Label every opaque pixel with its 8-connected component id, then drop
  // components of size 1.
  const labels = new Int16Array(W * H).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const start = y * W + x;
      if (rgba[start * 4 + 3] === 0 || labels[start] !== -1) continue;
      const id = sizes.length;
      sizes.push(0);
      stack.length = 0;
      stack.push(start);
      labels[start] = id;
      while (stack.length > 0) {
        const p = stack.pop()!;
        sizes[id] = (sizes[id] ?? 0) + 1;
        const px = p % W;
        const py = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx, ny = py + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const ni = ny * W + nx;
            if (labels[ni] !== -1) continue;
            if (rgba[ni * 4 + 3] === 0) continue;
            labels[ni] = id;
            stack.push(ni);
          }
        }
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const id = labels[i]!;
    if (id >= 0 && sizes[id] === 1) {
      const j = i * 4;
      rgba[j] = 0; rgba[j + 1] = 0; rgba[j + 2] = 0; rgba[j + 3] = 0;
    }
  }
}

/** Median-cut palette reduction restricted to opaque pixels of `rgba`. */
function quantizeIconColors(rgba: Uint8Array, k: number): void {
  const colors: Array<[number, number, number]> = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 255) {
      colors.push([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]);
    }
  }
  if (colors.length === 0) return;
  // Already few colors? Skip.
  const uniqueKeys = new Set(colors.map((c) => `${c[0]},${c[1]},${c[2]}`));
  if (uniqueKeys.size <= k) return;

  let buckets: Array<Array<[number, number, number]>> = [colors];
  while (buckets.length < k) {
    let bestIdx = -1, bestRange = -1, bestChan = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]!;
      if (b.length < 2) continue;
      let mn0 = 255, mx0 = 0, mn1 = 255, mx1 = 0, mn2 = 255, mx2 = 0;
      for (const c of b) {
        if (c[0] < mn0) mn0 = c[0]; if (c[0] > mx0) mx0 = c[0];
        if (c[1] < mn1) mn1 = c[1]; if (c[1] > mx1) mx1 = c[1];
        if (c[2] < mn2) mn2 = c[2]; if (c[2] > mx2) mx2 = c[2];
      }
      const r0 = mx0 - mn0, r1 = mx1 - mn1, r2 = mx2 - mn2;
      const r = Math.max(r0, r1, r2);
      if (r > bestRange) {
        bestRange = r;
        bestIdx = i;
        bestChan = r === r0 ? 0 : r === r1 ? 1 : 2;
      }
    }
    if (bestIdx < 0) break;
    const b = buckets[bestIdx]!;
    b.sort((a, c) => (a[bestChan] ?? 0) - (c[bestChan] ?? 0));
    const mid = Math.floor(b.length / 2);
    buckets[bestIdx] = b.slice(0, mid);
    buckets.push(b.slice(mid));
  }

  const palette: Array<[number, number, number]> = buckets.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const c of b) { r += c[0]; g += c[1]; bl += c[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)];
  });

  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 255) continue;
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    let bestD = Infinity, bestP: [number, number, number] = palette[0]!;
    for (const p of palette) {
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; bestP = p; }
    }
    rgba[i] = bestP[0]; rgba[i + 1] = bestP[1]; rgba[i + 2] = bestP[2];
  }
}

function applyEdgeContrast(rgba: Uint8Array, W: number, H: number): void {
  const lums: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 255) {
      lums.push(0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!);
    }
  }
  if (lums.length === 0) return;
  lums.sort((a, b) => a - b);
  const highlightThresh = lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.75))]!;
  const orig = new Uint8Array(rgba);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (orig[i + 3] !== 255) continue;
      const onEdge =
        (y === 0 || orig[((y - 1) * W + x) * 4 + 3] !== 255) ||
        (y === H - 1 || orig[((y + 1) * W + x) * 4 + 3] !== 255) ||
        (x === 0 || orig[(y * W + (x - 1)) * 4 + 3] !== 255) ||
        (x === W - 1 || orig[(y * W + (x + 1)) * 4 + 3] !== 255);
      if (!onEdge) continue;
      const lum = 0.299 * orig[i]! + 0.587 * orig[i + 1]! + 0.114 * orig[i + 2]!;
      if (lum > highlightThresh) continue;
      rgba[i] = Math.max(0, Math.round(orig[i]! * EDGE_DARKEN_FACTOR));
      rgba[i + 1] = Math.max(0, Math.round(orig[i + 1]! * EDGE_DARKEN_FACTOR));
      rgba[i + 2] = Math.max(0, Math.round(orig[i + 2]! * EDGE_DARKEN_FACTOR));
    }
  }
}

interface Bbox { x0: number; y0: number; x1: number; y1: number }

function findAlphaBbox(rgba: Uint8Array, w: number, h: number): Bbox | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3]!;
      if (a >= 16) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1 };
}

const BBOX_MARGIN_PCT = 0.15;

/**
 * Optionally crop to the alpha bounding box (with a small transparent
 * margin), pad to square, then resample to TARGET_SIZE × TARGET_SIZE using
 * max-alpha pooling — preserves thin diagonal silhouettes better than
 * nearest-neighbor at the center of each cell.
 */
function padAndResample(
  rgba: Uint8Array,
  w: number,
  h: number,
  cropTight: boolean,
): Uint8Array | null {
  let src = rgba, sw = w, sh = h;

  if (cropTight) {
    const bbox = findAlphaBbox(src, sw, sh);
    if (!bbox) return null;
    const cw = bbox.x1 - bbox.x0 + 1;
    const ch = bbox.y1 - bbox.y0 + 1;
    // Don't try to rescue a tiny cluster — upscaling 2x2 → 16x16 invents
    // detail that wasn't there. The validator would happily accept the
    // resulting saturated patch.
    if (Math.max(cw, ch) < 5) return null;
    const mx = Math.max(1, Math.round(cw * BBOX_MARGIN_PCT));
    const my = Math.max(1, Math.round(ch * BBOX_MARGIN_PCT));
    const cx0 = Math.max(0, bbox.x0 - mx);
    const cy0 = Math.max(0, bbox.y0 - my);
    const cx1 = Math.min(sw - 1, bbox.x1 + mx);
    const cy1 = Math.min(sh - 1, bbox.y1 + my);
    const cw2 = cx1 - cx0 + 1;
    const ch2 = cy1 - cy0 + 1;
    const cropped = new Uint8Array(cw2 * ch2 * 4);
    for (let y = 0; y < ch2; y++) {
      for (let x = 0; x < cw2; x++) {
        const si = ((y + cy0) * sw + (x + cx0)) * 4;
        const di = (y * cw2 + x) * 4;
        cropped[di] = src[si]!;
        cropped[di + 1] = src[si + 1]!;
        cropped[di + 2] = src[si + 2]!;
        cropped[di + 3] = src[si + 3]!;
      }
    }
    src = cropped; sw = cw2; sh = ch2;
  }

  if (sw !== sh) {
    const side = Math.max(sw, sh);
    const padded = new Uint8Array(side * side * 4);
    const ox = Math.floor((side - sw) / 2);
    const oy = Math.floor((side - sh) / 2);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const si = (y * sw + x) * 4;
        const di = ((y + oy) * side + (x + ox)) * 4;
        padded[di] = src[si]!;
        padded[di + 1] = src[si + 1]!;
        padded[di + 2] = src[si + 2]!;
        padded[di + 3] = src[si + 3]!;
      }
    }
    src = padded; sw = side; sh = side;
  }

  return resampleMaxAlpha(src, sw, sh, TARGET_SIZE, TARGET_SIZE);
}

/**
 * Resample to (dstW × dstH) using max-alpha pooling on the source cell.
 * Handles both upscaling (when src < dst) and downscaling (when src > dst)
 * — output pixel takes the *most opaque* source pixel within its cell, so
 * thin features survive aggressive downsamples.
 */
function resampleMaxAlpha(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor((y * srcH) / dstH);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor((x * srcW) / dstW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * srcW) / dstW));
      let bestA = -1, bestI = -1;
      for (let sy = sy0; sy < Math.min(srcH, sy1); sy++) {
        for (let sx = sx0; sx < Math.min(srcW, sx1); sx++) {
          const i = (sy * srcW + sx) * 4;
          const a = src[i + 3]!;
          if (a > bestA) { bestA = a; bestI = i; }
        }
      }
      const di = (y * dstW + x) * 4;
      if (bestI >= 0) {
        out[di] = src[bestI]!;
        out[di + 1] = src[bestI + 1]!;
        out[di + 2] = src[bestI + 2]!;
        out[di + 3] = src[bestI + 3]!;
      }
      // else: leaves alpha=0 (transparent)
    }
  }
  return out;
}

function hasTransparentPixels(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i]! < 255) return true;
  }
  return false;
}

/** True when 95%+ of pixels share roughly the same RGB — a flat fill. */
function isMonochromaticFlat(rgba: Uint8Array): boolean {
  const total = rgba.length / 4;
  if (total === 0) return false;
  const r0 = rgba[0]!, g0 = rgba[1]!, b0 = rgba[2]!;
  let same = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (
      Math.abs(rgba[i]! - r0) <= 8 &&
      Math.abs(rgba[i + 1]! - g0) <= 8 &&
      Math.abs(rgba[i + 2]! - b0) <= 8
    ) same++;
  }
  return same >= Math.floor(total * 0.95);
}

/**
 * Pick the most common corner color and clear matching pixels to alpha=0.
 * Cheap fallback for providers that ignore `background: transparent`.
 */
function chromaKeyCorners(rgba: Uint8Array, w: number, h: number): void {
  const corners: Array<[number, number]> = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
  ];
  const tally = new Map<string, number>();
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [k, v] of tally) {
    if (v > bestCount) { best = k; bestCount = v; }
  }
  if (!best) return;
  const [br, bg, bb] = best.split(",").map((s) => Number(s));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (
        Math.abs(rgba[i]! - br!) <= 12 &&
        Math.abs(rgba[i + 1]! - bg!) <= 12 &&
        Math.abs(rgba[i + 2]! - bb!) <= 12
      ) {
        rgba[i + 3] = 0;
      }
    }
  }
}

/**
 * Bbox-aware validation: a thin diagonal weapon (a katana running corner-to-
 * corner) may have only ~14 opaque pixels but still read as a clear icon
 * because of its spatial extent. A 3-pixel dot cluster has the same opaque
 * count but no extent and must be rejected.
 *
 * Rules (on a 16x16 = 256 pixel canvas):
 *   - reject if opaque ≥ 94% (full block-fill, silhouette missing)
 *   - reject if opaque < 8 (tiny — even a corner-to-corner thin diagonal is ≥14)
 *   - accept if opaque ≥ 30 (regular icon)
 *   - accept if opaque ≥ 12 AND (max(spanW, spanH) ≥ 10 OR spanW + spanH ≥ 18)
 *     — sparse-but-elongated, e.g. a thin katana
 *   - else reject as too sparse
 */
function validateIcon(rgba: Uint8Array): { ok: true } | { ok: false; reason: string } {
  let opaque = 0;
  let x0 = TARGET_SIZE, y0 = TARGET_SIZE, x1 = -1, y1 = -1;
  for (let y = 0; y < TARGET_SIZE; y++) {
    for (let x = 0; x < TARGET_SIZE; x++) {
      const a = rgba[(y * TARGET_SIZE + x) * 4 + 3]!;
      if (a >= 16) {
        opaque++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  const total = TARGET_SIZE * TARGET_SIZE;
  if (opaque > Math.floor(total * 0.94)) {
    return { ok: false, reason: `image is a full square (${opaque}/${total} opaque pixels — silhouette missing)` };
  }
  if (opaque < 8) {
    return { ok: false, reason: `image too empty (only ${opaque}/${total} opaque pixels)` };
  }
  const spanW = x1 - x0 + 1;
  const spanH = y1 - y0 + 1;
  const maxSpan = Math.max(spanW, spanH);
  const sumSpan = spanW + spanH;
  if (opaque >= 30) return { ok: true };
  if (opaque >= 12 && (maxSpan >= 10 || sumSpan >= 18)) return { ok: true };
  return {
    ok: false,
    reason: `image too sparse (${opaque} opaque pixels in a ${spanW}x${spanH} bbox)`,
  };
}

/**
 * Build the OpenAI prompt for a custom item/weapon/tool feature. Pure — no
 * I/O — so it's straightforward to unit-test.
 */
export function buildPromptForFeature(
  spec: ModSpec,
  feature: ModFeature,
): string {
  const baseHeader =
    "Create a single Minecraft style pixel art item icon. " +
    "Transparent background. 16-bit pixel art. " +
    "Fill most of the canvas while staying centered. " +
    "Clear readable silhouette at 16x16. " +
    "No text. No UI. Single object only.";

  if (feature.type === "weapon" || feature.type === "tool") {
    const wt =
      "details" in feature && (feature.details as { weaponType?: string }).weaponType;
    if (wt === "katana") {
      return (
        "Create a single Minecraft style pixel art item icon of a katana. " +
        "Transparent background. 16-bit pixel art. " +
        "Long thin blade, sharp tip, small guard, wrapped handle. " +
        "Fill most of the canvas while staying centered. " +
        "Clear readable silhouette at 16x16. " +
        "Make the blade thicker than a single pixel line. " +
        "No text. No UI."
      );
    }
    if (wt === "hammer" || wt === "mace" || wt === "club") {
      return (
        "Create a single Minecraft style pixel art item icon of a war hammer. " +
        "Transparent background. 16-bit pixel art. " +
        "Chunky hammer head, short handle, readable silhouette. " +
        "Fill most of the canvas while staying centered. " +
        "Clear readable silhouette at 16x16. " +
        "No text. No UI."
      );
    }
    const obj = wt && wt !== "custom-melee" ? wt : "sword";
    const desc = describeFeature(feature);
    return `${baseHeader} Subject: a ${obj}. ${desc}`.trim();
  }

  if (feature.type === "item") {
    return `${baseHeader} Subject: ${feature.name || feature.id}. ${describeFeature(feature)}`.trim();
  }

  // Other feature types should not call this, but produce a safe default.
  return `${baseHeader} Subject: ${feature.name || feature.id}.`;
  void spec;
}

function describeFeature(feature: ModFeature): string {
  const parts: string[] = [];
  if ("description" in feature && feature.description) parts.push(feature.description);
  const details = (feature as { details?: Record<string, unknown> }).details ?? {};
  const style = details["textureStyle"];
  if (typeof style === "string") parts.push(`Style: ${style}.`);
  const color = details["textureColor"];
  if (typeof color === "string") parts.push(`Primary color: ${color}.`);
  const secondary = details["secondaryColor"];
  if (typeof secondary === "string") parts.push(`Accent color: ${secondary}.`);
  return parts.join(" ");
}

/**
 * For each custom item/weapon/tool in the spec, attempt an AI texture and
 * return a map keyed by feature.id. Vanilla retextures and other types are
 * never touched (and never appear in debug logs as AI candidates).
 *
 * Failures carry a safe per-feature reason so the orchestrator can surface
 * a clear notice in the generated README's Limitations section.
 */
export async function precomputeAiTextures(spec: ModSpec): Promise<{
  textures: Map<string, Buffer>;
  failures: Array<{ id: string; reason: string }>;
}> {
  const textures = new Map<string, Buffer>();
  const failures: Array<{ id: string; reason: string }> = [];

  const enabled = aiTexturesEnabled();
  debugLog(`enabled: ${enabled}${enabled ? "" : ` (${disabledReason()})`}`);
  if (!enabled) return { textures, failures };

  for (const feature of spec.features) {
    debugLog(`feature considered: id="${feature.id}" type="${feature.type}"`);
    const eligible =
      feature.type === "item" || feature.type === "weapon" || feature.type === "tool";
    if (!eligible) {
      debugLog(`feature "${feature.id}" skipped: type "${feature.type}" is not eligible for AI textures`);
      continue;
    }

    const prompt = buildPromptForFeature(spec, feature);
    debugLog(`feature "${feature.id}" eligible — prompt: ${JSON.stringify(prompt)}`);

    const result = await generateAiTextureDetailed(prompt);
    if (result.ok) {
      debugLog(`feature "${feature.id}": post-processing accepted — using AI texture`);
      textures.set(feature.id, result.png);
    } else {
      debugLog(`feature "${feature.id}": ${result.reason} — using deterministic fallback`);
      failures.push({ id: feature.id, reason: result.reason });
    }
  }
  return { textures, failures };
}
