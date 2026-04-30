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
