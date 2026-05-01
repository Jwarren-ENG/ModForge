import type { Buffer } from "node:buffer";
import type { ModSpec, ToolFeatureT, WeaponFeatureT } from "../schemas.js";
import { generateTexturePng } from "../textures/index.js";
import { silhouetteForWeaponType } from "../textures/silhouettes.js";
import { constName, humanize, pascalCase } from "./utils.js";
import { emptyContribution, type FeatureContribution } from "./types.js";

/**
 * Generate a simple custom-melee item. The "hammer" style has elevated
 * knockback and overrides postHit; "sword"/"mace"/"club"/"custom-melee"
 * follow the same pattern. We deliberately keep it as a plain Item subclass
 * (NOT SwordItem/ToolMaterial) — that path is brittle on Yarn 1.20.1 and was
 * the source of past repair-loop fixes.
 */
export function generateToolOrWeapon(
  spec: ModSpec,
  feature: ToolFeatureT | WeaponFeatureT,
  aiTexture?: Buffer,
): FeatureContribution {
  const c = emptyContribution();
  const fieldName = constName(feature.id);
  const display =
    feature.details.displayName ?? (humanize(feature.name) || humanize(feature.id));
  const className = `${pascalCase(feature.id)}Item`;
  const knockback = feature.details.knockback ?? 1.5;
  const durability = feature.details.durability ?? 250;

  // --- Field + register: same shape as item registration ---
  c.imports.push(
    "net.minecraft.item.Item",
    "net.minecraft.registry.Registries",
    "net.minecraft.registry.Registry",
    "net.minecraft.util.Identifier",
    `${spec.packageName}.${className}`,
  );
  c.fieldDecls.push(
    `    public static final Item ${fieldName} = new ${className}(new Item.Settings().maxDamage(${durability}), ${num(knockback)});`,
  );
  c.itemRegisters.push(
    `        Registry.register(Registries.ITEM, new Identifier(MOD_ID, "${feature.id}"), ${fieldName});`,
  );

  // --- Custom Item subclass file ---
  const javaPath = `src/main/java/${spec.packageName.replace(/\./g, "/")}/${className}.java`;
  c.extraJavaFiles.push({
    path: javaPath,
    content: subclassSource(spec.packageName, className),
  });

  // --- Resources ---
  c.resources.push({
    path: `src/main/resources/assets/${spec.modId}/models/item/${feature.id}.json`,
    content:
      JSON.stringify(
        {
          parent: "minecraft:item/handheld",
          textures: { layer0: `${spec.modId}:item/${feature.id}` },
        },
        null,
        2,
      ) + "\n",
  });

  // Texture: prefer AI bytes when the orchestrator pre-fetched them, else
  // fall back to the deterministic procedural silhouette (only if we have a
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
        style: feature.details.textureStyle ?? "metal",
        glowing: feature.details.glowing ?? false,
        faceMode: "item",
        silhouette: silhouetteForWeaponType(feature.details.weaponType),
      }),
    });
  }

  c.langEntries[`item.${spec.modId}.${feature.id}`] = display;
  return c;
}

function subclassSource(packageName: string, className: string): string {
  // Self-contained: no @Override on methods we aren't 100% sure about; postHit
  // is a stable Item method on Yarn 1.20.1.
  return `package ${packageName};

import net.minecraft.entity.LivingEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.math.MathHelper;

public class ${className} extends Item {
    private final float bonusKnockback;

    public ${className}(Settings settings, float bonusKnockback) {
        super(settings);
        this.bonusKnockback = bonusKnockback;
    }

    @Override
    public boolean postHit(ItemStack stack, LivingEntity target, LivingEntity attacker) {
        float yawRad = attacker.getYaw() * ((float) Math.PI / 180F);
        target.takeKnockback(this.bonusKnockback, MathHelper.sin(yawRad), -MathHelper.cos(yawRad));
        return super.postHit(stack, target, attacker);
    }
}
`;
}

function num(n: number): string {
  const s = Number.isInteger(n) ? `${n}.0` : `${n}`;
  return `${s}f`;
}
