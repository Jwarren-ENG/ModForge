import type { Buffer } from "node:buffer";
import type { ModSpec, RetextureItemFeatureT } from "../schemas.js";
import { generateTexturePng } from "../textures/index.js";
import { retintPng } from "../textures/retint.js";
import type { Silhouette } from "../textures/silhouettes.js";
import { readVanillaSource } from "../textures/vanillaSource.js";
import { VANILLA_ITEM_TARGETS } from "../textures/vanillaTargets.js";
import { emptyContribution, type FeatureContribution } from "./types.js";

/**
 * Force the right silhouette for vanilla items where the shape is
 * unmistakable. A "black crystal diamond" should always read as a diamond,
 * not as a generic chamfered square — even if the user picks the "crystal"
 * style. Anything not in this map falls back to style-derived silhouettes.
 *
 * Milestone 3.7: tools and swords get tool-specific silhouettes. Armor and
 * other niche items fall through to the style-derived default (usually
 * generic-item) — documented as a limitation.
 */
function silhouetteForVanillaItem(target: string): Silhouette | undefined {
  // Gems
  if (
    target === "minecraft:diamond" ||
    target === "minecraft:emerald" ||
    target === "minecraft:lapis_lazuli"
  ) return "diamond";

  // Ingots
  if (target.endsWith("_ingot")) return "ingot";

  // Crystal-shard-like
  if (target === "minecraft:nether_star" || target === "minecraft:blaze_rod") {
    return "crystal-shard";
  }

  // Tools (cover all material variants).
  if (/^minecraft:(?:wooden|stone|iron|golden|diamond|netherite)_sword$/.test(target)) return "sword";
  if (/^minecraft:(?:wooden|stone|iron|golden|diamond|netherite)_pickaxe$/.test(target)) return "pickaxe";
  if (/^minecraft:(?:wooden|stone|iron|golden|diamond|netherite)_axe$/.test(target)) return "axe";
  if (/^minecraft:(?:wooden|stone|iron|golden|diamond|netherite)_shovel$/.test(target)) return "shovel";
  if (/^minecraft:(?:wooden|stone|iron|golden|diamond|netherite)_hoe$/.test(target)) return "hoe";

  return undefined;
}

/**
 * Vanilla item retexture: writes a single PNG at the allowlisted path under
 * src/main/resources/assets/minecraft/textures/item/<x>.png. The schema layer
 * has already validated that vanillaTarget is in VANILLA_ITEM_TARGETS, so we
 * never construct a path from user input.
 */
export function generateRetextureItem(
  _spec: ModSpec,
  feature: RetextureItemFeatureT,
): FeatureContribution {
  const c = emptyContribution();
  const target = VANILLA_ITEM_TARGETS[feature.details.vanillaTarget];
  if (!target) {
    // Should be unreachable for schema-valid input. Defensive: fall back to
    // throw so the orchestrator records this as uncovered.
    throw new Error(
      `vanillaTarget "${feature.details.vanillaTarget}" not in allowlist`,
    );
  }
  // Try the vanilla-asset retint path first (preserves Mojang's silhouette
  // and detail). Fall back to the procedural silhouette generator when the
  // env var isn't set, the source file is missing, or the PNG can't be
  // decoded (unsupported color type, corruption, etc.).
  const png = makePng(feature, target.texturePath, c);
  c.resources.push({
    path: `src/main/resources/${target.texturePath}`,
    content: png,
  });
  return c;
}

function makePng(
  feature: RetextureItemFeatureT,
  texturePath: string,
  c: FeatureContribution,
): Buffer {
  const src = readVanillaSource(texturePath);
  if (src) {
    try {
      return retintPng(src, {
        primaryColorHex: feature.details.textureColor,
        secondaryColorHex: feature.details.secondaryColor,
        glowing: feature.details.glowing ?? false,
      });
    } catch (err) {
      c.noticeMessages.push(
        `Could not decode the vanilla source for ${feature.details.vanillaTarget} (${(err as Error).message}); used a procedural fallback texture.`,
      );
    }
  } else if (process.env.MODFORGE_VANILLA_ASSETS_DIR) {
    // User opted in but the file isn't on disk — surface that.
    c.noticeMessages.push(
      `Original vanilla texture for ${feature.details.vanillaTarget} was not found in MODFORGE_VANILLA_ASSETS_DIR; used a procedural fallback texture.`,
    );
  }
  return generateTexturePng({
    primaryColorHex: feature.details.textureColor,
    secondaryColorHex: feature.details.secondaryColor,
    style: feature.details.textureStyle,
    glowing: feature.details.glowing ?? false,
    faceMode: "item",
    silhouette: silhouetteForVanillaItem(feature.details.vanillaTarget),
  });
}
