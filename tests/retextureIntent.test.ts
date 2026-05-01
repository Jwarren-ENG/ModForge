import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, normalizeRawSpec } from "../src/agent/createModSpec.js";
import { ModSpecSchema } from "../src/schemas.js";

const baseSpec = {
  modId: "test_mod",
  modName: "Test",
  modVersion: "1.0.0",
  mcVersion: "1.20.1",
  modLoader: "fabric" as const,
  packageName: "com.modforge.test_mod",
  mainClass: "TestMod",
  description: "",
  filesToCreate: [],
  limitations: [],
  assumptions: [],
};

// ---------- classifier ----------

test("classifyIntent: 'make X color' phrasings are retexture", () => {
  for (const p of [
    "Make wooden sword red",
    "make diamond sword black",
    "Change diamond ore to purple",
    "turn oak planks blue",
    "Recolor diamonds to indigo",
    "Retexture diamonds to look like black crystals",
    "color the iron pickaxe green",
  ]) {
    assert.equal(classifyIntent(p), "retexture", `expected retexture for "${p}"`);
  }
});

test("classifyIntent: 'add/create' and 'make me' phrasings are create", () => {
  for (const p of [
    "Add a void crystal item that is dark purple",
    "Add a new red wooden sword weapon",
    "Add a custom hammer with knockback",
    "Create a sapphire block with a recipe",
    "Build a copper hammer tool",
    "Make me a glowing pickaxe",
    "Give me a frost wand",
  ]) {
    assert.equal(classifyIntent(p), "create", `expected create for "${p}"`);
  }
});

// ---------- rewriter (the core regression) ----------

function specWith(features: unknown[]) {
  return { ...baseSpec, features };
}

test("normalizeRawSpec: 'Make wooden sword red' rewrites custom weapon -> retexture_item minecraft:wooden_sword", () => {
  // Simulate the planner's wrong output: a custom weapon with id derived from the prompt.
  const raw = specWith([
    {
      type: "weapon",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "A red wooden sword.",
      details: { weaponType: "sword", durability: 60 },
    },
  ]);
  const out = normalizeRawSpec(raw, "Make wooden sword red") as { features: any[] };
  assert.equal(out.features.length, 1);
  const f = out.features[0]!;
  assert.equal(f.type, "retexture_item");
  assert.equal(f.details.vanillaTarget, "minecraft:wooden_sword");
  assert.equal(f.details.textureColor, "#cc1133");
  // The feature id is preserved (used as the modder-facing label) but it's now a retexture.
  assert.equal(f.id, "red_wooden_sword");

  // And it must still validate against the schema.
  const r = ModSpecSchema.safeParse(out);
  if (!r.success) {
    assert.fail("rewritten spec must validate:\n" + r.error.issues.map((i) => i.message).join("\n"));
  }
});

test("normalizeRawSpec: 'Make diamond sword black' rewrites to retexture_item minecraft:diamond_sword", () => {
  const raw = specWith([
    {
      type: "weapon",
      id: "black_diamond_sword",
      name: "Black Diamond Sword",
      description: "",
      details: {},
    },
  ]);
  const out = normalizeRawSpec(raw, "Make diamond sword black") as { features: any[] };
  const f = out.features[0]!;
  assert.equal(f.type, "retexture_item");
  assert.equal(f.details.vanillaTarget, "minecraft:diamond_sword");
  assert.equal(f.details.textureColor, "#101015");
  assert.ok(ModSpecSchema.safeParse(out).success);
});

test("normalizeRawSpec: 'Make diamond ore purple' rewrites custom block -> retexture_block minecraft:diamond_ore", () => {
  const raw = specWith([
    {
      type: "block",
      id: "purple_diamond_ore",
      name: "Purple Diamond Ore",
      description: "",
      details: { hardness: 3 },
    },
  ]);
  const out = normalizeRawSpec(raw, "Make diamond ore purple") as { features: any[] };
  const f = out.features[0]!;
  assert.equal(f.type, "retexture_block");
  assert.equal(f.details.vanillaTarget, "minecraft:diamond_ore");
  assert.equal(f.details.textureColor, "#7733cc");
  assert.ok(ModSpecSchema.safeParse(out).success);
});

test("normalizeRawSpec: 'Make oak planks blue' rewrites to retexture_block minecraft:oak_planks", () => {
  const raw = specWith([
    {
      type: "block",
      id: "blue_oak_planks",
      name: "Blue Oak Planks",
      description: "",
      details: {},
    },
  ]);
  const out = normalizeRawSpec(raw, "Make oak planks blue") as { features: any[] };
  const f = out.features[0]!;
  assert.equal(f.type, "retexture_block");
  assert.equal(f.details.vanillaTarget, "minecraft:oak_planks");
  assert.ok(ModSpecSchema.safeParse(out).success);
});

test("normalizeRawSpec: rewrite drops recipes that reference the rewritten id", () => {
  const raw = specWith([
    {
      type: "weapon",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "",
      details: {},
    },
    {
      type: "recipe",
      id: "red_wooden_sword_recipe",
      name: "Red Wooden Sword Recipe",
      description: "",
      details: {
        shape: "shaped",
        result: { itemId: "test_mod:red_wooden_sword", count: 1 },
        pattern: ["S", "S", "T"],
        key: { S: "minecraft:oak_planks", T: "minecraft:stick" },
      },
    },
  ]);
  const out = normalizeRawSpec(raw, "Make wooden sword red") as { features: any[] };
  // The weapon was rewritten and the recipe (which referenced it) was dropped.
  assert.equal(out.features.length, 1);
  assert.equal(out.features[0]!.type, "retexture_item");
});

// ---------- create-intent must NOT trigger retexture rewrite ----------

test("normalizeRawSpec: 'Add a red wooden sword weapon' (create intent) leaves the custom weapon alone", () => {
  const raw = specWith([
    {
      type: "weapon",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "",
      details: { weaponType: "sword", durability: 60 },
    },
  ]);
  const out = normalizeRawSpec(raw, "Add a red wooden sword weapon") as { features: any[] };
  assert.equal(out.features[0]!.type, "weapon");
  assert.equal(out.features[0]!.id, "red_wooden_sword");
});

test("normalizeRawSpec: 'Add a void crystal item' (create intent) leaves the custom item alone", () => {
  const raw = specWith([
    {
      type: "item",
      id: "void_crystal",
      name: "Void Crystal",
      description: "",
      details: { textureStyle: "crystal", textureColor: "#3a004f" },
    },
  ]);
  const out = normalizeRawSpec(raw, "Add a void crystal item") as { features: any[] };
  assert.equal(out.features[0]!.type, "item");
});

test("normalizeRawSpec: ambiguous prompt leaves features alone", () => {
  const raw = specWith([
    {
      type: "item",
      id: "wooden_sword",
      name: "wooden_sword",
      description: "",
      details: {},
    },
  ]);
  // Intent is "ambiguous" — no leading verb to anchor on. Leave as-is.
  const out = normalizeRawSpec(raw, "wooden sword red") as { features: any[] };
  assert.equal(out.features[0]!.type, "item");
});

test("normalizeRawSpec: feature id NOT matching any vanilla target is left alone", () => {
  // Even with retexture intent, if the id doesn't match an allowlisted target, do nothing.
  const raw = specWith([
    {
      type: "item",
      id: "shadow_blade",
      name: "Shadow Blade",
      description: "",
      details: {},
    },
  ]);
  const out = normalizeRawSpec(raw, "Make a shadow blade dark") as { features: any[] };
  // Note: "Make" triggers retexture intent BUT shadow_blade has no vanilla match.
  assert.equal(out.features[0]!.type, "item");
});

// ---------- existing grass_block normalization still runs ----------

// =====================================================================
// Milestone 3.8 patch — clarified-prompt classification + rewriting
// =====================================================================

test("classifyIntent: clarified 'Create new custom …' answer routes to create", () => {
  const p = "make a red wooden sword\n\nClarifications:\n- intent: Create new custom red wooden sword";
  assert.equal(classifyIntent(p), "create");
});

test("classifyIntent: clarified 'Edit vanilla …' answer routes to retexture", () => {
  const p = "make a red wooden sword\n\nClarifications:\n- intent: Edit vanilla Wooden Sword";
  assert.equal(classifyIntent(p), "retexture");
});

test("classifyIntent: 'Edit existing vanilla …' also routes to retexture", () => {
  const p = "make a red wooden sword\n\nClarifications:\n- intent: Edit existing vanilla Wooden Sword";
  assert.equal(classifyIntent(p), "retexture");
});

test("normalizeRawSpec: 'Edit vanilla' clarified prompt rewrites planner's weapon -> retexture_item", () => {
  const raw = specWith([
    {
      type: "weapon",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "",
      details: { weaponType: "sword", durability: 60 },
    },
  ]);
  const out = normalizeRawSpec(
    raw,
    "make a red wooden sword\n\nClarifications:\n- intent: Edit vanilla Wooden Sword",
  ) as { features: any[] };
  assert.equal(out.features.length, 1);
  assert.equal(out.features[0]!.type, "retexture_item");
  assert.equal(out.features[0]!.details.vanillaTarget, "minecraft:wooden_sword");
  // The rewritten spec must still validate.
  const r = ModSpecSchema.safeParse(out);
  if (!r.success) {
    assert.fail("rewritten spec must validate:\n" + r.error.issues.map((i) => i.message).join("\n"));
  }
});

test("normalizeRawSpec: 'Create new custom' clarified prompt leaves planner's weapon alone", () => {
  const raw = specWith([
    {
      type: "weapon",
      id: "red_wooden_sword",
      name: "Red Wooden Sword",
      description: "",
      details: { weaponType: "sword", durability: 60 },
    },
  ]);
  const out = normalizeRawSpec(
    raw,
    "make a red wooden sword\n\nClarifications:\n- intent: Create new custom red wooden sword",
  ) as { features: any[] };
  // Custom item kept as-is — no retexture rewrite.
  assert.equal(out.features[0]!.type, "weapon");
  assert.equal(out.features[0]!.id, "red_wooden_sword");
});

test("normalizeRawSpec: 'Create new custom' for a block leaves it as block (not retexture)", () => {
  const raw = specWith([
    {
      type: "block",
      id: "purple_diamond_ore",
      name: "Purple Diamond Ore",
      description: "",
      details: { hardness: 3 },
    },
  ]);
  const out = normalizeRawSpec(
    raw,
    "make a purple diamond ore\n\nClarifications:\n- intent: Create new custom purple diamond ore",
  ) as { features: any[] };
  assert.equal(out.features[0]!.type, "block");
});

test("normalizeRawSpec: still strips bottom-face from grass_block retextures (regression)", () => {
  const raw = specWith([
    {
      type: "retexture_block",
      id: "purple_grass",
      name: "Purple Grass",
      description: "",
      details: {
        vanillaTarget: "minecraft:grass_block",
        textureStyle: "grass",
        textureColor: "#5a008a",
        faces: ["top", "side", "bottom"],
      },
    },
  ]);
  const out = normalizeRawSpec(raw, "Make grass blocks dark purple") as { features: any[] };
  assert.deepEqual(out.features[0]!.details.faces, ["top", "side"]);
});
