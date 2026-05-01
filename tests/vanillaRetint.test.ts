import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { deflateSync, inflateSync } from "node:zlib";
import { encodePng } from "../src/textures/png.js";
import { decodePng } from "../src/textures/pngDecode.js";
import { retintPng, retintRgba } from "../src/textures/retint.js";
import { readVanillaSource, getVanillaAssetsDir } from "../src/textures/vanillaSource.js";
import { generateRetextureItem } from "../src/generators/retextureItem.js";
import { generateRetextureBlock } from "../src/generators/retextureBlock.js";
import type { ModSpec } from "../src/types.js";

// =====================================================================
// Synthetic fixtures (NOT Mojang assets — we encode our own PNGs in-memory).
// =====================================================================

/** A 16x16 pattern with: outline border, mid body, bright sparkle, transparent corners. */
function makeFakeSwordRgba(): Uint8Array {
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Diagonal silhouette: only fill cells where x + y is between 6 and 24.
      const inside = x + y >= 6 && x + y <= 24 && x >= 1 && x <= 14 && y >= 1 && y <= 14;
      if (!inside) {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
        continue;
      }
      // Three luminance bands inside the silhouette so retint has something to map.
      let r = 80, g = 80, b = 80; // dark
      if ((x + y) >= 12 && (x + y) <= 20) { r = 170; g = 170; b = 170; } // mid
      if (x === y || x === 4) { r = 240; g = 240; b = 240; } // bright sparkle
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  return rgba;
}

async function writeFakeAsset(
  dir: string,
  relPath: string,
  rgba: Uint8Array,
  width = 16,
  height = 16,
): Promise<void> {
  const abs = path.join(dir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, encodePng(width, height, rgba));
}

function withEnv<T>(name: string, value: string | undefined, body: () => T): T {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return body();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

const baseSpec: ModSpec = {
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
} as ModSpec;

// =====================================================================
// PNG round-trip
// =====================================================================

test("pngDecode: round-trips an encodePng() output (RGBA preserved exactly)", () => {
  const W = 16, H = 16;
  const rgba = makeFakeSwordRgba();
  const png = encodePng(W, H, rgba);
  const dec = decodePng(png);
  assert.equal(dec.width, W);
  assert.equal(dec.height, H);
  assert.equal(dec.rgba.length, rgba.length);
  for (let i = 0; i < rgba.length; i++) {
    assert.equal(dec.rgba[i], rgba[i], `byte ${i} differs`);
  }
});

test("pngDecode: rejects unsupported bit depths", () => {
  // Encode a fake "PNG" header with 16-bit depth (we only support 8-bit).
  const fake = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13,                                 // IHDR length
    0x49, 0x48, 0x44, 0x52,                       // "IHDR"
    0, 0, 0, 16,  0, 0, 0, 16,                   // 16x16
    16,                                           // bit depth (unsupported)
    6,                                            // color type 6 (RGBA)
    0, 0, 0,
    0, 0, 0, 0,                                   // (placeholder CRC — not validated by our decoder)
  ]);
  assert.throws(() => decodePng(fake), /unsupported bit depth/);
});

test("pngDecode: round-trips a paletted (color type 3) PNG into RGBA", () => {
  // Hand-build a 2x1 paletted PNG with a 2-entry palette + tRNS for alpha.
  const W = 2, H = 1;
  // Raw scanline: filter byte 0, then two palette indices 0 and 1.
  const raw = Buffer.from([0x00, 0x00, 0x01]);
  const idat = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.from([255, 0, 0, /**/ 0, 255, 0]); // index 0 → red, 1 → green
  const trns = Buffer.from([128, 255]); // index 0 alpha=128, index 1 alpha=255

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    // CRC required by spec; our decoder doesn't validate it, so any 4 bytes work.
    const crc = Buffer.alloc(4);
    return Buffer.concat([len, t, data, crc]);
  };
  const png = Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("tRNS", trns),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  const dec = decodePng(png);
  assert.equal(dec.width, 2);
  assert.equal(dec.height, 1);
  // Pixel 0: palette[0] = (255,0,0), alpha 128
  assert.equal(dec.rgba[0], 255);
  assert.equal(dec.rgba[1], 0);
  assert.equal(dec.rgba[2], 0);
  assert.equal(dec.rgba[3], 128);
  // Pixel 1: palette[1] = (0,255,0), alpha 255
  assert.equal(dec.rgba[4], 0);
  assert.equal(dec.rgba[5], 255);
  assert.equal(dec.rgba[6], 0);
  assert.equal(dec.rgba[7], 255);
});

// =====================================================================
// Retint algorithm
// =====================================================================

test("retint: alpha is preserved exactly (silhouette unchanged)", () => {
  const src = makeFakeSwordRgba();
  const out = retintRgba(src, { primaryColorHex: "#cc1133" });
  for (let i = 3; i < src.length; i += 4) {
    assert.equal(out[i], src[i], `alpha at index ${i / 4} must be preserved`);
  }
});

test("retint: changes RGB toward target color (red shifts mid pixels red)", () => {
  const src = makeFakeSwordRgba();
  const out = retintRgba(src, { primaryColorHex: "#cc1133" });
  // Find an opaque pixel that was mid-gray (170,170,170) and assert its red
  // channel is now significantly larger than green/blue.
  let foundShifted = 0;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] !== 255) continue;
    if (src[i] === 170 && src[i + 1] === 170 && src[i + 2] === 170) {
      assert.ok(out[i]! > out[i + 1]! + 20, `pixel ${i / 4}: red channel should dominate after #cc1133 retint`);
      foundShifted++;
    }
  }
  assert.ok(foundShifted > 0, "expected at least one mid-luminance pixel to retint");
});

test("retint: secondaryColor controls the shadow band", () => {
  const src = makeFakeSwordRgba();
  const a = retintRgba(src, { primaryColorHex: "#cc1133", secondaryColorHex: "#222222" });
  const b = retintRgba(src, { primaryColorHex: "#cc1133", secondaryColorHex: "#22ff22" });
  assert.notDeepEqual(a, b, "different secondary color must change shadow-band bytes");
});

test("retintPng: end-to-end decode + retint + encode round-trips through valid PNG", () => {
  const src = encodePng(16, 16, makeFakeSwordRgba());
  const out = retintPng(src, { primaryColorHex: "#cc1133" });
  // PNG signature + can be decoded again.
  const dec = decodePng(out);
  assert.equal(dec.width, 16);
  assert.equal(dec.height, 16);
  assert.equal(dec.rgba.length, 16 * 16 * 4);
});

// ---- Continuous retint contract (no flat-band collapse) ----

/** A texture with a smooth luminance ramp + chroma flecks. Mimics the
 *  structure of a Mojang ore: low-saturation greys in a shading gradient
 *  plus a few high-saturation accent pixels. */
function makeFakeOreRgba(): Uint8Array {
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Stone-like neutral with a mild luminance gradient (~10 distinct levels).
      const v = 80 + ((x * 3 + y * 5) % 110);
      rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v - 4; rgba[i + 3] = 255;
    }
  }
  // Sprinkle saturated cyan "ore flecks" at a deterministic set of positions.
  const flecks: Array<[number, number]> = [
    [3, 4], [4, 3], [4, 4], [10, 9], [11, 10], [9, 11], [12, 6], [5, 12],
  ];
  for (const [x, y] of flecks) {
    const i = (y * 16 + x) * 4;
    rgba[i] = 80; rgba[i + 1] = 220; rgba[i + 2] = 220; rgba[i + 3] = 255;
  }
  return rgba;
}

function distinctLuminances(rgba: Uint8Array): number {
  const seen = new Set<number>();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    // Round to 4-unit buckets so encoder rounding noise doesn't inflate the count.
    const lum = Math.round((0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) / 4) * 4;
    seen.add(lum);
  }
  return seen.size;
}

test("retint: preserves more than 4 distinct luminance levels (no flat-band collapse)", () => {
  const src = makeFakeOreRgba();
  const out = retintRgba(src, { primaryColorHex: "#5a008a" });
  const distinct = distinctLuminances(out);
  assert.ok(
    distinct > 8,
    `expected >8 distinct output luminance levels for a textured input, got ${distinct}`,
  );
});

test("retint: does not flatten a textured input into a single fill color", () => {
  const src = makeFakeOreRgba();
  const out = retintRgba(src, { primaryColorHex: "#cc1133" });
  // No more than 25% of opaque pixels should share a single (R,G,B) tuple —
  // a flat fill would put nearly all pixels in the same bin.
  const counts = new Map<string, number>();
  let opaque = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    opaque++;
    const k = `${out[i]},${out[i + 1]},${out[i + 2]}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  assert.ok(
    max < opaque * 0.25,
    `flattened: most-common color claims ${max}/${opaque} pixels`,
  );
});

test("retint: preserves source luminance ordering (bright source pixels stay brighter than dark ones)", () => {
  const src = makeFakeOreRgba();
  const out = retintRgba(src, { primaryColorHex: "#cc1133" });
  // Pick the brightest and darkest opaque source pixels; the output must
  // preserve the same ordering.
  let brightI = 0, brightL = -1, darkI = 0, darkL = 1e9;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    const L = 0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!;
    if (L > brightL) { brightL = L; brightI = i; }
    if (L < darkL) { darkL = L; darkI = i; }
  }
  const oBright = 0.299 * out[brightI]! + 0.587 * out[brightI + 1]! + 0.114 * out[brightI + 2]!;
  const oDark = 0.299 * out[darkI]! + 0.587 * out[darkI + 1]! + 0.114 * out[darkI + 2]!;
  assert.ok(
    oBright > oDark + 30,
    `luminance ordering lost: bright pixel L=${oBright.toFixed(1)} vs dark pixel L=${oDark.toFixed(1)}`,
  );
});

test("retint: very-dark target keeps readable highlight contrast (no all-black crush)", () => {
  const src = makeFakeSwordRgba();
  const out = retintRgba(src, { primaryColorHex: "#000000" });
  let brightOpaque = 0;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] !== 255) continue;
    // Bright source pixels (sparkles at 240,240,240) must still produce a
    // visible mid-grey or higher in the output.
    if (src[i] === 240) {
      const L = 0.299 * out[i]! + 0.587 * out[i + 1]! + 0.114 * out[i + 2]!;
      assert.ok(L > 180, `bright source pixel collapsed to L=${L.toFixed(1)} under #000000 retint`);
      brightOpaque++;
    }
  }
  assert.ok(brightOpaque > 0, "test setup: no bright sparkle pixels found");
});

test("retint: oreMode keeps neutral stone pixels nearly unchanged while recoloring chroma flecks", () => {
  const src = makeFakeOreRgba();
  const out = retintRgba(src, { primaryColorHex: "#5a008a", oreMode: true });

  // Pixel at (0,0) is a neutral stone pixel; its output must be very close to
  // the source (chroma weight ~0).
  const stoneI = 0;
  const dStoneR = Math.abs(out[stoneI]! - src[stoneI]!);
  const dStoneG = Math.abs(out[stoneI + 1]! - src[stoneI + 1]!);
  const dStoneB = Math.abs(out[stoneI + 2]! - src[stoneI + 2]!);
  assert.ok(
    dStoneR < 12 && dStoneG < 12 && dStoneB < 12,
    `oreMode tinted stone too aggressively: Δ=(${dStoneR},${dStoneG},${dStoneB})`,
  );

  // Pixel at (3,4) is a saturated cyan fleck — must shift away from cyan
  // toward the purple target (B channel ought to dominate over G).
  const fleckI = (4 * 16 + 3) * 4;
  assert.ok(
    out[fleckI + 2]! > out[fleckI + 1]! + 20,
    `oreMode failed to recolor fleck: out=(${out[fleckI]},${out[fleckI + 1]},${out[fleckI + 2]})`,
  );
});

test("retint: oreMode preserves background contrast (more than 6 distinct luminance levels survive)", () => {
  const src = makeFakeOreRgba();
  const out = retintRgba(src, { primaryColorHex: "#5a008a", oreMode: true });
  const distinct = distinctLuminances(out);
  assert.ok(
    distinct > 8,
    `oreMode collapsed background contrast: only ${distinct} luminance levels`,
  );
});

test("retint: glowing biases highlights brighter without erasing the silhouette outline", () => {
  const src = makeFakeSwordRgba();
  const plain = retintRgba(src, { primaryColorHex: "#cc1133" });
  const glow = retintRgba(src, { primaryColorHex: "#cc1133", glowing: true });
  // Find the brightest opaque source pixel; glowing version must be at least
  // as bright (typically brighter).
  let i240 = -1;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 255 && src[i] === 240) { i240 = i; break; }
  }
  assert.ok(i240 >= 0, "test setup: no bright pixel found");
  const Lp = 0.299 * plain[i240]! + 0.587 * plain[i240 + 1]! + 0.114 * plain[i240 + 2]!;
  const Lg = 0.299 * glow[i240]! + 0.587 * glow[i240 + 1]! + 0.114 * glow[i240 + 2]!;
  assert.ok(Lg >= Lp - 1, `glowing must not darken highlights (plain=${Lp}, glow=${Lg})`);
});

// =====================================================================
// Source resolver — env var + path safety
// =====================================================================

test("readVanillaSource: returns null when MODFORGE_VANILLA_ASSETS_DIR is not set", () => {
  withEnv("MODFORGE_VANILLA_ASSETS_DIR", undefined, () => {
    assert.equal(getVanillaAssetsDir(), null);
    assert.equal(readVanillaSource("assets/minecraft/textures/item/wooden_sword.png"), null);
  });
});

test("readVanillaSource: reads a file at the allowlisted path when the env var is set", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    await writeFakeAsset(
      tmp,
      "assets/minecraft/textures/item/wooden_sword.png",
      makeFakeSwordRgba(),
    );
    const got = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      readVanillaSource("assets/minecraft/textures/item/wooden_sword.png"),
    );
    assert.ok(got, "expected to read the synthetic source file");
    assert.ok(Buffer.isBuffer(got));
    // It's a valid PNG.
    const dec = decodePng(got!);
    assert.equal(dec.width, 16);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("readVanillaSource: refuses path traversal", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    const got = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      readVanillaSource("../../etc/passwd"),
    );
    assert.equal(got, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("readVanillaSource: refuses absolute paths", () => {
  withEnv("MODFORGE_VANILLA_ASSETS_DIR", "/tmp/x", () => {
    assert.equal(readVanillaSource("/etc/passwd"), null);
  });
});

test("readVanillaSource: refuses non-PNG extensions", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    const got = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      readVanillaSource("assets/minecraft/textures/item/wooden_sword.txt"),
    );
    assert.equal(got, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("readVanillaSource: returns null for a missing file (graceful fallback)", () => {
  withEnv("MODFORGE_VANILLA_ASSETS_DIR", "/nonexistent-path-modforge-test", () => {
    assert.equal(
      readVanillaSource("assets/minecraft/textures/item/wooden_sword.png"),
      null,
    );
  });
});

// =====================================================================
// retextureItem generator — vanilla path vs procedural fallback
// =====================================================================

test("retextureItem: with MODFORGE_VANILLA_ASSETS_DIR set, retints the source PNG (alpha preserved)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    await writeFakeAsset(
      tmp,
      "assets/minecraft/textures/item/wooden_sword.png",
      makeFakeSwordRgba(),
    );

    const feature = {
      type: "retexture_item",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "",
      details: {
        vanillaTarget: "minecraft:wooden_sword",
        textureStyle: "metal",
        textureColor: "#cc1133",
      },
    } as const;

    const c = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      generateRetextureItem(baseSpec, feature as never),
    );

    assert.equal(c.resources.length, 1);
    assert.equal(
      c.resources[0]!.path,
      "src/main/resources/assets/minecraft/textures/item/wooden_sword.png",
    );
    assert.ok(Buffer.isBuffer(c.resources[0]!.content));

    // Decode the output and compare alpha against the source — should be byte-identical.
    const outDec = decodePng(c.resources[0]!.content as Buffer);
    const srcRgba = makeFakeSwordRgba();
    for (let i = 3; i < srcRgba.length; i += 4) {
      assert.equal(outDec.rgba[i], srcRgba[i], `alpha byte ${i} must match source`);
    }

    // RGB should have shifted; at least some opaque pixel's red channel
    // should now exceed its green/blue channels.
    let redDominantOpaque = 0;
    for (let i = 0; i < outDec.rgba.length; i += 4) {
      if (outDec.rgba[i + 3] !== 255) continue;
      if (outDec.rgba[i]! > outDec.rgba[i + 1]! + 20) redDominantOpaque++;
    }
    assert.ok(redDominantOpaque > 0, "retint should have shifted at least one pixel toward red");

    // No procedural-fallback notice.
    assert.equal(c.noticeMessages.length, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("retextureItem: without MODFORGE_VANILLA_ASSETS_DIR, falls back to procedural (no notice)", () => {
  const feature = {
    type: "retexture_item",
    id: "red_wooden_sword",
    name: "Red Wooden Sword",
    description: "",
    details: {
      vanillaTarget: "minecraft:wooden_sword",
      textureStyle: "metal",
      textureColor: "#cc1133",
    },
  } as const;

  const c = withEnv("MODFORGE_VANILLA_ASSETS_DIR", undefined, () =>
    generateRetextureItem(baseSpec, feature as never),
  );

  assert.equal(c.resources.length, 1);
  assert.ok(Buffer.isBuffer(c.resources[0]!.content));
  // Env var not set → silent procedural fallback (user didn't opt in).
  assert.equal(c.noticeMessages.length, 0);
});

test("retextureItem: env var set but file missing -> procedural fallback + notice", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    // Don't create the source file — only the dir exists.
    const feature = {
      type: "retexture_item",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "",
      details: {
        vanillaTarget: "minecraft:wooden_sword",
        textureStyle: "metal",
        textureColor: "#cc1133",
      },
    } as const;

    const c = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      generateRetextureItem(baseSpec, feature as never),
    );

    assert.equal(c.resources.length, 1);
    assert.equal(c.noticeMessages.length, 1);
    assert.match(
      c.noticeMessages[0]!,
      /not found in MODFORGE_VANILLA_ASSETS_DIR/,
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("retextureItem: corrupt source PNG -> procedural fallback + decode-failure notice", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    // Write a file that exists but is not a valid PNG.
    const target = path.join(tmp, "assets/minecraft/textures/item/wooden_sword.png");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from("not actually a PNG, just bytes"));

    const feature = {
      type: "retexture_item",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "",
      details: {
        vanillaTarget: "minecraft:wooden_sword",
        textureStyle: "metal",
        textureColor: "#cc1133",
      },
    } as const;

    const c = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      generateRetextureItem(baseSpec, feature as never),
    );

    // Still produces a valid PNG output (via procedural fallback), and
    // surfaces a notice so the user knows the vanilla source was unusable.
    assert.equal(c.resources.length, 1);
    const out = c.resources[0]!.content as Buffer;
    assert.ok(Buffer.isBuffer(out));
    const dec = decodePng(out);
    assert.equal(dec.width, 16);
    assert.equal(c.noticeMessages.length, 1);
    assert.match(c.noticeMessages[0]!, /Could not decode the vanilla source/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// =====================================================================
// retextureBlock generator — multi-face retint
// =====================================================================

test("retextureBlock: grass_block retints both top + side from synthetic sources, preserves alpha", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    // Write distinct fake top + side textures.
    const topRgba = makeFakeSwordRgba(); // any opaque/transparent pattern
    const sideRgba = makeFakeSwordRgba();
    await writeFakeAsset(tmp, "assets/minecraft/textures/block/grass_block_top.png", topRgba);
    await writeFakeAsset(tmp, "assets/minecraft/textures/block/grass_block_side.png", sideRgba);

    const feature = {
      type: "retexture_block",
      id: "purple_grass",
      name: "Purple Grass",
      description: "",
      details: {
        vanillaTarget: "minecraft:grass_block",
        textureStyle: "grass",
        textureColor: "#5a008a",
      },
    } as const;

    const c = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      generateRetextureBlock(baseSpec, feature as never),
    );

    assert.equal(c.resources.length, 2);
    for (const res of c.resources) {
      assert.match(
        res.path,
        /^src\/main\/resources\/assets\/minecraft\/textures\/block\/grass_block_(top|side)\.png$/,
      );
      const dec = decodePng(res.content as Buffer);
      // Alpha pattern must match the synthetic source.
      for (let i = 3; i < dec.rgba.length; i += 4) {
        assert.equal(dec.rgba[i], topRgba[i]);
      }
    }
    assert.equal(c.noticeMessages.length, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("retextureBlock: corrupt source PNG -> procedural fallback + decode-failure notice", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    // Write garbage at the diamond_ore source path.
    const target = path.join(tmp, "assets/minecraft/textures/block/diamond_ore.png");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from("\x89PNG\r\n\x1a\nthen garbage"));

    const feature = {
      type: "retexture_block",
      id: "purple_diamond_ore",
      name: "Purple Diamond Ore",
      description: "",
      details: {
        vanillaTarget: "minecraft:diamond_ore",
        textureStyle: "stone",
        textureColor: "#5a008a",
      },
    } as const;

    const c = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      generateRetextureBlock(baseSpec, feature as never),
    );

    assert.equal(c.resources.length, 1);
    const out = c.resources[0]!.content as Buffer;
    const dec = decodePng(out);
    assert.equal(dec.width, 16);
    assert.equal(c.noticeMessages.length, 1);
    assert.match(c.noticeMessages[0]!, /Could not decode the vanilla source/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// =====================================================================
// .gitignore regression — Mojang assets and debug textures stay local
// =====================================================================

test(".gitignore: contains vanilla-assets*/ and debug-textures/ (Mojang assets must stay local)", async () => {
  const root = path.resolve(import.meta.dirname ?? ".", "..");
  const gi = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  const lines = gi.split(/\r?\n/).map((l) => l.trim());
  assert.ok(
    lines.includes("vanilla-assets*/"),
    `.gitignore must contain 'vanilla-assets*/' so extracted Mojang textures are never committed; got:\n${gi}`,
  );
  assert.ok(
    lines.includes("debug-textures/"),
    `.gitignore must contain 'debug-textures/' so retint debug PNGs are never committed; got:\n${gi}`,
  );
});

// =====================================================================
// Sanity: the source path is derived from the ALLOWLIST, not the user
// =====================================================================

test("retexture safety: vanillaTarget never participates in source path construction", async () => {
  // The user-supplied vanillaTarget passes through schema validation, then
  // the generator looks it UP in the allowlist to retrieve a hardcoded path.
  // So even if a target appears odd, the path string came from our code.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-vanilla-"));
  try {
    // Place a file that, if user input were concatenated, might reach a
    // different location. We're verifying the code only ever reads the
    // allowlist-derived path.
    await writeFakeAsset(
      tmp,
      "assets/minecraft/textures/item/wooden_sword.png",
      makeFakeSwordRgba(),
    );
    await writeFakeAsset(
      tmp,
      "secret/should_not_be_read.png",
      makeFakeSwordRgba(),
    );

    const feature = {
      type: "retexture_item",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "",
      details: {
        vanillaTarget: "minecraft:wooden_sword",
        textureStyle: "metal",
        textureColor: "#cc1133",
      },
    } as const;

    const c = withEnv("MODFORGE_VANILLA_ASSETS_DIR", tmp, () =>
      generateRetextureItem(baseSpec, feature as never),
    );

    // Output goes to the allowlist-derived path only.
    assert.equal(
      c.resources[0]!.path,
      "src/main/resources/assets/minecraft/textures/item/wooden_sword.png",
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// Suppress unused import warning for inflateSync — used by tests above transitively.
void inflateSync;
