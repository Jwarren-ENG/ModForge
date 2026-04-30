import { DIRT, mix, shade, WHITE, type Color } from "./colors.js";

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
  /** For grass blocks the side face needs a different layout than the top. */
  faceMode?: FaceMode;
  /** Salt the deterministic noise so different faces look slightly different. */
  salt?: number;
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
 * Render a 16x16 RGBA byte array using one of the procedural styles.
 * Output is fully deterministic for a given (style, primary, secondary, salt).
 */
export function paint(style: TextureStyle, opts: PaintOptions): Uint8Array {
  const cv = new Canvas();
  const primary = opts.primary;
  const secondary = opts.secondary ?? shade(primary, -0.4);
  const r = rng(seedFrom(primary, opts.salt ?? 0));
  const glowing = opts.glowing ?? false;
  const face = opts.faceMode ?? "item";

  switch (style) {
    case "plain":
      paintPlain(cv, primary, secondary);
      break;
    case "gem":
      paintGem(cv, primary, secondary, r, glowing);
      break;
    case "crystal":
      paintCrystal(cv, primary, secondary, r, glowing);
      break;
    case "metal":
      paintMetal(cv, primary, secondary, r);
      break;
    case "stone":
      paintStone(cv, primary, secondary, r);
      break;
    case "grass":
      paintGrass(cv, primary, secondary, r, face);
      break;
  }
  return cv.rgba;
}

function paintPlain(cv: Canvas, p: Color, s: Color): void {
  cv.fill(p);
  for (let i = 0; i < SIZE; i++) {
    cv.set(i, 0, s);
    cv.set(i, SIZE - 1, s);
    cv.set(0, i, s);
    cv.set(SIZE - 1, i, s);
  }
}

function paintGem(cv: Canvas, p: Color, s: Color, r: () => number, glowing: boolean): void {
  cv.fill(p);
  const dark = shade(p, -0.5);
  // dark border
  for (let i = 0; i < SIZE; i++) {
    cv.set(i, 0, dark);
    cv.set(i, SIZE - 1, dark);
    cv.set(0, i, dark);
    cv.set(SIZE - 1, i, dark);
  }
  // top-left highlight
  const light = shade(p, 0.45);
  for (let i = 1; i < 6; i++) {
    cv.set(i, 1, light);
    cv.set(1, i, light);
  }
  // diagonal facet
  for (let i = 2; i < SIZE - 2; i++) {
    cv.set(i, i, shade(p, 0.15));
  }
  cv.set(3, 3, WHITE);
  // a few darker speckles for visual interest
  for (let n = 0; n < 5; n++) {
    const x = 2 + Math.floor(r() * (SIZE - 4));
    const y = 2 + Math.floor(r() * (SIZE - 4));
    cv.set(x, y, shade(p, -0.2));
  }
  if (glowing) {
    cv.set(SIZE - 3, SIZE - 3, shade(p, 0.6));
  }
  void s;
}

function paintCrystal(cv: Canvas, p: Color, s: Color, r: () => number, glowing: boolean): void {
  cv.fill(shade(p, -0.7));
  const light = shade(p, 0.45);
  const mid = p;
  // tall center crystal
  for (let y = 1; y < SIZE - 1; y++) {
    cv.set(7, y, mid);
    cv.set(8, y, mid);
    if (y > 2 && y < SIZE - 2) cv.set(7, y, light);
  }
  // shorter side crystals
  for (let y = 5; y < SIZE - 1; y++) {
    cv.set(3, y, mid);
    cv.set(4, y, mid);
  }
  for (let y = 7; y < SIZE - 1; y++) {
    cv.set(11, y, mid);
    cv.set(12, y, mid);
  }
  if (glowing) {
    const halo = shade(p, 0.3);
    for (let y = 4; y < SIZE - 2; y++) {
      cv.set(2, y, halo);
      cv.set(13, y, halo);
    }
    cv.set(7, 0, halo);
    cv.set(8, 0, halo);
  }
  cv.set(7, 1, WHITE);
  cv.set(11, 5, WHITE);
  void s;
  void r;
}

function paintMetal(cv: Canvas, p: Color, s: Color, r: () => number): void {
  for (let y = 0; y < SIZE; y++) {
    let band: Color;
    if (y === 0 || y === SIZE - 1) band = shade(p, -0.45);
    else if (y === 1 || y === SIZE - 2) band = shade(p, -0.2);
    else if (y % 4 === 2) band = shade(p, 0.2);
    else band = p;
    for (let x = 0; x < SIZE; x++) cv.set(x, y, band);
  }
  // rivets
  cv.set(2, 2, shade(p, -0.55));
  cv.set(SIZE - 3, 2, shade(p, -0.55));
  cv.set(2, SIZE - 3, shade(p, -0.55));
  cv.set(SIZE - 3, SIZE - 3, shade(p, -0.55));
  cv.set(4, 4, shade(p, 0.5));
  // secondary streaks
  if (s) {
    for (let n = 0; n < 4; n++) {
      const x = 1 + Math.floor(r() * (SIZE - 2));
      const y = 4 + Math.floor(r() * (SIZE - 8));
      cv.set(x, y, s);
    }
  }
}

function paintStone(cv: Canvas, p: Color, s: Color, r: () => number): void {
  cv.fill(p);
  for (let n = 0; n < 38; n++) {
    const x = Math.floor(r() * SIZE);
    const y = Math.floor(r() * SIZE);
    const tone = r() < 0.5 ? shade(p, -0.18) : shade(p, 0.12);
    cv.set(x, y, tone);
  }
  // a "crack" line
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

function paintGrass(cv: Canvas, p: Color, s: Color, r: () => number, face: FaceMode): void {
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
  // top / item / all
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = r();
      const tone = v < 0.15 ? shade(p, 0.2) : v < 0.85 ? p : shade(p, -0.2);
      cv.set(x, y, tone);
    }
  }
  void s;
  void mix;
}
