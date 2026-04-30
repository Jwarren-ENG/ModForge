import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { encodePng } from "../src/textures/png.js";
import { generateTexturePng } from "../src/textures/index.js";

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
