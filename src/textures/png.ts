import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const MAX_DIMENSION = 4096;

function assertDim(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`encodePng: ${name} must be a finite number, got ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`encodePng: ${name} must be an integer, got ${value}`);
  }
  if (value <= 0) {
    throw new Error(`encodePng: ${name} must be > 0, got ${value}`);
  }
  if (value > MAX_DIMENSION) {
    throw new Error(
      `encodePng: ${name} ${value} exceeds max dimension ${MAX_DIMENSION}`,
    );
  }
}

/**
 * Encode an RGBA pixel buffer as a PNG. No external deps: builds IHDR/IDAT/IEND
 * chunks by hand and uses Node's built-in zlib for the IDAT compression.
 * Returns a Buffer suitable for safeWriteFiles.
 *
 * Dimensions are validated: must be positive safe integers, capped at 4096
 * per side. (Loom textures are 16×16 in practice; the cap exists so a
 * mis-typed planner spec can't trigger a 4 GB allocation.)
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  assertDim(width, "width");
  assertDim(height, "height");
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `encodePng: rgba length ${rgba.length} does not match ${width}*${height}*4`,
    );
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace none

  // IDAT: each scanline prefixed by filter byte 0, then RGBA bytes, then deflate.
  const raw = Buffer.alloc(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[p++] = rgba[i]!;
      raw[p++] = rgba[i + 1]!;
      raw[p++] = rgba[i + 2]!;
      raw[p++] = rgba[i + 3]!;
    }
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
