import { DIRT, mix, shade, WHITE, type Color } from "./colors.js";
import { getMask, silhouetteForStyle, type Silhouette } from "./silhouettes.js";

export type TextureStyle =
  | "plain"
  | "gem"
  | "crystal"
  | "metal"
  | "stone"
  | "grass";

export type FaceMode = "top" | "side" | "bottom" | "item" | "all";

export interface PaintOptions {
  primary: Color;
  secondary?: Color;
  glowing?: boolean;
  /** Item rendering uses a silhouette + transparent background; block faces tile. */
  faceMode?: FaceMode;
  /** Per-face noise variation. */
  salt?: number;
  /**
   * Override the silhouette used for `faceMode === "item"`. If unspecified,
   * derived from the style. The retexture generator uses this to force a
   * diamond shape on `minecraft:diamond` regardless of the chosen style.
   */
  silhouette?: Silhouette;
}

const SIZE = 16;

class Canvas {
  rgba = new Uint8Array(SIZE * SIZE * 4);
  fill(c: Color): void {
    for (let i = 0; i < SIZE * SIZE; i++) {
      this.rgba[i * 4] = c.r;
      this.rgba[i * 4 + 1] = c.g;
      this.rgba[i * 4 + 2] = c.b;
      this.rgba[i * 4 + 3] = c.a ?? 255;
    }
  }
  set(x: number, y: number, c: Color): void {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    this.rgba[i] = c.r;
    this.rgba[i + 1] = c.g;
    this.rgba[i + 2] = c.b;
    this.rgba[i + 3] = c.a ?? 255;
  }
  alpha(x: number, y: number): number {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return 0;
    return this.rgba[(y * SIZE + x) * 4 + 3]!;
  }
}

function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function seedFrom(c: Color, salt: number): number {
  return (((c.r << 16) ^ (c.g << 8) ^ c.b ^ (salt * 9747)) | 0) >>> 0;
}

/**
 * Render a 16x16 RGBA byte array. Output is fully deterministic for a given
 * (style, primary, secondary, salt, faceMode, silhouette).
 *
 *   - `faceMode === "item"` produces a pixel-art silhouette with transparent
 *     corners (gem/diamond, crystal shard, ingot, or generic chamfered square).
 *   - Other face modes produce a fully-tiled 16x16 block face.
 */
export function paint(style: TextureStyle, opts: PaintOptions): Uint8Array {
  const cv = new Canvas();
  const primary = opts.primary;
  const secondary = opts.secondary ?? shade(primary, -0.4);
  const r = rng(seedFrom(primary, opts.salt ?? 0));
  const glowing = opts.glowing ?? false;
  const face = opts.faceMode ?? "item";

  if (face === "item") {
    const sil = opts.silhouette ?? silhouetteForStyle(style);
    paintItem(cv, sil, style, primary, secondary, glowing, r);
    return cv.rgba;
  }

  // Block-face painting (existing behavior, lightly polished).
  switch (style) {
    case "plain":
      paintPlain(cv, primary, secondary);
      break;
    case "gem":
      paintGemBlock(cv, primary, secondary, r, glowing);
      break;
    case "crystal":
      paintCrystalBlock(cv, primary, secondary, r, glowing);
      break;
    case "metal":
      paintMetalBlock(cv, primary, secondary, r);
      break;
    case "stone":
      paintStoneBlock(cv, primary, secondary, r);
      break;
    case "grass":
      paintGrass(cv, primary, secondary, r, face);
      break;
  }
  return cv.rgba;
}

// ============================================================================
// Item silhouette painter
// ============================================================================

/**
 * Item painter (Milestone 3.7-patch): luminance-preserving 4-tone retint.
 *
 * For every silhouette pixel, classify into four luminance bands based on
 * geometry — outline / upper-left highlight ring / lower-right shadow ring /
 * deep interior — and map each band to one of four colors derived from
 * primary (+ optional secondary). This produces clean Minecraft-style
 * "lit from upper-left" pixel art shading where a sword reads as a sword
 * and the silhouette stays sharp regardless of style.
 *
 * NOTE on vanilla asset reuse: ideally we'd read the actual vanilla
 * textures/item/<x>.png from the user's Minecraft install (e.g. via the
 * `MODFORGE_VANILLA_ASSETS_DIR` env hook documented in the README) and
 * recolor those byte-for-byte while preserving alpha. We can't redistribute
 * Mojang's PNGs, and stdlib Node has no PNG decoder, so the curated
 * silhouettes below act as the procedural fallback. Same shape category
 * (sword, pickaxe, etc.), same shading ring pattern.
 */
function paintItem(
  cv: Canvas,
  silhouette: Silhouette,
  style: TextureStyle,
  primary: Color,
  secondary: Color,
  glowing: boolean,
  _r: () => number,
): void {
  const mask = getMask(silhouette);

  const outline = shade(primary, -0.6);   // luminance 0
  const shadow = shade(primary, -0.3);    // luminance 1 (used if no secondary)
  const shadowColor = secondary ?? shadow; // shadow ring honors secondary
  const highlight = shade(primary, 0.45); // luminance 3
  const bright = shade(primary, 0.65);

  const isInside = (y: number, x: number): boolean =>
    y >= 0 && y < SIZE && x >= 0 && x < SIZE && (mask[y]?.[x] ?? false);

  const isOutlinePixel = (y: number, x: number): boolean => {
    if (!isInside(y, x)) return false;
    return !isInside(y - 1, x) || !isInside(y + 1, x) ||
           !isInside(y, x - 1) || !isInside(y, x + 1);
  };

  // Single pass: classify every silhouette pixel into one of four luminance
  // bands and stamp the corresponding color. Transparent pixels stay alpha=0.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!mask[y]?.[x]) continue;

      // Band 0: dark outline.
      if (isOutlinePixel(y, x)) {
        cv.set(x, y, outline);
        continue;
      }

      // Interior. Highlight ring = pixel is just inside the upper-or-left
      // outline. Shadow ring = pixel is just inside the lower-or-right outline.
      const upperRing = isOutlinePixel(y - 1, x) || isOutlinePixel(y, x - 1);
      const lowerRing = isOutlinePixel(y + 1, x) || isOutlinePixel(y, x + 1);

      if (upperRing) {
        cv.set(x, y, highlight);            // band 3
      } else if (lowerRing) {
        cv.set(x, y, shadowColor);          // band 1 (secondary if provided)
      } else {
        cv.set(x, y, primary);              // band 2: deep interior
      }
    }
  }

  // 1-pixel sparkle in the upper-left interior. White for gems/crystals,
  // a brighter shade of primary for everything else — keeps the readable
  // Minecraft "tiny highlight pixel" cue without overpowering the silhouette.
  addSparkle(cv, mask, style === "gem" || style === "crystal" ? WHITE : bright);

  // Glow halo: 1-pixel translucent ring around the silhouette.
  if (glowing) addGlowHalo(cv, mask, shade(primary, 0.45));

  void mix;
  void DIRT;
}

function addGemFacets(
  cv: Canvas,
  mask: boolean[][],
  _primary: Color,
  highlight: Color,
  secondary: Color,
): void {
  // Horizontal mid-facet (rows 7-8 are the widest on the diamond silhouette).
  for (let x = 1; x < SIZE - 1; x++) {
    if (mask[7]?.[x]) cv.set(x, 7, highlight);
  }
  // Upper-left diagonal facet stays in the highlight color.
  for (let i = 2; i < 7; i++) {
    if (mask[i]?.[i]) cv.set(i, i, highlight);
  }
  // Anti-diagonal facet uses the SECONDARY color so users can tint the
  // accent without changing the base hue.
  for (let i = 2; i < SIZE - 2; i++) {
    const j = SIZE - 1 - i;
    if (mask[i]?.[j] && j > 1 && j < SIZE - 1) cv.set(j, i, secondary);
  }
}

function addCrystalShine(
  cv: Canvas,
  mask: boolean[][],
  _primary: Color,
  bright: Color,
  secondary: Color,
): void {
  // Vertical center bright line for a crystal shard.
  for (let y = 2; y < SIZE - 2; y++) {
    if (mask[y]?.[7]) cv.set(7, y, bright);
  }
  // Side facets use the secondary color so tinted secondaryColor shows through.
  for (let y = 4; y < SIZE - 4; y++) {
    if (mask[y]?.[5]) cv.set(5, y, secondary);
    if (mask[y]?.[10]) cv.set(10, y, secondary);
  }
}

function addMetalBands(
  cv: Canvas,
  mask: boolean[][],
  primary: Color,
  highlight: Color,
  shadow: Color,
  secondary: Color,
): void {
  // Mid-band brighter, top + bottom edges of inner area darker.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!mask[y]?.[x]) continue;
      const onTop = !(mask[y - 1]?.[x] ?? false);
      const onBot = !(mask[y + 1]?.[x] ?? false);
      if (onTop || onBot) continue; // outline already painted
      if (y === 7 || y === 8) cv.set(x, y, highlight);
      else if (y === 6 || y === 9) cv.set(x, y, primary);
      else cv.set(x, y, shadow);
    }
  }
  // Secondary-tinted accent stripes across the mid-band so e.g. a copper
  // hammer with secondaryColor green shows green flecks on the head.
  for (let x = 0; x < SIZE; x++) {
    if (!mask[8]?.[x]) continue;
    const onLeft = !(mask[8]?.[x - 1] ?? false);
    const onRight = !(mask[8]?.[x + 1] ?? false);
    if (onLeft || onRight) continue;
    if (x % 3 === 0) cv.set(x, 8, secondary);
  }
}

function addStoneSpeckles(
  cv: Canvas,
  mask: boolean[][],
  primary: Color,
  shadow: Color,
  secondary: Color,
  r: () => number,
): void {
  for (let n = 0; n < 12; n++) {
    const x = Math.floor(r() * SIZE);
    const y = Math.floor(r() * SIZE);
    if (mask[y]?.[x]) {
      const choice = r();
      cv.set(x, y, choice < 0.45 ? shadow : choice < 0.85 ? primary : secondary);
    }
  }
}

function addGrassBlades(
  cv: Canvas,
  mask: boolean[][],
  primary: Color,
  shadow: Color,
  secondary: Color,
  r: () => number,
): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!mask[y]?.[x]) continue;
      const v = r();
      if (v < 0.20) cv.set(x, y, shadow);
      else if (v < 0.30) cv.set(x, y, secondary);
      else if (v > 0.85) cv.set(x, y, primary);
    }
  }
}

function addPlainSheen(
  cv: Canvas,
  mask: boolean[][],
  highlight: Color,
  secondary: Color,
): void {
  // Top inside row gets the highlight.
  for (let x = 1; x < SIZE - 1; x++) {
    if (mask[2]?.[x] && !(mask[1]?.[x] ?? false)) cv.set(x, 2, highlight);
  }
  // Bottom inside row gets a secondary-tinted accent every other pixel.
  for (let x = 1; x < SIZE - 1; x++) {
    if (mask[13]?.[x] && !(mask[14]?.[x] ?? false) && x % 2 === 0) {
      cv.set(x, 13, secondary);
    }
  }
}

function addSparkle(cv: Canvas, mask: boolean[][], color: Color): void {
  // Place a sparkle at an interior top-left position. Walk a small grid until
  // we hit a masked pixel that isn't on the outline.
  for (let y = 2; y < 8; y++) {
    for (let x = 2; x < 8; x++) {
      if (
        mask[y]?.[x] &&
        mask[y]?.[x - 1] &&
        mask[y]?.[x + 1] &&
        mask[y - 1]?.[x] &&
        mask[y + 1]?.[x]
      ) {
        cv.set(x, y, color);
        return;
      }
    }
  }
}

function addGlowHalo(cv: Canvas, mask: boolean[][], halo: Color): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (mask[y]?.[x]) continue;
      // Outside the silhouette: if any 4-neighbor is inside, paint a translucent halo.
      const adj =
        (mask[y]?.[x - 1] ?? false) ||
        (mask[y]?.[x + 1] ?? false) ||
        (mask[y - 1]?.[x] ?? false) ||
        (mask[y + 1]?.[x] ?? false);
      if (adj) cv.set(x, y, { ...halo, a: 110 });
    }
  }
}

// ============================================================================
// Block-face painters (full 16x16 tile)
// ============================================================================

function paintPlain(cv: Canvas, p: Color, s: Color): void {
  cv.fill(p);
  for (let i = 0; i < SIZE; i++) {
    cv.set(i, 0, s);
    cv.set(i, SIZE - 1, s);
    cv.set(0, i, s);
    cv.set(SIZE - 1, i, s);
  }
}

function paintGemBlock(
  cv: Canvas,
  p: Color,
  s: Color,
  r: () => number,
  glowing: boolean,
): void {
  cv.fill(p);
  const dark = shade(p, -0.5);
  for (let i = 0; i < SIZE; i++) {
    cv.set(i, 0, dark);
    cv.set(i, SIZE - 1, dark);
    cv.set(0, i, dark);
    cv.set(SIZE - 1, i, dark);
  }
  // Faceted X-pattern for a gem block.
  const light = shade(p, 0.45);
  for (let i = 1; i < SIZE - 1; i++) {
    cv.set(i, i, light);
    cv.set(SIZE - 1 - i, i, light);
  }
  cv.set(3, 3, WHITE);
  if (glowing) cv.set(SIZE - 4, SIZE - 4, shade(p, 0.6));
  for (let n = 0; n < 5; n++) {
    const x = 2 + Math.floor(r() * (SIZE - 4));
    const y = 2 + Math.floor(r() * (SIZE - 4));
    cv.set(x, y, shade(p, -0.2));
  }
  void s;
}

function paintCrystalBlock(
  cv: Canvas,
  p: Color,
  s: Color,
  r: () => number,
  glowing: boolean,
): void {
  cv.fill(shade(p, -0.6));
  const light = shade(p, 0.45);
  // Internal crystal facets — a tilted parallelogram of brighter pixels.
  for (let y = 2; y < SIZE - 2; y++) {
    for (let x = 2; x < SIZE - 2; x++) {
      if ((x + y) % 5 === 0) cv.set(x, y, light);
      else if ((x - y + SIZE) % 5 === 0) cv.set(x, y, p);
    }
  }
  if (glowing) {
    cv.set(7, 1, WHITE);
    cv.set(11, SIZE - 2, WHITE);
  }
  void s;
  void r;
}

function paintMetalBlock(
  cv: Canvas,
  p: Color,
  s: Color,
  r: () => number,
): void {
  for (let y = 0; y < SIZE; y++) {
    let band: Color;
    if (y === 0 || y === SIZE - 1) band = shade(p, -0.45);
    else if (y === 1 || y === SIZE - 2) band = shade(p, -0.2);
    else if (y % 4 === 2) band = shade(p, 0.25);
    else if (y % 4 === 0) band = shade(p, -0.1);
    else band = p;
    for (let x = 0; x < SIZE; x++) cv.set(x, y, band);
  }
  // Rivets at corners + a couple of subtle highlights.
  cv.set(2, 2, shade(p, -0.55));
  cv.set(SIZE - 3, 2, shade(p, -0.55));
  cv.set(2, SIZE - 3, shade(p, -0.55));
  cv.set(SIZE - 3, SIZE - 3, shade(p, -0.55));
  cv.set(4, 4, shade(p, 0.55));
  if (s) {
    for (let n = 0; n < 4; n++) {
      const x = 1 + Math.floor(r() * (SIZE - 2));
      const y = 4 + Math.floor(r() * (SIZE - 8));
      cv.set(x, y, s);
    }
  }
}

function paintStoneBlock(
  cv: Canvas,
  p: Color,
  s: Color,
  r: () => number,
): void {
  cv.fill(p);
  // Mix of small and chunkier speckles.
  for (let n = 0; n < 28; n++) {
    const x = Math.floor(r() * SIZE);
    const y = Math.floor(r() * SIZE);
    const tone = r() < 0.5 ? shade(p, -0.18) : shade(p, 0.12);
    cv.set(x, y, tone);
  }
  for (let n = 0; n < 4; n++) {
    const cx = 1 + Math.floor(r() * (SIZE - 3));
    const cy = 1 + Math.floor(r() * (SIZE - 3));
    const tone = shade(p, -0.25);
    cv.set(cx, cy, tone);
    cv.set(cx + 1, cy, tone);
    cv.set(cx, cy + 1, tone);
  }
  // Crack line.
  let cx = 4;
  let cy = 5;
  for (let i = 0; i < 6; i++) {
    cv.set(cx, cy, shade(p, -0.4));
    cx += r() < 0.5 ? 1 : 2;
    cy += r() < 0.7 ? 0 : 1;
    if (cx >= SIZE || cy >= SIZE) break;
  }
  void s;
}

function paintGrass(
  cv: Canvas,
  p: Color,
  s: Color,
  r: () => number,
  face: FaceMode,
): void {
  if (face === "side") {
    for (let y = 0; y < SIZE; y++) {
      const isGrassBand = y < 4;
      const isOverlay = y === 4;
      for (let x = 0; x < SIZE; x++) {
        if (isGrassBand) {
          const v = r();
          const tone = v < 0.3 ? shade(p, -0.2) : v < 0.6 ? shade(p, 0.15) : p;
          cv.set(x, y, tone);
        } else if (isOverlay) {
          const drop = (x + Math.floor(r() * 2)) % 3 === 0;
          cv.set(x, y, drop ? p : DIRT);
        } else {
          const tone = r() < 0.3 ? shade(DIRT, -0.15) : DIRT;
          cv.set(x, y, tone);
        }
      }
    }
    return;
  }
  if (face === "bottom") {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        cv.set(x, y, r() < 0.2 ? shade(DIRT, -0.15) : DIRT);
      }
    }
    return;
  }
  // top / all: organic speckles
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = r();
      const tone = v < 0.15 ? shade(p, 0.2) : v < 0.85 ? p : shade(p, -0.2);
      cv.set(x, y, tone);
    }
  }
  // Sparse darker "blade" pixels for organic variation.
  for (let n = 0; n < 6; n++) {
    cv.set(Math.floor(r() * SIZE), Math.floor(r() * SIZE), shade(p, -0.35));
  }
  void s;
}
