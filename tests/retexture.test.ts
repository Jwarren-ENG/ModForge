import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { tryGenerateDeterministically } from "../src/generators/index.js";
import { ModSpecSchema } from "../src/schemas.js";
import type { ModSpec } from "../src/types.js";

function spec(overrides: Partial<ModSpec> = {}): ModSpec {
  return {
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
    ...overrides,
  } as ModSpec;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("retexture_item: allowlisted target produces a PNG at the vanilla path", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "retexture_item",
          id: "diamond_to_black_crystal",
          name: "Black Crystal Diamonds",
          description: "",
          details: {
            vanillaTarget: "minecraft:diamond",
            textureStyle: "crystal",
            textureColor: "#101015",
            glowing: true,
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const tex = r.files.find(
    (f) => f.path === "src/main/resources/assets/minecraft/textures/item/diamond.png",
  );
  assert.ok(tex, "expected diamond.png at the vanilla allowlist path");
  assert.ok(Buffer.isBuffer(tex.content), "PNG content must be a Buffer");
  assert.deepEqual((tex.content as Buffer).subarray(0, 8), PNG_MAGIC);
});

test("retexture_item: non-allowlisted target fails schema validation (NOT generator)", () => {
  const r = ModSpecSchema.safeParse(
    spec({
      features: [
        {
          type: "retexture_item",
          id: "x",
          name: "x",
          description: "",
          details: {
            vanillaTarget: "minecraft:dragon_egg",
            textureStyle: "gem",
            textureColor: "#ffffff",
          },
        },
      ],
    }),
  );
  assert.equal(r.success, false);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message).join("\n");
    assert.match(msg, /minecraft:dragon_egg.*not in the retexture allowlist/);
  }
});

test("retexture_item: arbitrary minecraft:* paths cannot smuggle through", () => {
  // The vanillaTarget regex restricts the SHAPE; the allowlist superRefine
  // restricts the CONTENT. Together they prevent arbitrary
  // assets/minecraft/textures/foo paths from being constructed by user input.
  const result = ModSpecSchema.safeParse(
    spec({
      features: [
        {
          type: "retexture_item",
          id: "x",
          name: "x",
          description: "",
          details: {
            vanillaTarget: "minecraft:../../etc/passwd",
            textureStyle: "gem",
            textureColor: "#ffffff",
          },
        },
      ],
    }),
  );
  assert.equal(result.success, false);
});

test("retexture_block: grass_block emits BOTH top and side PNGs by default", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "retexture_block",
          id: "purple_grass",
          name: "Purple Grass",
          description: "",
          details: {
            vanillaTarget: "minecraft:grass_block",
            textureStyle: "grass",
            textureColor: "#5a008a",
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const top = r.files.find(
    (f) => f.path === "src/main/resources/assets/minecraft/textures/block/grass_block_top.png",
  );
  const side = r.files.find(
    (f) => f.path === "src/main/resources/assets/minecraft/textures/block/grass_block_side.png",
  );
  assert.ok(top, "missing grass_block_top.png");
  assert.ok(side, "missing grass_block_side.png");
  assert.ok(Buffer.isBuffer(top.content));
  assert.ok(Buffer.isBuffer(side.content));
});

test("retexture_block: grass_block faces=['all'] expands to top + side", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "retexture_block",
          id: "purple_grass",
          name: "Purple Grass",
          description: "",
          details: {
            vanillaTarget: "minecraft:grass_block",
            textureStyle: "grass",
            textureColor: "#5a008a",
            faces: ["all"],
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const top = r.files.find((f) =>
    f.path.endsWith("/grass_block_top.png"),
  );
  const side = r.files.find((f) =>
    f.path.endsWith("/grass_block_side.png"),
  );
  assert.ok(top, "expected grass_block_top.png");
  assert.ok(side, "expected grass_block_side.png");
});

test("retexture_block: faces=['all','top'] dedupes — only top + side, no duplicate top", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "retexture_block",
          id: "purple_grass",
          name: "Purple Grass",
          description: "",
          details: {
            vanillaTarget: "minecraft:grass_block",
            textureStyle: "grass",
            textureColor: "#5a008a",
            faces: ["all", "top"],
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const tops = r.files.filter((f) => f.path.endsWith("/grass_block_top.png"));
  assert.equal(tops.length, 1, "top should appear exactly once");
});

test("retexture_block: simple block (stone) emits a single PNG", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "retexture_block",
          id: "red_stone",
          name: "Red Stone",
          description: "",
          details: {
            vanillaTarget: "minecraft:stone",
            textureStyle: "stone",
            textureColor: "#aa1122",
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const stone = r.files.find(
    (f) => f.path === "src/main/resources/assets/minecraft/textures/block/stone.png",
  );
  assert.ok(stone);
});

test("retexture_block: bad face for grass_block fails schema validation", () => {
  const result = ModSpecSchema.safeParse(
    spec({
      features: [
        {
          type: "retexture_block",
          id: "x",
          name: "x",
          description: "",
          details: {
            vanillaTarget: "minecraft:grass_block",
            textureStyle: "grass",
            textureColor: "#5a008a",
            faces: ["bottom"], // grass_block doesn't allow bottom
          },
        },
      ],
    }),
  );
  assert.equal(result.success, false);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join("\n");
    // Friendly grass_block-specific guidance (covers the dirt-vs-grass case).
    assert.match(msg, /grass_block supports top, side, or all/);
  }
});

// =====================================================================
// Milestone 3.7 — broad vanilla retexture coverage
// =====================================================================

test("schema: accepts retexture_item for every weapon/tool material variant", () => {
  const tools = ["sword", "pickaxe", "axe", "shovel", "hoe"] as const;
  const materials = ["wooden", "stone", "iron", "golden", "diamond", "netherite"] as const;
  for (const m of materials) {
    for (const t of tools) {
      const r = ModSpecSchema.safeParse(
        spec({
          features: [
            {
              type: "retexture_item",
              id: `${m}_${t}_color`,
              name: `${m} ${t}`,
              description: "",
              details: {
                vanillaTarget: `minecraft:${m}_${t}`,
                textureStyle: "metal",
                textureColor: "#aa1133",
              },
            },
          ],
        }),
      );
      assert.equal(r.success, true, `expected ${m}_${t} to be allowlisted`);
    }
  }
});

test("schema: accepts retexture_item for full armor sets", () => {
  const materials = ["leather", "iron", "golden", "diamond", "netherite"];
  const slots = ["helmet", "chestplate", "leggings", "boots"];
  for (const m of materials) {
    for (const s of slots) {
      const r = ModSpecSchema.safeParse(
        spec({
          features: [
            {
              type: "retexture_item",
              id: `${m}_${s}_color`,
              name: `${m} ${s}`,
              description: "",
              details: {
                vanillaTarget: `minecraft:${m}_${s}`,
                textureStyle: "metal",
                textureColor: "#aa1133",
              },
            },
          ],
        }),
      );
      assert.equal(r.success, true, `expected ${m}_${s} to be allowlisted`);
    }
  }
});

test("schema: accepts deepslate ore variants for retexture_block", () => {
  const variants = [
    "deepslate_coal_ore",
    "deepslate_iron_ore",
    "deepslate_copper_ore",
    "deepslate_gold_ore",
    "deepslate_redstone_ore",
    "deepslate_lapis_ore",
    "deepslate_diamond_ore",
    "deepslate_emerald_ore",
  ];
  for (const v of variants) {
    const r = ModSpecSchema.safeParse(
      spec({
        features: [
          {
            type: "retexture_block",
            id: `${v}_color`,
            name: v,
            description: "",
            details: {
              vanillaTarget: `minecraft:${v}`,
              textureStyle: "stone",
              textureColor: "#5a008a",
            },
          },
        ],
      }),
    );
    assert.equal(r.success, true, `expected ${v} to be allowlisted`);
  }
});

test("schema: accepts every wood plank variant for retexture_block", () => {
  const planks = [
    "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
    "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks",
  ];
  for (const p of planks) {
    const r = ModSpecSchema.safeParse(
      spec({
        features: [
          {
            type: "retexture_block",
            id: `${p}_color`,
            name: p,
            description: "",
            details: {
              vanillaTarget: `minecraft:${p}`,
              textureStyle: "plain",
              textureColor: "#1144aa",
            },
          },
        ],
      }),
    );
    assert.equal(r.success, true, `expected ${p} to be allowlisted`);
  }
});

test("schema: still rejects targets outside the expanded allowlist", () => {
  // dragon_egg, bedrock_egg, custom_block etc. should still fail.
  for (const target of ["minecraft:dragon_egg", "minecraft:beacon", "minecraft:totem_of_undying"]) {
    const r = ModSpecSchema.safeParse(
      spec({
        features: [
          {
            type: "retexture_item",
            id: "x",
            name: "x",
            description: "",
            details: {
              vanillaTarget: target,
              textureStyle: "gem",
              textureColor: "#ffffff",
            },
          },
        ],
      }),
    );
    assert.equal(r.success, false, `expected ${target} to be rejected`);
  }
});

test('"make wooden sword red" generator path -> assets/minecraft/textures/item/wooden_sword.png', async () => {
  const { generateRetextureItem } = await import("../src/generators/retextureItem.js");
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
  const c = generateRetextureItem(spec() as never, feature as never);
  assert.equal(c.resources.length, 1);
  assert.equal(
    c.resources[0]!.path,
    "src/main/resources/assets/minecraft/textures/item/wooden_sword.png",
  );
  assert.ok(Buffer.isBuffer(c.resources[0]!.content));
});

test('"make diamond sword black" generator path -> assets/minecraft/textures/item/diamond_sword.png', async () => {
  const { generateRetextureItem } = await import("../src/generators/retextureItem.js");
  const feature = {
    type: "retexture_item",
    id: "black_diamond_sword",
    name: "Black Diamond Sword",
    description: "",
    details: {
      vanillaTarget: "minecraft:diamond_sword",
      textureStyle: "metal",
      textureColor: "#101015",
    },
  } as const;
  const c = generateRetextureItem(spec() as never, feature as never);
  assert.equal(c.resources.length, 1);
  assert.equal(
    c.resources[0]!.path,
    "src/main/resources/assets/minecraft/textures/item/diamond_sword.png",
  );
});

test('"make diamond ore purple" generator path -> assets/minecraft/textures/block/diamond_ore.png', async () => {
  const { generateRetextureBlock } = await import("../src/generators/retextureBlock.js");
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
  const c = generateRetextureBlock(spec() as never, feature as never);
  assert.equal(c.resources.length, 1);
  assert.equal(
    c.resources[0]!.path,
    "src/main/resources/assets/minecraft/textures/block/diamond_ore.png",
  );
});

test('oak_log retexture writes top + side textures by default', async () => {
  const { generateRetextureBlock } = await import("../src/generators/retextureBlock.js");
  const feature = {
    type: "retexture_block",
    id: "blue_oak_log",
    name: "Blue Oak Log",
    description: "",
    details: {
      vanillaTarget: "minecraft:oak_log",
      textureStyle: "stone",
      textureColor: "#1144aa",
    },
  } as const;
  const c = generateRetextureBlock(spec() as never, feature as never);
  const paths = c.resources.map((r) => r.path).sort();
  assert.deepEqual(paths, [
    "src/main/resources/assets/minecraft/textures/block/oak_log.png",
    "src/main/resources/assets/minecraft/textures/block/oak_log_top.png",
  ]);
});

// =====================================================================
// 3.7 patch — path correctness invariants + ineffective-target removals
// =====================================================================

test("allowlist invariant: every vanilla item path lives under assets/minecraft/textures/item/", async () => {
  const { VANILLA_ITEM_TARGETS } = await import("../src/textures/vanillaTargets.js");
  for (const [key, target] of Object.entries(VANILLA_ITEM_TARGETS)) {
    assert.match(
      target.texturePath,
      /^assets\/minecraft\/textures\/item\/[a-z0-9_]+\.png$/,
      `item target ${key} has invalid path "${target.texturePath}"`,
    );
  }
});

test("allowlist invariant: every vanilla block face path lives under assets/minecraft/textures/block/", async () => {
  const { VANILLA_BLOCK_TARGETS } = await import("../src/textures/vanillaTargets.js");
  for (const [key, target] of Object.entries(VANILLA_BLOCK_TARGETS)) {
    for (const [face, p] of Object.entries(target.texturePaths)) {
      assert.match(
        p as string,
        /^assets\/minecraft\/textures\/block\/[a-z0-9_]+\.png$/,
        `block target ${key} face "${face}" has invalid path "${p}"`,
      );
    }
  }
});

test("allowlist invariant: ineffective targets are NOT in the simple item allowlist", async () => {
  // shield is entity-backed; compass/clock are multi-frame animations. Until we
  // properly model per-frame/entity textures, allowlisting these would silently
  // accept retextures that have no in-game effect.
  const { isVanillaItemTarget } = await import("../src/textures/vanillaTargets.js");
  for (const target of ["minecraft:shield", "minecraft:compass", "minecraft:clock"]) {
    assert.equal(
      isVanillaItemTarget(target),
      false,
      `${target} must NOT be in the simple item allowlist`,
    );
  }
});

test("schema: shield/compass/clock retextures fail validation with the allowlist message", () => {
  for (const target of ["minecraft:shield", "minecraft:compass", "minecraft:clock"]) {
    const r = ModSpecSchema.safeParse(
      spec({
        features: [
          {
            type: "retexture_item",
            id: "x",
            name: "x",
            description: "",
            details: {
              vanillaTarget: target,
              textureStyle: "metal",
              textureColor: "#aabbcc",
            },
          },
        ],
      }),
    );
    assert.equal(r.success, false, `${target} must be rejected`);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join("\n");
      assert.match(msg, /not in the retexture allowlist/);
    }
  }
});

test('tool silhouettes: sword retexture has transparent corners and is sword-shaped', async () => {
  const { generateRetextureItem } = await import("../src/generators/retextureItem.js");
  const { inflateSync } = await import("node:zlib");
  const feature = {
    type: "retexture_item",
    id: "red_sword",
    name: "Red Sword",
    description: "",
    details: {
      vanillaTarget: "minecraft:wooden_sword",
      textureStyle: "metal",
      textureColor: "#cc1133",
    },
  } as const;
  const c = generateRetextureItem(spec() as never, feature as never);
  const png = c.resources[0]!.content as Buffer;

  // Decode to verify the silhouette has transparent corners and isn't a flat rectangle.
  let off = 8;
  let idat = Buffer.alloc(0);
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)]);
    off += 8 + len + 4;
  }
  const raw = inflateSync(idat);
  const W = 16, H = 16;

  // Bottom-right corner is empty (sword tip is upper-right, hilt lower-left, corners free).
  const cornerAlpha = (x: number, y: number) =>
    raw[y * (1 + W * 4) + 1 + x * 4 + 3]!;
  // Sword silhouette doesn't fill (0,0). It also doesn't fill (15, 15).
  assert.equal(cornerAlpha(0, 0), 0, "(0,0) must be transparent for a sword silhouette");
  assert.equal(cornerAlpha(15, 15), 0, "(15,15) must be transparent for a sword silhouette");

  // Tip is around (13,1)..(14,2) — should be opaque.
  assert.equal(cornerAlpha(13, 1), 255, "sword tip area should be opaque");

  // Density check: the silhouette is thin, so opacity should be < 50% of canvas.
  let opaque = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (cornerAlpha(x, y) === 255) opaque++;
    }
  }
  assert.ok(opaque < W * H * 0.55, `expected thin sword silhouette; got ${opaque}/${W * H} opaque`);
});

/**
 * Shared helper: decode a retexture_item PNG, return per-pixel alpha + opaque count.
 * Same chunk-walking + zlib inflate the sword test uses.
 */
async function decodeToolPng(target: string) {
  const { generateRetextureItem } = await import("../src/generators/retextureItem.js");
  const { inflateSync } = await import("node:zlib");
  const feature = {
    type: "retexture_item",
    id: target.replace("minecraft:", "x_"),
    name: target,
    description: "",
    details: {
      vanillaTarget: target,
      textureStyle: "metal",
      textureColor: "#888a8c",
    },
  } as const;
  const c = generateRetextureItem(spec() as never, feature as never);
  const png = c.resources[0]!.content as Buffer;

  let off = 8;
  let idat = Buffer.alloc(0);
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)]);
    off += 8 + len + 4;
  }
  const raw = inflateSync(idat);
  const W = 16, H = 16;
  const alphaAt = (x: number, y: number) =>
    raw[y * (1 + W * 4) + 1 + x * 4 + 3]!;
  let opaque = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alphaAt(x, y) === 255) opaque++;
    }
  }
  return { contribution: c, raw, alphaAt, opaque, total: W * H };
}

test("tool silhouettes: pickaxe retexture has the right path + thin silhouette + transparent corners", async () => {
  const { contribution, alphaAt, opaque, total } = await decodeToolPng("minecraft:wooden_pickaxe");
  assert.equal(
    contribution.resources[0]!.path,
    "src/main/resources/assets/minecraft/textures/item/wooden_pickaxe.png",
  );
  assert.ok(Buffer.isBuffer(contribution.resources[0]!.content));
  // Pickaxe head sits along the top, handle runs to lower-left. Top-left + bottom-right
  // corners are not part of the silhouette.
  assert.equal(alphaAt(0, 0), 0, "(0,0) must be transparent");
  assert.equal(alphaAt(15, 15), 0, "(15,15) must be transparent");
  assert.ok(opaque > 0, "silhouette must not be empty");
  assert.ok(opaque < total * 0.55, `expected thin pickaxe silhouette; got ${opaque}/${total} opaque`);
});

test("tool silhouettes: axe retexture has the right path + thin silhouette + transparent corners", async () => {
  const { contribution, alphaAt, opaque, total } = await decodeToolPng("minecraft:wooden_axe");
  assert.equal(
    contribution.resources[0]!.path,
    "src/main/resources/assets/minecraft/textures/item/wooden_axe.png",
  );
  assert.equal(alphaAt(0, 0), 0);
  assert.equal(alphaAt(15, 15), 0);
  assert.ok(opaque > 0);
  assert.ok(opaque < total * 0.55, `expected thin axe silhouette; got ${opaque}/${total} opaque`);
});

test("tool silhouettes: shovel retexture has the right path + thin silhouette + transparent corners", async () => {
  const { contribution, alphaAt, opaque, total } = await decodeToolPng("minecraft:wooden_shovel");
  assert.equal(
    contribution.resources[0]!.path,
    "src/main/resources/assets/minecraft/textures/item/wooden_shovel.png",
  );
  assert.equal(alphaAt(0, 0), 0);
  assert.equal(alphaAt(15, 15), 0);
  assert.ok(opaque > 0);
  assert.ok(opaque < total * 0.55, `expected thin shovel silhouette; got ${opaque}/${total} opaque`);
});

test("tool silhouettes: hoe retexture has the right path + thin silhouette + transparent corners", async () => {
  const { contribution, alphaAt, opaque, total } = await decodeToolPng("minecraft:wooden_hoe");
  assert.equal(
    contribution.resources[0]!.path,
    "src/main/resources/assets/minecraft/textures/item/wooden_hoe.png",
  );
  assert.equal(alphaAt(0, 0), 0);
  assert.equal(alphaAt(15, 15), 0);
  assert.ok(opaque > 0);
  assert.ok(opaque < total * 0.55, `expected thin hoe silhouette; got ${opaque}/${total} opaque`);
});

// =====================================================================
// 3.7-patch — luminance-preserving retint behavior
// =====================================================================

test("retint: changing textureColor changes RGB but preserves the alpha silhouette exactly", async () => {
  const renderWooden = async (color: string) => {
    const c = await decodeToolPng("minecraft:wooden_sword");
    // decodeToolPng uses a fixed color; build a fresh decode for THIS color.
    const { generateRetextureItem } = await import("../src/generators/retextureItem.js");
    const { inflateSync } = await import("node:zlib");
    const feature = {
      type: "retexture_item",
      id: "x",
      name: "x",
      description: "",
      details: {
        vanillaTarget: "minecraft:wooden_sword",
        textureStyle: "metal",
        textureColor: color,
      },
    } as const;
    const contrib = generateRetextureItem(spec() as never, feature as never);
    const png = contrib.resources[0]!.content as Buffer;
    let off = 8;
    let idat = Buffer.alloc(0);
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      const type = png.subarray(off + 4, off + 8).toString("ascii");
      if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)]);
      off += 8 + len + 4;
    }
    void c;
    return inflateSync(idat);
  };

  const red = await renderWooden("#cc1133");
  const blue = await renderWooden("#1133cc");

  const W = 16, H = 16;
  let alphaMatchCount = 0;
  let differentRgbCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * (1 + W * 4) + 1 + x * 4;
      const aR = red[i + 3]!;
      const aB = blue[i + 3]!;
      // Alpha pattern (the silhouette) must be byte-identical regardless of color.
      assert.equal(aR, aB, `alpha mismatch at (${x},${y}): red=${aR} blue=${aB}`);
      if (aR === aB) alphaMatchCount++;
      if (aR === 255) {
        const sameRgb = red[i] === blue[i] && red[i + 1] === blue[i + 1] && red[i + 2] === blue[i + 2];
        if (!sameRgb) differentRgbCount++;
      }
    }
  }
  assert.equal(alphaMatchCount, W * H, "every alpha byte must match exactly");
  assert.ok(
    differentRgbCount > 20,
    `expected color change to repaint many pixels; got ${differentRgbCount} differing RGB pixels`,
  );
});

test("retint: wooden_sword has multiple distinct shade bands (not a flat fill)", async () => {
  const { contribution, alphaAt } = await decodeToolPng("minecraft:wooden_sword");
  const png = contribution.resources[0]!.content as Buffer;
  // Decode again to walk pixel data; reuse the helper's decoded raw via a fresh inline.
  const { inflateSync } = await import("node:zlib");
  let off = 8;
  let idat = Buffer.alloc(0);
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat = Buffer.concat([idat, png.subarray(off + 8, off + 8 + len)]);
    off += 8 + len + 4;
  }
  const raw = inflateSync(idat);
  const W = 16, H = 16;
  const distinctRgb = new Set<string>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alphaAt(x, y) === 0) continue;
      const i = y * (1 + W * 4) + 1 + x * 4;
      distinctRgb.add(`${raw[i]!},${raw[i + 1]!},${raw[i + 2]!}`);
    }
  }
  // 4-tone retint: outline / highlight ring / shadow ring / interior
  // = at least 3 (silhouettes too small to always exhibit all 4).
  assert.ok(
    distinctRgb.size >= 3,
    `expected >= 3 distinct shade bands on wooden_sword; got ${distinctRgb.size}`,
  );
});

test("retint: secondaryColor controls the shadow ring (different secondary -> different bytes)", async () => {
  const { generateRetextureItem } = await import("../src/generators/retextureItem.js");
  const make = (sec?: string) => {
    const feature = {
      type: "retexture_item",
      id: "x",
      name: "x",
      description: "",
      details: {
        vanillaTarget: "minecraft:wooden_sword",
        textureStyle: "metal",
        textureColor: "#cc1133",
        ...(sec ? { secondaryColor: sec } : {}),
      },
    } as const;
    return (generateRetextureItem(spec() as never, feature as never).resources[0]!.content) as Buffer;
  };
  const a = make("#222222");
  const b = make("#22ff22");
  assert.notDeepEqual(
    a,
    b,
    "different secondaryColor must change shadow-ring bytes in the retinted output",
  );
});

test("retint: same inputs are deterministic (procedural fallback is stable)", async () => {
  const { generateRetextureItem } = await import("../src/generators/retextureItem.js");
  const feature = {
    type: "retexture_item",
    id: "x",
    name: "x",
    description: "",
    details: {
      vanillaTarget: "minecraft:wooden_sword",
      textureStyle: "metal",
      textureColor: "#cc1133",
    },
  } as const;
  const a = (generateRetextureItem(spec() as never, feature as never).resources[0]!.content) as Buffer;
  const b = (generateRetextureItem(spec() as never, feature as never).resources[0]!.content) as Buffer;
  assert.deepEqual(a, b, "deterministic procedural fallback");
});

test("schema: duplicate retexture_item targets fail validation", () => {
  const r = ModSpecSchema.safeParse(
    spec({
      features: [
        {
          type: "retexture_item",
          id: "a",
          name: "a",
          description: "",
          details: {
            vanillaTarget: "minecraft:diamond",
            textureStyle: "crystal",
            textureColor: "#101015",
          },
        },
        {
          type: "retexture_item",
          id: "b",
          name: "b",
          description: "",
          details: {
            vanillaTarget: "minecraft:diamond",
            textureStyle: "gem",
            textureColor: "#ffffff",
          },
        },
      ],
    }),
  );
  assert.equal(r.success, false);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message).join("\n");
    assert.match(msg, /duplicate retexture_item target "minecraft:diamond"/);
  }
});

test("schema: overlapping retexture_block faces on same target fail validation", () => {
  const r = ModSpecSchema.safeParse(
    spec({
      features: [
        {
          type: "retexture_block",
          id: "a",
          name: "a",
          description: "",
          details: {
            vanillaTarget: "minecraft:grass_block",
            textureStyle: "grass",
            textureColor: "#5a008a",
            faces: ["top"],
          },
        },
        {
          type: "retexture_block",
          id: "b",
          name: "b",
          description: "",
          details: {
            vanillaTarget: "minecraft:grass_block",
            textureStyle: "grass",
            textureColor: "#aa00cc",
            faces: ["top", "side"],
          },
        },
      ],
    }),
  );
  assert.equal(r.success, false);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message).join("\n");
    assert.match(msg, /duplicate retexture_block target "minecraft:grass_block" face "top"/);
  }
});

test("schema: duplicate face within a single retexture_block feature fails validation", () => {
  const r = ModSpecSchema.safeParse(
    spec({
      features: [
        {
          type: "retexture_block",
          id: "a",
          name: "a",
          description: "",
          details: {
            vanillaTarget: "minecraft:grass_block",
            textureStyle: "grass",
            textureColor: "#5a008a",
            faces: ["top", "top"],
          },
        },
      ],
    }),
  );
  assert.equal(r.success, false);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message).join("\n");
    assert.match(msg, /duplicate face "top"/);
  }
});

test("retexture: never produces paths outside assets/minecraft/textures/{item,block}/", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "retexture_item",
          id: "a",
          name: "a",
          description: "",
          details: {
            vanillaTarget: "minecraft:diamond",
            textureStyle: "crystal",
            textureColor: "#101015",
          },
        },
        {
          type: "retexture_block",
          id: "b",
          name: "b",
          description: "",
          details: {
            vanillaTarget: "minecraft:grass_block",
            textureStyle: "grass",
            textureColor: "#5a008a",
          },
        },
      ],
    }),
  );
  for (const f of r.files) {
    if (!f.path.includes("assets/minecraft/")) continue;
    assert.match(
      f.path,
      /^src\/main\/resources\/assets\/minecraft\/textures\/(item|block)\/[a-z_]+\.png$/,
      `unexpected vanilla path: ${f.path}`,
    );
  }
});

test("original item with textureColor produces a PNG", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "item",
          id: "void_crystal",
          name: "Void Crystal",
          description: "",
          details: {
            textureStyle: "crystal",
            textureColor: "#3a004f",
            glowing: true,
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const png = r.files.find((f) =>
    f.path.endsWith("textures/item/void_crystal.png"),
  );
  assert.ok(png, "expected void_crystal.png");
  assert.ok(Buffer.isBuffer(png.content));
});

test("original block with textureColor produces a PNG under the mod's namespace", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "block",
          id: "bloodstone",
          name: "Bloodstone",
          description: "",
          details: {
            hardness: 3,
            requiresTool: true,
            textureStyle: "metal",
            textureColor: "#5a0a14",
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const png = r.files.find((f) =>
    f.path.endsWith("textures/block/bloodstone.png"),
  );
  assert.ok(png, "expected bloodstone.png");
  assert.ok(Buffer.isBuffer(png.content));
  // Sanity: the path is under the mod's namespace, not minecraft:
  assert.match(png.path, /assets\/demo\/textures\/block\//);
});

test("regression: existing 3 baseline prompts still produce fullyCovered specs", () => {
  // Sapphire block.
  let r = tryGenerateDeterministically(
    spec({
      modId: "sapphire_block_mod",
      packageName: "com.modforge.sapphire_block_mod",
      mainClass: "SapphireBlockMod",
      features: [
        { type: "item", id: "sapphire", name: "Sapphire", description: "", details: {} },
        {
          type: "block",
          id: "sapphire_block",
          name: "Sapphire Block",
          description: "",
          details: { hardness: 5, resistance: 6, requiresTool: true, miningLevel: "iron" },
        },
        {
          type: "recipe",
          id: "sapphire_block_from_sapphires",
          name: "r",
          description: "",
          details: {
            shape: "shaped",
            result: { itemId: "sapphire_block_mod:sapphire_block", count: 1 },
            pattern: ["SSS", "SSS", "SSS"],
            key: { S: "sapphire_block_mod:sapphire" },
          },
        } as never,
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  // Copper hammer.
  r = tryGenerateDeterministically(
    spec({
      modId: "copper_hammer",
      packageName: "com.modforge.copper_hammer",
      mainClass: "CopperHammerMod",
      features: [
        {
          type: "weapon",
          id: "copper_hammer",
          name: "Copper Hammer",
          description: "",
          details: { weaponType: "hammer", knockback: 1.5, durability: 250 },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  // Sapphire-give command.
  r = tryGenerateDeterministically(
    spec({
      modId: "sapphire_gem_mod",
      packageName: "com.modforge.sapphire_gem_mod",
      mainClass: "SapphireGemMod",
      features: [
        { type: "item", id: "sapphire", name: "Sapphire", description: "", details: {} },
        {
          type: "command",
          id: "give_sapphire",
          name: "/givesapphire",
          description: "",
          details: {
            commandName: "givesapphire",
            permissionLevel: 2,
            action: { type: "give-item", itemId: "sapphire_gem_mod:sapphire", count: 1 },
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
});
