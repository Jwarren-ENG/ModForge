import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  collectAllowlistTexturePaths,
  extractTexturesFromJar,
  mcAssetsIndexPath,
  mcLauncherRoot,
  mcVersionJarPath,
  mcVersionManifestPath,
  objectStorageRelPath,
  relIndexKeyForAllowlistPath,
  resolveAssetIndexId,
} from "../scripts/extractVanillaAssets.js";

test("relIndexKeyForAllowlistPath: strips leading 'assets/'", () => {
  assert.equal(
    relIndexKeyForAllowlistPath("assets/minecraft/textures/item/wooden_sword.png"),
    "minecraft/textures/item/wooden_sword.png",
  );
});

test("relIndexKeyForAllowlistPath: leaves keys without 'assets/' prefix unchanged", () => {
  assert.equal(
    relIndexKeyForAllowlistPath("minecraft/textures/item/diamond.png"),
    "minecraft/textures/item/diamond.png",
  );
});

test("relIndexKeyForAllowlistPath: normalizes Windows-style backslashes", () => {
  assert.equal(
    relIndexKeyForAllowlistPath("assets\\minecraft\\textures\\item\\wooden_sword.png"),
    "minecraft/textures/item/wooden_sword.png",
  );
});

test("objectStorageRelPath: builds <hash[0:2]>/<hash>", () => {
  assert.equal(
    objectStorageRelPath("abcd1234"),
    path.join("ab", "abcd1234"),
  );
});

test("objectStorageRelPath: rejects non-hex hashes (defense in depth)", () => {
  assert.throws(() => objectStorageRelPath("zzzz"), /bad hash/);
  assert.throws(() => objectStorageRelPath("ab/cd"), /bad hash/);
  assert.throws(() => objectStorageRelPath(""), /bad hash/);
  // @ts-expect-error — runtime guard against non-strings
  assert.throws(() => objectStorageRelPath(null), /bad hash/);
});

test("mcAssetsIndexPath: ends with assets/indexes/1.20.1.json under the launcher root", () => {
  const p = mcAssetsIndexPath();
  const root = mcLauncherRoot();
  assert.ok(p.startsWith(root), `${p} should be under ${root}`);
  assert.match(
    p,
    /assets[\\/]indexes[\\/]1\.20\.1\.json$/,
    `expected canonical 1.20.1.json filename, got ${p}`,
  );
});

test("collectAllowlistTexturePaths: includes wooden_sword + diamond + grass_block faces", () => {
  const paths = collectAllowlistTexturePaths();
  assert.ok(
    paths.includes("assets/minecraft/textures/item/wooden_sword.png"),
    "wooden_sword.png missing from collected paths",
  );
  assert.ok(
    paths.includes("assets/minecraft/textures/item/diamond.png"),
    "diamond.png missing",
  );
  assert.ok(
    paths.includes("assets/minecraft/textures/block/grass_block_top.png"),
    "grass_block_top.png missing",
  );
  assert.ok(
    paths.includes("assets/minecraft/textures/block/grass_block_side.png"),
    "grass_block_side.png missing",
  );
});

test("collectAllowlistTexturePaths: returns deduplicated, sorted, unique paths", () => {
  const paths = collectAllowlistTexturePaths();
  const sorted = [...paths].sort();
  assert.deepEqual(paths, sorted, "paths must already be sorted");
  assert.equal(new Set(paths).size, paths.length, "no duplicates");
  // Every path is under the expected texture roots.
  for (const p of paths) {
    assert.match(
      p,
      /^assets\/minecraft\/textures\/(item|block)\/[a-z0-9_]+\.png$/,
      `unexpected path shape: ${p}`,
    );
  }
});

// =====================================================================
// resolveAssetIndexId — modern launcher names asset indexes by hash id
// =====================================================================

async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "modforge-mc-"));
}

async function writeVersionManifest(
  root: string,
  versionId: string,
  body: unknown,
): Promise<void> {
  const dir = path.join(root, "versions", versionId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${versionId}.json`), JSON.stringify(body));
}

test("mcVersionManifestPath: defaults point at versions/1.20.1/1.20.1.json", () => {
  const p = mcVersionManifestPath();
  assert.match(p, /versions[\\/]1\.20\.1[\\/]1\.20\.1\.json$/);
  assert.ok(p.startsWith(mcLauncherRoot()));
});

test("mcAssetsIndexPath: uses the supplied id, not the version (regression: 1.20.1.json hardcoded)", () => {
  const p = mcAssetsIndexPath("5", "/tmp/fake-mc-root");
  assert.equal(
    p,
    path.join("/tmp", "fake-mc-root", "assets", "indexes", "5.json"),
  );
});

test("resolveAssetIndexId: reads assetIndex.id ('5') from a fake version manifest", async () => {
  const root = await tmpRoot();
  try {
    await writeVersionManifest(root, "1.20.1", {
      assetIndex: { id: "5", sha1: "deadbeef", size: 1234 },
      // ... other fields the launcher writes; we only care about assetIndex.id
    });
    assert.equal(resolveAssetIndexId(root), "5");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveAssetIndexId + mcAssetsIndexPath: resolves to assets/indexes/5.json end-to-end", async () => {
  const root = await tmpRoot();
  try {
    await writeVersionManifest(root, "1.20.1", { assetIndex: { id: "5" } });
    const id = resolveAssetIndexId(root);
    assert.equal(id, "5");
    const indexPath = mcAssetsIndexPath(id ?? "1.20.1", root);
    assert.equal(
      indexPath,
      path.join(root, "assets", "indexes", "5.json"),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveAssetIndexId: returns null when version manifest is missing", async () => {
  const root = await tmpRoot();
  try {
    assert.equal(resolveAssetIndexId(root), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveAssetIndexId: returns null when version manifest is malformed JSON", async () => {
  const root = await tmpRoot();
  try {
    const dir = path.join(root, "versions", "1.20.1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "1.20.1.json"), "not json {{{");
    assert.equal(resolveAssetIndexId(root), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveAssetIndexId: returns null when assetIndex.id is missing/wrong type", async () => {
  const root = await tmpRoot();
  try {
    await writeVersionManifest(root, "1.20.1", { someOtherField: "x" });
    assert.equal(resolveAssetIndexId(root), null);
    await writeVersionManifest(root, "1.20.1", { assetIndex: { id: 5 } }); // number, not string
    assert.equal(resolveAssetIndexId(root), null);
    await writeVersionManifest(root, "1.20.1", { assetIndex: { id: "" } });
    assert.equal(resolveAssetIndexId(root), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveAssetIndexId: rejects ids with path-unsafe characters (defense in depth)", async () => {
  const root = await tmpRoot();
  try {
    for (const badId of ["../escape", "5/x", "5\\x", "5 6", "../../etc/passwd"]) {
      await writeVersionManifest(root, "1.20.1", { assetIndex: { id: badId } });
      assert.equal(
        resolveAssetIndexId(root),
        null,
        `id "${badId}" must be rejected`,
      );
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// =====================================================================
// extractTexturesFromJar — primary source path
// =====================================================================

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localChunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const compressed = zlib.deflateRawSync(e.data);
    const crc = crc32(e.data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(e.data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    localChunks.push(lfh, nameBuf, compressed);
    const cfh = Buffer.alloc(46);
    cfh.writeUInt32LE(0x02014b50, 0);
    cfh.writeUInt16LE(20, 4);
    cfh.writeUInt16LE(20, 6);
    cfh.writeUInt16LE(8, 10);
    cfh.writeUInt32LE(crc, 16);
    cfh.writeUInt32LE(compressed.length, 20);
    cfh.writeUInt32LE(e.data.length, 24);
    cfh.writeUInt16LE(nameBuf.length, 28);
    cfh.writeUInt32LE(offset, 42);
    cdChunks.push(cfh, nameBuf);
    offset += lfh.length + nameBuf.length + compressed.length;
  }
  const localBuf = Buffer.concat(localChunks);
  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, cdBuf, eocd]);
}

test("mcVersionJarPath: defaults to versions/1.20.1/1.20.1.jar under launcher root", () => {
  const p = mcVersionJarPath();
  assert.match(p, /versions[\\/]1\.20\.1[\\/]1\.20\.1\.jar$/);
  assert.ok(p.startsWith(mcLauncherRoot()));
});

test("extractTexturesFromJar: extracts only allowlisted entries, leaves siblings on disk untouched", async () => {
  const root = await tmpRoot();
  try {
    const woodenSwordPng = Buffer.from("PNG-wooden-sword-bytes");
    const diamondPng = Buffer.from("PNG-diamond-bytes");
    const grassTopPng = Buffer.from("PNG-grass-top-bytes");
    const unrelatedPng = Buffer.from("PNG-unrelated-bytes");
    const soundFile = Buffer.from("OGG-sound-bytes");

    const jarBuf = buildZip([
      { name: "assets/minecraft/textures/item/wooden_sword.png", data: woodenSwordPng },
      { name: "assets/minecraft/textures/item/diamond.png", data: diamondPng },
      { name: "assets/minecraft/textures/block/grass_block_top.png", data: grassTopPng },
      { name: "assets/minecraft/textures/block/some_unrelated_block.png", data: unrelatedPng },
      { name: "assets/minecraft/sounds/random/click.ogg", data: soundFile },
      { name: "META-INF/MANIFEST.MF", data: Buffer.from("Manifest-Version: 1.0\n") },
    ]);

    const jarPath = path.join(root, "1.20.1.jar");
    await fs.writeFile(jarPath, jarBuf);
    const outRoot = path.join(root, "out");

    const wanted = [
      "assets/minecraft/textures/item/wooden_sword.png",
      "assets/minecraft/textures/item/diamond.png",
      "assets/minecraft/textures/block/grass_block_top.png",
      "assets/minecraft/textures/block/grass_block_side.png", // not in jar
    ];

    const result = extractTexturesFromJar(jarPath, wanted, outRoot);

    assert.equal(result.errors.length, 0);
    assert.ok(result.extracted.has("assets/minecraft/textures/item/wooden_sword.png"));
    assert.ok(result.extracted.has("assets/minecraft/textures/item/diamond.png"));
    assert.ok(result.extracted.has("assets/minecraft/textures/block/grass_block_top.png"));
    assert.ok(!result.extracted.has("assets/minecraft/textures/block/grass_block_side.png"));
    assert.equal(result.extracted.size, 3);

    const wsRead = await fs.readFile(
      path.join(outRoot, "assets/minecraft/textures/item/wooden_sword.png"),
    );
    assert.deepEqual(wsRead, woodenSwordPng);
    const diamondRead = await fs.readFile(
      path.join(outRoot, "assets/minecraft/textures/item/diamond.png"),
    );
    assert.deepEqual(diamondRead, diamondPng);

    // Defense: unrelated jar entries must NOT be written.
    await assert.rejects(
      fs.access(
        path.join(outRoot, "assets/minecraft/textures/block/some_unrelated_block.png"),
      ),
    );
    await assert.rejects(
      fs.access(path.join(outRoot, "assets/minecraft/sounds/random/click.ogg")),
    );
    await assert.rejects(
      fs.access(path.join(outRoot, "META-INF/MANIFEST.MF")),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("extractTexturesFromJar: returns empty extracted set when no allowlisted entries are in the jar", async () => {
  const root = await tmpRoot();
  try {
    const jarBuf = buildZip([
      { name: "assets/minecraft/lang/en_us.json", data: Buffer.from("{}") },
    ]);
    const jarPath = path.join(root, "1.20.1.jar");
    await fs.writeFile(jarPath, jarBuf);
    const outRoot = path.join(root, "out");
    const result = extractTexturesFromJar(
      jarPath,
      ["assets/minecraft/textures/item/wooden_sword.png"],
      outRoot,
    );
    assert.equal(result.extracted.size, 0);
    assert.equal(result.errors.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("collectAllowlistTexturePaths: contains roughly the expected number of entries", () => {
  // ~95 items + ~50 blocks (some multi-face). Sanity check: not zero, not absurd.
  const paths = collectAllowlistTexturePaths();
  assert.ok(paths.length > 100, `expected > 100 paths, got ${paths.length}`);
  assert.ok(paths.length < 300, `expected < 300 paths, got ${paths.length}`);
});
