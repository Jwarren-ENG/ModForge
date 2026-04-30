import type { BlockFeatureT, ModSpec } from "../schemas.js";
import { generateTexturePng } from "../textures/index.js";
import {
  blockSoundGroupField,
  constName,
  humanize,
  levelTagPath,
  mineableTagPath,
} from "./utils.js";
import { emptyContribution, type FeatureContribution } from "./types.js";

const STD_IMPORTS = [
  "net.minecraft.block.AbstractBlock",
  "net.minecraft.block.Block",
  "net.minecraft.item.BlockItem",
  "net.minecraft.item.Item",
  "net.minecraft.registry.Registries",
  "net.minecraft.registry.Registry",
  "net.minecraft.sound.BlockSoundGroup",
  "net.minecraft.util.Identifier",
];

export function generateBlock(
  spec: ModSpec,
  feature: BlockFeatureT,
): FeatureContribution {
  const c = emptyContribution();
  const fieldName = constName(feature.id);
  const itemFieldName = `${fieldName}_ITEM`;
  const display =
    feature.details.displayName ?? (humanize(feature.name) || humanize(feature.id));

  const hardness = feature.details.hardness ?? 1.5;
  const resistance = feature.details.resistance ?? hardness;
  const soundField = blockSoundGroupField(feature.details.soundGroup ?? "stone");
  const requiresTool = feature.details.requiresTool === true;
  const tool = feature.details.miningTool ?? "pickaxe";
  const level = feature.details.miningLevel ?? "stone";

  const settingsParts = [
    `.strength(${num(hardness)}, ${num(resistance)})`,
    `.sounds(${soundField})`,
  ];
  if (requiresTool) settingsParts.push(".requiresTool()");
  const settings = `AbstractBlock.Settings.create()${settingsParts.join("")}`;

  c.imports.push(...STD_IMPORTS);
  c.fieldDecls.push(
    `    public static final Block ${fieldName} = new Block(${settings});`,
  );
  c.fieldDecls.push(
    `    public static final BlockItem ${itemFieldName} = new BlockItem(${fieldName}, new Item.Settings());`,
  );

  c.blockRegisters.push(
    `        Registry.register(Registries.BLOCK, new Identifier(MOD_ID, "${feature.id}"), ${fieldName});`,
    `        Registry.register(Registries.ITEM, new Identifier(MOD_ID, "${feature.id}"), ${itemFieldName});`,
  );

  // --- Resources ---
  const ns = spec.modId;
  c.resources.push(
    {
      path: `src/main/resources/assets/${ns}/blockstates/${feature.id}.json`,
      content:
        JSON.stringify(
          { variants: { "": { model: `${ns}:block/${feature.id}` } } },
          null,
          2,
        ) + "\n",
    },
    {
      path: `src/main/resources/assets/${ns}/models/block/${feature.id}.json`,
      content:
        JSON.stringify(
          {
            parent: "minecraft:block/cube_all",
            textures: { all: `${ns}:block/${feature.id}` },
          },
          null,
          2,
        ) + "\n",
    },
    {
      path: `src/main/resources/assets/${ns}/models/item/${feature.id}.json`,
      content:
        JSON.stringify({ parent: `${ns}:block/${feature.id}` }, null, 2) + "\n",
    },
    // Loot table: drop self by default. Without this, the block drops nothing.
    {
      path: `src/main/resources/data/${ns}/loot_tables/blocks/${feature.id}.json`,
      content:
        JSON.stringify(
          {
            type: "minecraft:block",
            pools: [
              {
                rolls: 1,
                bonus_rolls: 0,
                entries: [{ type: "minecraft:item", name: `${ns}:${feature.id}` }],
                conditions: [{ condition: "minecraft:survives_explosion" }],
              },
            ],
          },
          null,
          2,
        ) + "\n",
    },
  );

  // --- Optional procedural PNG ---
  if (feature.details.textureColor) {
    c.resources.push({
      path: `src/main/resources/assets/${ns}/textures/block/${feature.id}.png`,
      content: generateTexturePng({
        primaryColorHex: feature.details.textureColor,
        secondaryColorHex: feature.details.secondaryColor,
        style: feature.details.textureStyle ?? "stone",
        glowing: feature.details.glowing ?? false,
        faceMode: "all",
      }),
    });
  }

  // --- Tags ---
  if (requiresTool) {
    const minePath = mineableTagPath(tool);
    addTag(c.blockTags, minePath, `${ns}:${feature.id}`);
    const lvl = levelTagPath(level);
    if (lvl) addTag(c.blockTags, lvl, `${ns}:${feature.id}`);
  }

  c.langEntries[`block.${ns}.${feature.id}`] = display;
  return c;
}

function num(n: number): string {
  // Always emit a Java float literal: 1 -> "1.0f", 1.5 -> "1.5f".
  const s = Number.isInteger(n) ? `${n}.0` : `${n}`;
  return `${s}f`;
}

function addTag(map: Record<string, string[]>, path: string, value: string): void {
  if (!map[path]) map[path] = [];
  map[path]!.push(value);
}
