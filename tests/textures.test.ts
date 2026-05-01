import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { encodePng } from "../src/textures/png.js";
import { generateTexturePng } from "../src/textures/index.js";
import { paint } from "../src/textures/styles.js";
import { parseHex } from "../src/textures/colors.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("encodePng: produces valid PNG signature + IHDR + IEND", () => {
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = i & 0xff;
  const png = encodePng(16, 16, rgba);
  // Signature
  assert.deepEqual(png.subarray(0, 8), PNG_MAGIC);
  // IHDR length is 13 in big-endian at offset 8.
  assert.equal(png.readUInt32BE(8), 13);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  // Width + height encoded.
  assert.equal(png.readUInt32BE(16), 16);
  assert.equal(png.readUInt32BE(20), 16);
  // Last chunk is IEND.
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString("ascii"), "IEND");
});

test("encodePng: rejects mismatched rgba length", () => {
  assert.throws(
    () => encodePng(16, 16, new Uint8Array(100)),
    /rgba length/,
  );
});

test("generateTexturePng: produces valid 16x16 PNG for every style", () => {
  const styles = ["plain", "gem", "crystal", "metal", "stone", "grass"] as const;
  for (const style of styles) {
    const png = generateTexturePng({
      style,
      primaryColorHex: "#aa00ff",
      secondaryColorHex: "#220033",
      glowing: style === "crystal" || style === "gem",
    });
    // Sig (8) + IHDR (25) + IDAT (>= a few bytes for a tiny deflate stream) + IEND (12).
    assert.equal(png.length > 60, true, `${style} PNG too small (${png.length} bytes)`);
    assert.deepEqual(png.subarray(0, 8), PNG_MAGIC, `${style} bad signature`);
    assert.equal(png.readUInt32BE(16), 16, `${style} bad width`);
    assert.equal(png.readUInt32BE(20), 16, `${style} bad height`);
  }
});

test("generateTexturePng: deterministic — same inputs => identical bytes", () => {
  const opts = {
    style: "gem" as const,
    primaryColorHex: "#3a004f",
    secondaryColorHex: "#1a0026",
    glowing: true,
  };
  const a = generateTexturePng(opts);
  const b = generateTexturePng(opts);
  assert.deepEqual(a, b);
});

test("generateTexturePng: rejects bad hex colors", () => {
  assert.throws(
    () => generateTexturePng({ style: "gem", primaryColorHex: "lavender" }),
    /bad hex color/,
  );
  assert.throws(
    () => generateTexturePng({ style: "gem", primaryColorHex: "#zzz" }),
    /bad hex color/,
  );
});

test("encodePng: rejects bad dimensions", () => {
  const rgba = new Uint8Array(16 * 16 * 4);
  assert.throws(() => encodePng(0, 16, new Uint8Array(0)), /width must be > 0/);
  assert.throws(() => encodePng(-4, 16, new Uint8Array(0)), /width must be > 0/);
  assert.throws(() => encodePng(16.5, 16, rgba), /must be an integer/);
  assert.throws(() => encodePng(NaN, 16, rgba), /finite number/);
  assert.throws(() => encodePng(Infinity, 16, rgba), /finite number/);
  assert.throws(
    () => encodePng(8192, 16, new Uint8Array(8192 * 16 * 4)),
    /exceeds max dimension/,
  );
  assert.throws(() => encodePng(16, 0, new Uint8Array(0)), /height must be > 0/);
  assert.throws(() => encodePng(16, NaN, rgba), /finite number/);
});

test("encodePng: integrity — IDAT decompresses to height * (1 + width*4) and every scanline starts with filter byte 0", () => {
  const W = 16;
  const H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 31) & 0xff;
  const png = encodePng(W, H, rgba);

  // Walk chunks: skip 8-byte signature, then read length+type+data+crc.
  let off = 8;
  let idat: Buffer | undefined;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IDAT") idat = Buffer.from(data); // copy out
    off += 8 + len + 4; // length + type + data + crc
  }
  assert.ok(idat, "IDAT chunk must be present");

  const raw = inflateSync(idat);
  assert.equal(raw.length, H * (1 + W * 4), "decompressed size must match");
  for (let y = 0; y < H; y++) {
    const filterByte = raw[y * (1 + W * 4)];
    assert.equal(filterByte, 0, `scanline ${y} filter byte must be 0`);
  }
  // Sanity: original pixel bytes round-trip.
  for (let y = 0; y < H; y++) {
    const rowStart = y * (1 + W * 4) + 1;
    for (let x = 0; x < W * 4; x++) {
      assert.equal(raw[rowStart + x], rgba[y * W * 4 + x]);
    }
  }
});

test("generateTexturePng: grass side face differs from grass top", () => {
  const top = generateTexturePng({
    style: "grass",
    primaryColorHex: "#447733",
    faceMode: "top",
  });
  const side = generateTexturePng({
    style: "grass",
    primaryColorHex: "#447733",
    faceMode: "side",
  });
  assert.notDeepEqual(top, side, "side face should not equal top face");
});

// =====================================================================
// Item silhouette tests (Milestone 3.4)
// =====================================================================

const SIZE = 16;

/** Helper: get the alpha byte at (x, y) in a 16x16 RGBA buffer. */
function alphaAt(rgba: Uint8Array, x: number, y: number): number {
  return rgba[(y * SIZE + x) * 4 + 3]!;
}

test("item silhouette: diamond retexture has transparent corners", () => {
  const rgba = paint("crystal", {
    primary: parseHex("#101015"),
    faceMode: "item",
    silhouette: "diamond",
  });
  // All four 2x2 corners must be fully transparent.
  for (const [cx, cy] of [
    [0, 0], [1, 0], [0, 1], [1, 1],
    [SIZE - 1, 0], [SIZE - 2, 0], [SIZE - 1, 1], [SIZE - 2, 1],
    [0, SIZE - 1], [1, SIZE - 1], [0, SIZE - 2], [1, SIZE - 2],
    [SIZE - 1, SIZE - 1], [SIZE - 2, SIZE - 1], [SIZE - 1, SIZE - 2], [SIZE - 2, SIZE - 2],
  ] as const) {
    assert.equal(
      alphaAt(rgba, cx, cy),
      0,
      `corner pixel (${cx},${cy}) must be transparent for a diamond silhouette`,
    );
  }
});

test("item silhouette: diamond retexture is NOT a mostly-opaque rectangle", () => {
  const rgba = paint("crystal", {
    primary: parseHex("#101015"),
    faceMode: "item",
    silhouette: "diamond",
  });
  let opaque = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (alphaAt(rgba, x, y) === 255) opaque++;
    }
  }
  const total = SIZE * SIZE;
  // A diamond fills ~45-55% of the canvas. Anything > 75% means we're
  // accidentally painting a full square again.
  assert.ok(
    opaque < total * 0.75,
    `expected diamond silhouette to leave ~half the canvas transparent; got ${opaque}/${total} opaque`,
  );
  // And there should be a meaningful number of opaque pixels (not empty).
  assert.ok(opaque > total * 0.25, `silhouette suspiciously empty: ${opaque}/${total} opaque`);
});

test("item silhouette: gem and crystal items have multiple distinct shade values", () => {
  for (const style of ["gem", "crystal"] as const) {
    const rgba = paint(style, {
      primary: parseHex("#3a004f"),
      faceMode: "item",
    });
    const colors = new Set<string>();
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3]!;
      if (a === 0) continue;
      colors.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
    }
    assert.ok(
      colors.size >= 4,
      `${style} item should have >=4 distinct shade colors; got ${colors.size}`,
    );
  }
});

test("item silhouette: silhouette override forces diamond shape regardless of style", () => {
  const rgba = paint("plain", {
    primary: parseHex("#101015"),
    faceMode: "item",
    silhouette: "diamond",
  });
  // The diamond shape leaves rows 0 and 15 fully transparent.
  for (let x = 0; x < SIZE; x++) {
    assert.equal(alphaAt(rgba, x, 0), 0, `row 0 col ${x} must be transparent`);
    assert.equal(alphaAt(rgba, x, SIZE - 1), 0, `row 15 col ${x} must be transparent`);
  }
  // The mid rows are wide (cols 1..14 opaque).
  for (let x = 1; x <= 14; x++) {
    assert.equal(alphaAt(rgba, x, 7), 255, `row 7 col ${x} must be opaque`);
  }
});

test("item silhouette: ingot silhouette only fills horizontal middle band", () => {
  const rgba = paint("metal", {
    primary: parseHex("#b86b3a"),
    faceMode: "item",
    silhouette: "ingot",
  });
  // Top + bottom rows transparent.
  for (let x = 0; x < SIZE; x++) {
    assert.equal(alphaAt(rgba, x, 0), 0, `top row x=${x} must be transparent for ingot`);
    assert.equal(alphaAt(rgba, x, SIZE - 1), 0, `bottom row x=${x} must be transparent for ingot`);
  }
  // Mid rows have content.
  let midOpaque = 0;
  for (let x = 0; x < SIZE; x++) if (alphaAt(rgba, x, 7) === 255) midOpaque++;
  assert.ok(midOpaque >= 12, `ingot mid row should be wide; got ${midOpaque} opaque`);
});

test("item silhouette: rendering is deterministic for fixed inputs", () => {
  const a = generateTexturePng({
    style: "crystal",
    primaryColorHex: "#101015",
    secondaryColorHex: "#3a3a4a",
    glowing: true,
    faceMode: "item",
    silhouette: "diamond",
  });
  const b = generateTexturePng({
    style: "crystal",
    primaryColorHex: "#101015",
    secondaryColorHex: "#3a3a4a",
    glowing: true,
    faceMode: "item",
    silhouette: "diamond",
  });
  assert.deepEqual(a, b);
});

test("block face still fills the full 16x16 (alpha 255 everywhere)", () => {
  const rgba = paint("metal", {
    primary: parseHex("#5a0a14"),
    faceMode: "all",
  });
  for (let i = 0; i < rgba.length; i += 4) {
    assert.equal(rgba[i + 3], 255, `block face pixel index ${i / 4} must be opaque`);
  }
});

// =====================================================================
// Codex 3.4 review patch — secondaryColor, generator-level retexture,
// PNG CRC validation, and silhouette invariants
// =====================================================================

test("item silhouette: changing secondaryColor changes the rendered bytes (P1)", async () => {
  // Same primary, different secondary -> output must differ for every style.
  const cases: Array<{ style: "gem" | "crystal" | "metal" | "stone" | "grass" | "plain"; silhouette?: "diamond" | "crystal-shard" | "ingot" | "generic-item" }> = [
    { style: "gem", silhouette: "diamond" },
    { style: "crystal", silhouette: "crystal-shard" },
    { style: "metal", silhouette: "ingot" },
    { style: "plain", silhouette: "generic-item" },
    { style: "stone", silhouette: "generic-item" },
    { style: "grass", silhouette: "generic-item" },
  ];
  for (const { style, silhouette } of cases) {
    const a = paint(style, {
      primary: parseHex("#aa1133"),
      secondary: parseHex("#222222"),
      faceMode: "item",
      silhouette,
    });
    const b = paint(style, {
      primary: parseHex("#aa1133"),
      secondary: parseHex("#ffff00"),
      faceMode: "item",
      silhouette,
    });
    assert.notDeepEqual(a, b, `${style} item: different secondary should produce different bytes`);
  }
});

test("item silhouette: same (primary, secondary) -> identical bytes (determinism preserved)", () => {
  const a = paint("gem", {
    primary: parseHex("#aa1133"),
    secondary: parseHex("#ffff00"),
    faceMode: "item",
    silhouette: "diamond",
  });
  const b = paint("gem", {
    primary: parseHex("#aa1133"),
    secondary: parseHex("#ffff00"),
    faceMode: "item",
    silhouette: "diamond",
  });
  assert.deepEqual(a, b);
});

// ---------- Generator-level diamond retexture (P2) ----------

test("generator: retexture_item for minecraft:diamond produces a diamond-shaped PNG at the allowlisted path (P2)", async () => {
  const { generateRetextureItem } = await import("../src/generators/retextureItem.js");
  const spec = {
    modId: "demo",
    modName: "Demo",
    modVersion: "1.0.0",
    mcVersion: "1.20.1",
    modLoader: "fabric",
    packageName: "com.modforge.demo",
    mainClass: "DemoMod",
    description: "",
    features: [],
    filesToCreate: [],
    limitations: [],
    assumptions: [],
  } as const;
  const feature = {
    type: "retexture_item",
    id: "diamond_retex",
    name: "Black Crystal Diamonds",
    description: "",
    details: {
      vanillaTarget: "minecraft:diamond",
      textureStyle: "crystal",
      textureColor: "#101015",
      glowing: true,
    },
  } as const;

  const contribution = generateRetextureItem(spec as never, feature as never);

  // Exactly one resource at the allowlisted vanilla path.
  assert.equal(contribution.resources.length, 1);
  const file = contribution.resources[0]!;
  assert.equal(file.path, "src/main/resources/assets/minecraft/textures/item/diamond.png");
  assert.ok(Buffer.isBuffer(file.content), "PNG content must be a Buffer");
  const png = file.content as Buffer;

  // Decode IDAT and inspect pixel data directly.
  const raw = decodePngScanlines(png, 16, 16);

  // Corners (2x2 each) must be transparent — proves the diamond silhouette
  // is in effect and we're not painting a full square.
  for (const [x, y] of [
    [0, 0], [1, 0], [0, 1], [1, 1],
    [15, 0], [14, 0], [15, 1], [14, 1],
    [0, 15], [1, 15], [0, 14], [1, 14],
    [15, 15], [14, 15], [15, 14], [14, 14],
  ] as const) {
    const a = pixelAlpha(raw, 16, x, y);
    assert.equal(a, 0, `(${x},${y}) corner must be transparent in the generator-produced diamond PNG`);
  }

  // Not mostly opaque (no full-square fallback).
  let opaque = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (pixelAlpha(raw, 16, x, y) === 255) opaque++;
    }
  }
  assert.ok(opaque < 16 * 16 * 0.75, `expected diamond-shaped PNG; got ${opaque}/256 opaque`);
  assert.ok(opaque > 16 * 16 * 0.25, `silhouette suspiciously empty: ${opaque}/256 opaque`);
});

// ---------- PNG chunk CRC validation (P3) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function chunkCrc(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

test("PNG: every chunk's stored CRC matches a freshly-computed CRC32 over (type+data) (P3)", () => {
  const samples = [
    encodePng(16, 16, makeFilledRgba(16, 16)),
    generateTexturePng({ style: "gem", primaryColorHex: "#aa1133", faceMode: "item", silhouette: "diamond" }),
    generateTexturePng({ style: "crystal", primaryColorHex: "#101015", glowing: true, faceMode: "item", silhouette: "diamond" }),
    generateTexturePng({ style: "metal", primaryColorHex: "#5a0a14", faceMode: "all" }),
    generateTexturePng({ style: "grass", primaryColorHex: "#5a008a", faceMode: "side" }),
  ];
  for (const png of samples) {
    let off = 8; // skip signature
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      const typeStart = off + 4;
      const dataEnd = typeStart + 4 + len;
      const stored = png.readUInt32BE(dataEnd);
      const computed = chunkCrc(png.subarray(typeStart, dataEnd));
      assert.equal(stored, computed, `chunk at offset ${off} has bad CRC`);
      off = dataEnd + 4;
    }
  }
});

// ---------- Silhouette mask invariants (P4) ----------

test("silhouette: every silhouette is exactly 16x16 of booleans (P4)", async () => {
  const { getMask } = await import("../src/textures/silhouettes.js");
  for (const s of ["diamond", "crystal-shard", "ingot", "generic-item"] as const) {
    const m = getMask(s);
    assert.equal(m.length, 16, `${s}: must have 16 rows`);
    for (let y = 0; y < 16; y++) {
      assert.equal(m[y]!.length, 16, `${s}: row ${y} must have 16 columns`);
      for (let x = 0; x < 16; x++) {
        assert.equal(typeof m[y]![x], "boolean", `${s}: (${x},${y}) must be boolean`);
      }
    }
  }
});

test("silhouette: every silhouette is non-empty and not a full 16x16 rectangle (P4)", async () => {
  const { getMask } = await import("../src/textures/silhouettes.js");
  for (const s of ["diamond", "crystal-shard", "ingot", "generic-item"] as const) {
    const m = getMask(s);
    let trues = 0;
    let falses = 0;
    for (const row of m) for (const v of row) v ? trues++ : falses++;
    assert.ok(trues > 0, `${s}: must contain at least one filled pixel`);
    assert.ok(falses > 0, `${s}: must contain at least one transparent pixel`);
    assert.notEqual(trues, 256, `${s}: must not fill the entire 16x16`);
  }
});

test("silhouette: diamond and crystal-shard have all four corners transparent (P4)", async () => {
  const { getMask } = await import("../src/textures/silhouettes.js");
  for (const s of ["diamond", "crystal-shard"] as const) {
    const m = getMask(s);
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]] as const) {
      assert.equal(m[y]![x], false, `${s}: corner (${x},${y}) must be false`);
    }
  }
});

test("silhouette: ingot has empty top and bottom rows (P4)", async () => {
  const { getMask } = await import("../src/textures/silhouettes.js");
  const m = getMask("ingot");
  for (let y = 0; y <= 4; y++) {
    for (let x = 0; x < 16; x++) {
      assert.equal(m[y]![x], false, `ingot row ${y} col ${x} must be false`);
    }
  }
  for (let y = 11; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      assert.equal(m[y]![x], false, `ingot row ${y} col ${x} must be false`);
    }
  }
  // Mid rows (5..10) have content.
  for (let y = 5; y <= 10; y++) {
    let trueCount = 0;
    for (let x = 0; x < 16; x++) if (m[y]![x]) trueCount++;
    assert.ok(trueCount > 0, `ingot mid row ${y} must contain content`);
  }
});

// ---------- helpers ----------

function decodePngScanlines(png: Buffer, w: number, h: number): Buffer {
  let off = 8;
  let idat = Buffer.alloc(0);
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") {
      idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)]);
    }
    off += 8 + len + 4;
  }
  const raw = inflateSync(idat);
  assert.equal(raw.length, h * (1 + w * 4), "decompressed IDAT size mismatch");
  return raw;
}

function pixelAlpha(rawScanlines: Buffer, w: number, x: number, y: number): number {
  const i = y * (1 + w * 4) + 1 + x * 4 + 3;
  return rawScanlines[i]!;
}

function makeFilledRgba(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < out.length; i++) out[i] = (i * 7) & 0xff;
  return out;
}
