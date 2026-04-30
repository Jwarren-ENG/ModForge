import type { ModSpec, RecipeFeatureT } from "../schemas.js";
import { ingredientObject, parseItemRef } from "./utils.js";
import { emptyContribution, type FeatureContribution } from "./types.js";

/**
 * Recipes only produce a JSON file under data/<modid>/recipes/<id>.json.
 * No Java contributions.
 */
export function generateRecipe(
  spec: ModSpec,
  feature: RecipeFeatureT,
): FeatureContribution {
  const c = emptyContribution();
  const ns = spec.modId;
  const d = feature.details;
  const result = {
    item: parseItemRef(d.result.itemId, ns).full,
    count: d.result.count,
  };

  let recipeJson: Record<string, unknown>;

  if (d.shape === "shaped") {
    if (!d.pattern || !d.key) {
      // Cannot synthesize a shaped recipe without pattern/key. Skip; the
      // orchestrator will treat the spec as not fully covered.
      throw new Error(
        `recipe ${feature.id}: shaped recipe requires "pattern" and "key" in details`,
      );
    }
    const keyOut: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d.key)) {
      keyOut[k] = ingredientObject(v, ns);
    }
    recipeJson = {
      type: "minecraft:crafting_shaped",
      pattern: d.pattern,
      key: keyOut,
      result,
    };
  } else {
    if (!d.ingredients || d.ingredients.length === 0) {
      throw new Error(
        `recipe ${feature.id}: shapeless recipe requires non-empty "ingredients"`,
      );
    }
    recipeJson = {
      type: "minecraft:crafting_shapeless",
      ingredients: d.ingredients.map((ing) => ingredientObject(ing, ns)),
      result,
    };
  }

  c.resources.push({
    path: `src/main/resources/data/${ns}/recipes/${feature.id}.json`,
    content: JSON.stringify(recipeJson, null, 2) + "\n",
  });
  return c;
}
