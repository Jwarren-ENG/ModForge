import { test } from "node:test";
import assert from "node:assert/strict";
import { renderModReadme } from "../src/agent/generateReadme.js";
import type { ModSpec } from "../src/types.js";

function spec(overrides: Partial<ModSpec> = {}): ModSpec {
  return {
    modId: "demo_mod",
    modName: "Demo Mod",
    modVersion: "1.0.0",
    mcVersion: "1.20.1",
    modLoader: "fabric",
    packageName: "com.modforge.demo_mod",
    mainClass: "DemoMod",
    description: "A demo mod for tests.",
    features: [],
    filesToCreate: [],
    limitations: [],
    assumptions: [],
    ...overrides,
  } as ModSpec;
}

test("README: includes mod name, mod id, MC 1.20.1 and Fabric API requirement", () => {
  const md = renderModReadme(spec());
  assert.match(md, /^# Demo Mod/m);
  assert.match(md, /Mod ID \| `demo_mod`/);
  assert.match(md, /Minecraft \| \*\*1\.20\.1\*\*/);
  assert.match(md, /Fabric API \| \*\*required\*\*/);
  assert.match(md, /Fabric\s+1\.20\.1\*{0,2}\s+profile/);
});

test("README: simple item mod includes /give @p modId:itemId", () => {
  const md = renderModReadme(
    spec({
      features: [
        { type: "item", id: "void_crystal", name: "Void Crystal", description: "purple gem", details: {} },
      ],
    }),
  );
  assert.match(md, /## Generated features/);
  assert.match(md, /### Items/);
  assert.match(md, /`demo_mod:void_crystal`/);
  assert.match(md, /## Testing in Minecraft/);
  assert.match(md, /\/give @p demo_mod:void_crystal/);
});

test("README: block mod includes /give for the block (BlockItem) and lists tool/level metadata", () => {
  const md = renderModReadme(
    spec({
      features: [
        {
          type: "block",
          id: "bloodstone",
          name: "Bloodstone",
          description: "dark red ore-like stone",
          details: { hardness: 3, requiresTool: true, miningTool: "pickaxe", miningLevel: "iron" },
        },
      ],
    }),
  );
  assert.match(md, /### Blocks/);
  assert.match(md, /`demo_mod:bloodstone`/);
  assert.match(md, /requires tool/);
  assert.match(md, /tool: pickaxe/);
  assert.match(md, /level: iron/);
  assert.match(md, /\/give @p demo_mod:bloodstone/);
});

test("README: weapon mod lists weapon metadata and a /give line", () => {
  const md = renderModReadme(
    spec({
      modId: "copper_hammer",
      packageName: "com.modforge.copper_hammer",
      mainClass: "CopperHammerMod",
      features: [
        {
          type: "weapon",
          id: "copper_hammer",
          name: "Copper Hammer",
          description: "heavy melee with knockback",
          details: { weaponType: "hammer", knockback: 1.5, durability: 250 },
        },
      ],
    }),
  );
  assert.match(md, /### Weapons/);
  assert.match(md, /`copper_hammer:copper_hammer`/);
  assert.match(md, /hammer/);
  assert.match(md, /knockback 1\.5/);
  assert.match(md, /\/give @p copper_hammer:copper_hammer/);
});

test("README: command mod includes /commandName and operator-level note", () => {
  const md = renderModReadme(
    spec({
      modId: "sapphire_gem_mod",
      features: [
        { type: "item", id: "sapphire", name: "Sapphire", description: "", details: {} },
        {
          type: "command",
          id: "give_sapphire",
          name: "give sapphire command",
          description: "gives a sapphire",
          details: {
            commandName: "givesapphire",
            permissionLevel: 2,
            action: { type: "give-item", itemId: "sapphire_gem_mod:sapphire", count: 1 },
          },
        },
      ],
    }),
  );
  assert.match(md, /### Commands/);
  assert.match(md, /`\/givesapphire`/);
  assert.match(md, /operator level 2/);
  assert.match(md, /## Testing in Minecraft/);
  assert.match(md, /\/givesapphire/);
});

test("README: vanilla retexture includes Creative-inventory guidance + 'item not ore' hint", () => {
  const md = renderModReadme(
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
  assert.match(md, /### Vanilla retextures/);
  assert.match(md, /`minecraft:diamond`/);
  assert.match(md, /## Testing in Minecraft/);
  assert.match(md, /Vanilla retextures/);
  assert.match(md, /Creative inventory/);
  assert.match(md, /the \*\*item\*\*, not its ore/);
});

test("README: grass_block retexture mentions top + side, not bottom", () => {
  const md = renderModReadme(
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
  assert.match(md, /minecraft:grass_block/);
  assert.match(md, /top \+ side faces/);
  assert.match(md, /bottom is dirt/);
});

test("README: macOS mods folder path is included verbatim", () => {
  const md = renderModReadme(spec());
  assert.match(md, /~\/Library\/Application Support\/minecraft\/mods/);
});

test("README: includes assumptions and limitations when the spec has them", () => {
  const md = renderModReadme(
    spec({
      assumptions: ["Player has Fabric API installed"],
      limitations: ["Bottom face of grass blocks is not retextured"],
    }),
  );
  assert.match(md, /## Assumptions/);
  assert.match(md, /Player has Fabric API installed/);
  assert.match(md, /## Limitations/);
  assert.match(md, /Bottom face of grass blocks is not retextured/);
});

test("README: troubleshooting section is always present and mentions Fabric profile + checker textures", () => {
  const md = renderModReadme(spec());
  assert.match(md, /## Troubleshooting/);
  assert.match(md, /Fabric\s+1\.20\.1\*{0,2}\s+profile/);
  assert.match(md, /purple-and-black checker/);
});

test("README: jarPath produces the right filename in install steps + Quick facts", () => {
  const md = renderModReadme(
    spec({ modId: "demo_mod", modVersion: "1.2.3" }),
    "/abs/path/to/build/libs/demo_mod-1.2.3.jar",
  );
  assert.match(md, /demo_mod-1\.2\.3\.jar/);
});
