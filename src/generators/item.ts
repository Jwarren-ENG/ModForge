import type { Buffer } from "node:buffer";
import type { ItemFeatureT, ModSpec } from "../schemas.js";
import { generateTexturePng } from "../textures/index.js";
import { constName, humanize } from "./utils.js";
import { emptyContribution, type FeatureContribution } from "./types.js";

const STD_IMPORTS = [
  "net.minecraft.item.Item",
  "net.minecraft.registry.Registries",
  "net.minecraft.registry.Registry",
  "net.minecraft.util.Identifier",
];

export function generateItem(
  spec: ModSpec,
  feature: ItemFeatureT,
  aiTexture?: Buffer,
): FeatureContribution {
  const c = emptyContribution();
  const fieldName = constName(feature.id);
  const display =
    feature.details.displayName ?? (humanize(feature.name) || humanize(feature.id));

  const settingsParts: string[] = [];
  if (feature.details.maxStackSize) {
    settingsParts.push(`.maxCount(${feature.details.maxStackSize})`);
  }
  const settings = settingsParts.length > 0
    ? `new Item.Settings()${settingsParts.join("")}`
    : "new Item.Settings()";

  c.imports.push(...STD_IMPORTS);
  c.fieldDecls.push(
    `    public static final Item ${fieldName} = new Item(${settings});`,
  );
  c.itemRegisters.push(
    `        Registry.register(Registries.ITEM, new Identifier(MOD_ID, "${feature.id}"), ${fieldName});`,
  );

  c.resources.push({
    path: `src/main/resources/assets/${spec.modId}/models/item/${feature.id}.json`,
    content:
      JSON.stringify(
        {
          parent: "minecraft:item/generated",
          textures: { layer0: `${spec.modId}:item/${feature.id}` },
        },
        null,
        2,
      ) + "\n",
  });

  // Texture: prefer AI bytes when the orchestrator pre-fetched them, else
  // fall back to the deterministic procedural texture (only if we have a
  // color to paint with). The path is hardcoded — AI never names files.
  const texturePath = `src/main/resources/assets/${spec.modId}/textures/item/${feature.id}.png`;
  if (aiTexture) {
    c.resources.push({ path: texturePath, content: aiTexture });
  } else if (feature.details.textureColor) {
    c.resources.push({
      path: texturePath,
      content: generateTexturePng({
        primaryColorHex: feature.details.textureColor,
        secondaryColorHex: feature.details.secondaryColor,
        style: feature.details.textureStyle ?? "gem",
        glowing: feature.details.glowing ?? false,
        faceMode: "item",
      }),
    });
  }

  c.langEntries[`item.${spec.modId}.${feature.id}`] = display;
  return c;
}
