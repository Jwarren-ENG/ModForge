import type { ModSpec, RetextureItemFeatureT } from "../schemas.js";
import { generateTexturePng } from "../textures/index.js";
import { VANILLA_ITEM_TARGETS } from "../textures/vanillaTargets.js";
import { emptyContribution, type FeatureContribution } from "./types.js";

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
  c.resources.push({
    path: `src/main/resources/${target.texturePath}`,
    content: generateTexturePng({
      primaryColorHex: feature.details.textureColor,
      secondaryColorHex: feature.details.secondaryColor,
      style: feature.details.textureStyle,
      glowing: feature.details.glowing ?? false,
      faceMode: "item",
    }),
  });
  return c;
}
