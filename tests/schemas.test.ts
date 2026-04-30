import { test } from "node:test";
import assert from "node:assert/strict";
import { ModSpecSchema } from "../src/schemas.js";

const baseSpec = {
  modId: "test_mod",
  modName: "Test Mod",
  modVersion: "1.0.0",
  mcVersion: "1.20.1",
  modLoader: "fabric" as const,
  packageName: "com.modforge.test_mod",
  mainClass: "TestMod",
  description: "x",
  features: [] as unknown[],
  filesToCreate: [],
  limitations: [],
  assumptions: [],
};

const itemFeature = (id: string) => ({
  type: "item",
  id,
  name: id,
  description: "",
  details: {},
});

function expectFail(input: unknown, ...patterns: RegExp[]) {
  const r = ModSpecSchema.safeParse(input);
  assert.equal(r.success, false, `expected failure but parsed ok`);
  if (!r.success) {
    const msg = r.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    for (const p of patterns) {
      assert.match(msg, p, `expected message to match ${p}\n--- got ---\n${msg}`);
    }
  }
}

function expectOk(input: unknown) {
  const r = ModSpecSchema.safeParse(input);
  if (!r.success) {
    const msg = r.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    assert.fail(`expected pass, got:\n${msg}`);
  }
}

test("ModSpecSchema: duplicate feature ids fail", () => {
  expectFail(
    { ...baseSpec, features: [itemFeature("foo"), itemFeature("foo")] },
    /duplicate feature id "foo"/,
  );
});

test("ModSpecSchema: duplicate command names fail", () => {
  const cmd = (id: string, name: string) => ({
    type: "command",
    id,
    name: id,
    description: "",
    details: {
      commandName: name,
      permissionLevel: 2,
      action: { type: "give-item", itemId: "test_mod:gem", count: 1 },
    },
  });
  expectFail(
    {
      ...baseSpec,
      features: [
        itemFeature("gem"),
        cmd("c1", "givegem"),
        cmd("c2", "givegem"),
      ],
    },
    /duplicate command name "givegem"/,
  );
});

test("ModSpecSchema: shaped recipe with unused key fails", () => {
  expectFail(
    {
      ...baseSpec,
      features: [
        itemFeature("gem"),
        {
          type: "recipe",
          id: "r1",
          name: "r",
          description: "",
          details: {
            shape: "shaped",
            result: { itemId: "test_mod:gem", count: 1 },
            pattern: ["GG", "GG"],
            key: { G: "test_mod:gem", X: "minecraft:stick" },
          },
        },
      ],
    },
    /key 'X' is defined but not used/,
  );
});

test("ModSpecSchema: shaped recipe with missing key char fails", () => {
  expectFail(
    {
      ...baseSpec,
      features: [
        itemFeature("gem"),
        {
          type: "recipe",
          id: "r1",
          name: "r",
          description: "",
          details: {
            shape: "shaped",
            result: { itemId: "test_mod:gem", count: 1 },
            pattern: ["GG", "GX"],
            key: { G: "test_mod:gem" },
          },
        },
      ],
    },
    /pattern uses 'X' but it is not defined in key/,
  );
});

test("ModSpecSchema: shaped recipe with multi-char key fails", () => {
  expectFail(
    {
      ...baseSpec,
      features: [
        itemFeature("gem"),
        {
          type: "recipe",
          id: "r1",
          name: "r",
          description: "",
          details: {
            shape: "shaped",
            result: { itemId: "test_mod:gem", count: 1 },
            pattern: ["GG"],
            key: { GG: "test_mod:gem" },
          },
        },
      ],
    },
    /String must contain exactly 1 character/,
  );
});

test("ModSpecSchema: shaped recipe with inconsistent row widths fails", () => {
  expectFail(
    {
      ...baseSpec,
      features: [
        itemFeature("gem"),
        {
          type: "recipe",
          id: "r1",
          name: "r",
          description: "",
          details: {
            shape: "shaped",
            result: { itemId: "test_mod:gem", count: 1 },
            pattern: ["GG", "GGG"],
            key: { G: "test_mod:gem" },
          },
        },
      ],
    },
    /all pattern rows must have the same width/,
  );
});

test("ModSpecSchema: shapeless recipe with empty ingredients fails", () => {
  expectFail(
    {
      ...baseSpec,
      features: [
        itemFeature("gem"),
        {
          type: "recipe",
          id: "r1",
          name: "r",
          description: "",
          details: {
            shape: "shapeless",
            result: { itemId: "test_mod:gem", count: 1 },
            ingredients: [],
          },
        },
      ],
    },
    /Array must contain at least 1/,
  );
});

test("ModSpecSchema: recipe referencing missing local item fails", () => {
  expectFail(
    {
      ...baseSpec,
      features: [
        itemFeature("gem"),
        {
          type: "recipe",
          id: "r1",
          name: "r",
          description: "",
          details: {
            shape: "shapeless",
            result: { itemId: "test_mod:not_a_thing", count: 1 },
            ingredients: ["test_mod:gem"],
          },
        },
      ],
    },
    /local item reference "test_mod:not_a_thing" does not match any declared/,
  );
});

test("ModSpecSchema: command referencing missing local item fails", () => {
  expectFail(
    {
      ...baseSpec,
      features: [
        {
          type: "command",
          id: "give_x",
          name: "give x",
          description: "",
          details: {
            commandName: "givex",
            permissionLevel: 2,
            action: { type: "give-item", itemId: "test_mod:nope", count: 1 },
          },
        },
      ],
    },
    /local item reference "test_mod:nope" does not match any declared/,
  );
});

test("ModSpecSchema: recipe referencing minecraft:* item is allowed (not local)", () => {
  expectOk({
    ...baseSpec,
    features: [
      itemFeature("gem"),
      {
        type: "recipe",
        id: "r1",
        name: "r",
        description: "",
        details: {
          shape: "shapeless",
          result: { itemId: "test_mod:gem", count: 1 },
          ingredients: ["minecraft:diamond"],
        },
      },
    ],
  });
});

test("ModSpecSchema: tag-ref ingredient (#minecraft:planks) is allowed", () => {
  expectOk({
    ...baseSpec,
    features: [
      itemFeature("gem"),
      {
        type: "recipe",
        id: "r1",
        name: "r",
        description: "",
        details: {
          shape: "shapeless",
          result: { itemId: "test_mod:gem", count: 1 },
          ingredients: ["#minecraft:planks"],
        },
      },
    ],
  });
});

test("ModSpecSchema: bad Java package (reserved word segment) fails", () => {
  expectFail(
    { ...baseSpec, packageName: "com.modforge.class" },
    /package segment "class" is a Java reserved word/,
  );
  expectFail(
    { ...baseSpec, packageName: "com.modforge.new" },
    /reserved word/,
  );
});

test("ModSpecSchema: bad modVersion fails", () => {
  expectFail({ ...baseSpec, modVersion: "1.0" }, /1\.2\.3/);
  expectFail({ ...baseSpec, modVersion: "v1.0.0" }, /1\.2\.3/);
  expectFail({ ...baseSpec, modVersion: "next" }, /1\.2\.3/);
});

test("ModSpecSchema: details strict — extra fields rejected", () => {
  expectFail(
    {
      ...baseSpec,
      features: [
        {
          type: "item",
          id: "gem",
          name: "Gem",
          description: "",
          details: { displayName: "Gem", rarity: "epic" }, // rarity is not in ItemDetails
        },
      ],
    },
    /Unrecognized key/,
  );
});

test("ModSpecSchema: tool-class collision with mainClass fails", () => {
  expectFail(
    {
      ...baseSpec,
      mainClass: "CopperHammerItem",
      features: [
        {
          type: "weapon",
          id: "copper_hammer",
          name: "Copper Hammer",
          description: "",
          details: { weaponType: "hammer" },
        },
      ],
    },
    /generated class name "CopperHammerItem" collides/,
  );
});

test("ModSpecSchema: valid sapphire spec passes", () => {
  expectOk({
    ...baseSpec,
    modId: "sapphire_block_mod",
    packageName: "com.modforge.sapphire_block_mod",
    mainClass: "SapphireBlockMod",
    features: [
      itemFeature("sapphire"),
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
      },
    ],
  });
});
