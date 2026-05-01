import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";

/**
 * Minimal PNG decoder for the subset Minecraft 1.20.1 ships:
 *   - 8-bit color depth
 *   - color types 0 (grayscale), 2 (RGB), 3 (paletted), 4 (grayscale+alpha),
 *     and 6 (RGBA)
 *   - no interlace
 *
 * Output is always RGBA. Anything outside the supported subset is rejected
 * and callers fall back to procedural generation. Hand-rolled per the PNG
 * spec (no deps) so the no-deps texture promise holds.
 */

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Defensive cap so a malformed/malicious PNG header can't allocate gigabytes.
const MAX_SIDE = 4096;

const BYTES_PER_PIXEL: Record<number, number> = {
  0: 1, // grayscale
  2: 3, // RGB
  3: 1, // palette index
  4: 2, // grayscale + alpha
  6: 4, // RGBA
};

export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8) throw new Error("PNG: too short");
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error("PNG: bad signature");
  }

  let off = 8;
  let ihdr: {
    w: number;
    h: number;
    depth: number;
    colorType: number;
    interlace: number;
  } | null = null;
  const idatChunks: Buffer[] = [];
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;

  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    if (off + 8 + len + 4 > buf.length) {
      throw new Error("PNG: truncated chunk");
    }
    const data = buf.subarray(off + 8, off + 8 + len);

    if (type === "IHDR") {
      if (data.length !== 13) throw new Error("PNG: bad IHDR length");
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8]!,
        colorType: data[9]!,
        // bytes 10 (compression) and 11 (filter method) are always 0 for valid PNGs.
        interlace: data[12]!,
      };
    } else if (type === "PLTE") {
      plte = Buffer.from(data);
    } else if (type === "tRNS") {
      trns = Buffer.from(data);
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 8 + len + 4;
  }

  if (!ihdr) throw new Error("PNG: no IHDR");
  if (ihdr.depth !== 8) {
    throw new Error(`PNG: unsupported bit depth ${ihdr.depth} (only 8 supported)`);
  }
  const bpp = BYTES_PER_PIXEL[ihdr.colorType];
  if (!bpp) {
    throw new Error(`PNG: unsupported color type ${ihdr.colorType}`);
  }
  if (ihdr.interlace !== 0) {
    throw new Error("PNG: interlace not supported");
  }
  if (ihdr.w <= 0 || ihdr.h <= 0) {
    throw new Error(`PNG: invalid dimensions ${ihdr.w}x${ihdr.h}`);
  }
  if (ihdr.w > MAX_SIDE || ihdr.h > MAX_SIDE) {
    throw new Error(`PNG: dimensions ${ihdr.w}x${ihdr.h} exceed safety cap ${MAX_SIDE}`);
  }
  if (idatChunks.length === 0) throw new Error("PNG: no IDAT");
  if (ihdr.colorType === 3 && !plte) {
    throw new Error("PNG: palette color type but no PLTE chunk");
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const expected = ihdr.h * (1 + ihdr.w * bpp);
  if (inflated.length !== expected) {
    throw new Error(
      `PNG: decompressed size ${inflated.length} != expected ${expected}`,
    );
  }

  const raw = unfilter(inflated, ihdr.w, ihdr.h, bpp);
  const rgba = toRgba(raw, ihdr.w, ihdr.h, ihdr.colorType, plte, trns);
  return { width: ihdr.w, height: ihdr.h, rgba };
}

/**
 * Reverse PNG scanline filtering. Each scanline is prefixed by a single byte
 * naming one of the 5 filter types. Per-byte recovery uses the byte to the
 * left (a), the byte directly above (b), and the byte above-and-left (c).
 */
function unfilter(raw: Buffer, w: number, h: number, bpp: number): Uint8Array {
  const stride = w * bpp;
  const out = new Uint8Array(h * stride);
  let inPos = 0;

  for (let y = 0; y < h; y++) {
    const filter = raw[inPos++]!;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const src = raw[inPos++]!;
      const a = x >= bpp ? out[rowStart + x - bpp]! : 0;
      const b = y > 0 ? out[rowStart - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[rowStart - stride + x - bpp]! : 0;
      let v: number;
      switch (filter) {
        case 0: v = src; break;
        case 1: v = (src + a) & 0xff; break;
        case 2: v = (src + b) & 0xff; break;
        case 3: v = (src + ((a + b) >> 1)) & 0xff; break;
        case 4: v = (src + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`PNG: unknown filter type ${filter} at row ${y}`);
      }
      out[rowStart + x] = v;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Expand the unfiltered native-color-type buffer to RGBA. For palette PNGs,
 * the PLTE chunk supplies RGB triplets and the optional tRNS chunk supplies
 * per-index alpha (entries beyond tRNS length default to 255).
 */
function toRgba(
  raw: Uint8Array,
  w: number,
  h: number,
  colorType: number,
  plte: Buffer | null,
  trns: Buffer | null,
): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n * 4);
  switch (colorType) {
    case 0: // grayscale
      for (let i = 0; i < n; i++) {
        const v = raw[i]!;
        out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
      }
      return out;
    case 2: // RGB
      for (let i = 0; i < n; i++) {
        out[i * 4] = raw[i * 3]!;
        out[i * 4 + 1] = raw[i * 3 + 1]!;
        out[i * 4 + 2] = raw[i * 3 + 2]!;
        out[i * 4 + 3] = 255;
      }
      return out;
    case 3: { // palette
      if (!plte) throw new Error("PNG: palette color type but no PLTE chunk");
      const palLen = (plte.length / 3) | 0;
      for (let i = 0; i < n; i++) {
        const idx = raw[i]!;
        if (idx >= palLen) throw new Error(`PNG: palette index ${idx} out of range`);
        out[i * 4] = plte[idx * 3]!;
        out[i * 4 + 1] = plte[idx * 3 + 1]!;
        out[i * 4 + 2] = plte[idx * 3 + 2]!;
        out[i * 4 + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      }
      return out;
    }
    case 4: // grayscale + alpha
      for (let i = 0; i < n; i++) {
        const v = raw[i * 2]!;
        out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v;
        out[i * 4 + 3] = raw[i * 2 + 1]!;
      }
      return out;
    case 6: // RGBA
      out.set(raw);
      return out;
    default:
      throw new Error(`PNG: unsupported color type ${colorType}`);
  }
}
