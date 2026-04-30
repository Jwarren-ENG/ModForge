import type { ModSpec, RetextureBlockFeatureT } from "../schemas.js";
import { generateTexturePng } from "../textures/index.js";
import { VANILLA_BLOCK_TARGETS, type Face } from "../textures/vanillaTargets.js";
import { emptyContribution, type FeatureContribution } from "./types.js";

/**
 * Vanilla block retexture: writes one PNG per requested face. Allowed faces
 * and their texture paths come exclusively from VANILLA_BLOCK_TARGETS — no
 * user-supplied path ever reaches the writer.
 */
export function generateRetextureBlock(
  _spec: ModSpec,
  feature: RetextureBlockFeatureT,
): FeatureContribution {
  const c = emptyContribution();
  const target = VANILLA_BLOCK_TARGETS[feature.details.vanillaTarget];
  if (!target) {
    throw new Error(
      `vanillaTarget "${feature.details.vanillaTarget}" not in allowlist`,
    );
  }
  const requested: Face[] = (feature.details.faces ?? target.defaultFaces) as Face[];

  // "all" semantics depend on the target:
  //   - simple blocks (stone, dirt, ...) have texturePaths.all -> emit one PNG
  //   - multi-face blocks (grass_block) lack texturePaths.all -> expand to all
  //     concrete face keys (top, side, ...). De-dupe so callers can't sneak in
  //     a duplicate face by mixing "all" with explicit faces.
  const faces: Face[] = [];
  const seen = new Set<Face>();
  for (const f of requested) {
    if (f === "all" && !target.texturePaths.all) {
      for (const concrete of Object.keys(target.texturePaths) as Face[]) {
        if (concrete === "all") continue;
        if (!seen.has(concrete)) {
          seen.add(concrete);
          faces.push(concrete);
        }
      }
    } else {
      if (!seen.has(f)) {
        seen.add(f);
        faces.push(f);
      }
    }
  }

  let salt = 0;
  for (const face of faces) {
    const texPath = target.texturePaths[face];
    if (!texPath) {
      // Should be unreachable; schema validates allowed faces.
      throw new Error(
        `face "${face}" has no texture path for "${feature.details.vanillaTarget}"`,
      );
    }
    c.resources.push({
      path: `src/main/resources/${texPath}`,
      content: generateTexturePng({
        primaryColorHex: feature.details.textureColor,
        secondaryColorHex: feature.details.secondaryColor,
        style: feature.details.textureStyle,
        glowing: feature.details.glowing ?? false,
        faceMode: face,
        salt: salt++,
      }),
    });
  }
  return c;
}
