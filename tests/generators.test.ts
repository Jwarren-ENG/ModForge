import { test } from "node:test";
import assert from "node:assert/strict";
import { tryGenerateDeterministically } from "../src/generators/index.js";
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

function findFile<T extends { path: string }>(files: T[], suffix: string): T {
  const f = files.find((x) => x.path.endsWith(suffix));
  if (!f) {
    assert.fail(`expected file ending in "${suffix}", paths: ${files.map((x) => x.path).join(", ")}`);
  }
  return f;
}

test("orchestrator: item feature produces main class + item model + lang", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        { type: "item", id: "gem", name: "Gem", description: "", details: {} },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  findFile(r.files, "DemoMod.java");
  findFile(r.files, "models/item/gem.json");
  findFile(r.files, "lang/en_us.json");
});

test("orchestrator: block with requiresTool emits mineable + level tags", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        {
          type: "block",
          id: "sapphire_block",
          name: "Sapphire Block",
          description: "",
          details: {
            hardness: 5,
            resistance: 6,
            requiresTool: true,
            miningTool: "pickaxe",
            miningLevel: "iron",
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  findFile(r.files, "blockstates/sapphire_block.json");
  findFile(r.files, "models/block/sapphire_block.json");
  findFile(r.files, "models/item/sapphire_block.json");
  findFile(r.files, "loot_tables/blocks/sapphire_block.json");
  findFile(r.files, "tags/blocks/mineable/pickaxe.json");
  findFile(r.files, "tags/blocks/needs_iron_tool.json");
});

test("orchestrator: shaped recipe produces vanilla 1.20 schema JSON", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        { type: "item", id: "gem", name: "Gem", description: "", details: {} },
        {
          type: "recipe",
          id: "gem_block_recipe",
          name: "r",
          description: "",
          details: {
            shape: "shaped",
            result: { itemId: "demo:gem", count: 1 },
            pattern: ["GG", "GG"],
            key: { G: "demo:gem" },
          },
        } as never,
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const recipe = findFile(r.files, "recipes/gem_block_recipe.json") as {
    path: string;
    content: string;
  };
  const json = JSON.parse((recipe as any).content);
  assert.equal(json.type, "minecraft:crafting_shaped");
  assert.deepEqual(json.pattern, ["GG", "GG"]);
  assert.deepEqual(json.key.G, { item: "demo:gem" });
  assert.deepEqual(json.result, { item: "demo:gem", count: 1 });
});

test("orchestrator: shapeless recipe with tag ingredient", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        { type: "item", id: "gem", name: "Gem", description: "", details: {} },
        {
          type: "recipe",
          id: "shapeless",
          name: "r",
          description: "",
          details: {
            shape: "shapeless",
            result: { itemId: "demo:gem", count: 1 },
            ingredients: ["#minecraft:planks", "minecraft:stick"],
          },
        } as never,
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const recipe = findFile(r.files, "recipes/shapeless.json") as { content: string };
  const json = JSON.parse((recipe as any).content);
  assert.equal(json.type, "minecraft:crafting_shapeless");
  assert.deepEqual(json.ingredients[0], { tag: "minecraft:planks" });
  assert.deepEqual(json.ingredients[1], { item: "minecraft:stick" });
});

test("orchestrator: weapon emits a custom Item subclass file", () => {
  const r = tryGenerateDeterministically(
    spec({
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
  const subclass = findFile(r.files, "CopperHammerItem.java") as { content: string };
  assert.match((subclass as any).content, /extends Item/);
  assert.match((subclass as any).content, /takeKnockback/);
  // No invented overrides — only postHit.
  assert.match((subclass as any).content, /@Override\s+public boolean postHit/);
  assert.equal(((subclass as any).content.match(/@Override/g) ?? []).length, 1);
});

test("orchestrator: command emits CommandRegistrationCallback block in main class", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        { type: "item", id: "gem", name: "Gem", description: "", details: {} },
        {
          type: "command",
          id: "give_gem",
          name: "givegem",
          description: "",
          details: {
            commandName: "givegem",
            permissionLevel: 2,
            action: { type: "give-item", itemId: "demo:gem", count: 1 },
          },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  const main = findFile(r.files, "DemoMod.java") as { content: string };
  const c = (main as any).content as string;
  assert.match(c, /CommandRegistrationCallback\.EVENT\.register/);
  assert.match(c, /CommandManager\.literal\("givegem"\)/);
  assert.match(c, /hasPermissionLevel\(2\)/);
  assert.match(c, /getPlayerOrThrow\(\)/);
  assert.match(c, /sendFeedback\(\(\) -> Text\.literal/);
});

test("orchestrator: no fabric.mod.json or build.gradle is ever produced", () => {
  const r = tryGenerateDeterministically(
    spec({
      features: [
        { type: "item", id: "gem", name: "Gem", description: "", details: {} },
        {
          type: "block",
          id: "gem_block",
          name: "Gem Block",
          description: "",
          details: { requiresTool: true },
        },
      ],
    }),
  );
  assert.equal(r.fullyCovered, true);
  for (const f of r.files) {
    assert.doesNotMatch(f.path, /fabric\.mod\.json/);
    assert.doesNotMatch(f.path, /build\.gradle/);
    assert.doesNotMatch(f.path, /settings\.gradle/);
    assert.doesNotMatch(f.path, /gradle\.properties/);
    assert.doesNotMatch(f.path, /package\.json/);
    assert.match(f.path, /^src\/main\/(java|resources)\//);
  }
});
