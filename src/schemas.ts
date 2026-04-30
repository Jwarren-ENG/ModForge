import { z } from "zod";
import {
  isVanillaBlockTarget,
  isVanillaItemTarget,
  vanillaBlockKeys,
  vanillaItemKeys,
  VANILLA_BLOCK_TARGETS,
} from "./textures/vanillaTargets.js";

// ---------- primitives ----------

const SnakeId = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, "must be snake_case (a-z, 0-9, _; start with a letter)");

const JavaPackage = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
    "must be a dotted lowercase Java package",
  );

const JavaClass = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9_]*$/, "must be PascalCase identifier");

const SemverLike = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.\-]+)?$/,
    "must look like 1.2.3 or 1.2.3-beta.1",
  );

const ItemRef = z
  .string()
  .regex(
    /^(?:[a-z][a-z0-9_.-]*:)?[a-z][a-z0-9_/.-]*$/,
    "must be 'namespace:path' or 'path'",
  );

const RecipeIngredient = z
  .string()
  .regex(
    /^#?(?:[a-z][a-z0-9_.-]*:)?[a-z][a-z0-9_/.-]*$/,
    "must be 'namespace:path', 'path', '#namespace:tag', or '#tag'",
  );

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb hex color");

const TextureStyle = z.enum([
  "plain",
  "gem",
  "crystal",
  "metal",
  "stone",
  "grass",
]);

const Face = z.enum(["top", "side", "bottom", "all"]);

const SoundGroup = z.enum([
  "stone", "metal", "wood", "glass", "gravel", "sand", "grass", "wool",
]);
const MiningTool = z.enum(["pickaxe", "axe", "shovel", "hoe"]);
const MiningLevel = z.enum(["wood", "stone", "iron", "diamond", "netherite"]);

// Texture fields shared across original-item, original-block, tool/weapon details.
const TextureFields = {
  textureStyle: TextureStyle.optional(),
  textureColor: HexColor.optional(),
  secondaryColor: HexColor.optional(),
  glowing: z.boolean().optional(),
};

// ---------- per-type details (all strict) ----------

const ItemDetails = z
  .object({
    displayName: z.string().optional(),
    maxStackSize: z.number().int().min(1).max(64).optional(),
    ...TextureFields,
  })
  .strict();

const BlockDetails = z
  .object({
    displayName: z.string().optional(),
    hardness: z.number().min(0).optional(),
    resistance: z.number().min(0).optional(),
    soundGroup: SoundGroup.optional(),
    requiresTool: z.boolean().optional(),
    miningTool: MiningTool.optional(),
    miningLevel: MiningLevel.optional(),
    drops: z.literal("self").optional(),
    ...TextureFields,
  })
  .strict();

const ToolWeaponDetails = z
  .object({
    displayName: z.string().optional(),
    weaponType: z
      .enum(["hammer", "mace", "club", "sword", "custom-melee"])
      .optional(),
    knockback: z.number().min(0).max(10).optional(),
    attackDamage: z.number().min(0).max(20).optional(),
    durability: z.number().int().min(1).optional(),
    ...TextureFields,
  })
  .strict();

const RecipeResult = z
  .object({
    itemId: ItemRef,
    count: z.number().int().min(1).max(64).default(1),
  })
  .strict();

const ShapedRecipeDetails = z
  .object({
    shape: z.literal("shaped"),
    result: RecipeResult,
    pattern: z.array(z.string().min(1).max(3)).min(1).max(3),
    key: z.record(z.string().length(1), RecipeIngredient),
  })
  .strict();

const ShapelessRecipeDetails = z
  .object({
    shape: z.literal("shapeless"),
    result: RecipeResult,
    ingredients: z.array(RecipeIngredient).min(1).max(9),
  })
  .strict();

const RecipeDetails = z.discriminatedUnion("shape", [
  ShapedRecipeDetails,
  ShapelessRecipeDetails,
]);

const CommandDetails = z
  .object({
    commandName: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "command name must be snake-case lowercase"),
    permissionLevel: z.number().int().min(0).max(4).default(2),
    action: z
      .object({
        type: z.literal("give-item"),
        itemId: ItemRef,
        count: z.number().int().min(1).max(64).default(1),
      })
      .strict(),
  })
  .strict();

const RetextureItemDetails = z
  .object({
    vanillaTarget: z
      .string()
      .regex(/^minecraft:[a-z][a-z0-9_]*$/, "must be 'minecraft:<id>'"),
    textureStyle: TextureStyle,
    textureColor: HexColor,
    secondaryColor: HexColor.optional(),
    glowing: z.boolean().optional(),
  })
  .strict();

const RetextureBlockDetails = z
  .object({
    vanillaTarget: z
      .string()
      .regex(/^minecraft:[a-z][a-z0-9_]*$/, "must be 'minecraft:<id>'"),
    textureStyle: TextureStyle,
    textureColor: HexColor,
    secondaryColor: HexColor.optional(),
    glowing: z.boolean().optional(),
    faces: z.array(Face).min(1).optional(),
  })
  .strict();

// ---------- features ----------

const FeatureBase = {
  id: SnakeId,
  name: z.string().min(1),
  description: z.string().default(""),
};

const ItemFeature = z.object({
  type: z.literal("item"),
  ...FeatureBase,
  details: ItemDetails.default({}),
});
const BlockFeature = z.object({
  type: z.literal("block"),
  ...FeatureBase,
  details: BlockDetails.default({}),
});
const ToolFeature = z.object({
  type: z.literal("tool"),
  ...FeatureBase,
  details: ToolWeaponDetails.default({}),
});
const WeaponFeature = z.object({
  type: z.literal("weapon"),
  ...FeatureBase,
  details: ToolWeaponDetails.default({}),
});
const RecipeFeature = z.object({
  type: z.literal("recipe"),
  ...FeatureBase,
  details: RecipeDetails,
});
const CommandFeature = z.object({
  type: z.literal("command"),
  ...FeatureBase,
  details: CommandDetails,
});
const RetextureItemFeature = z.object({
  type: z.literal("retexture_item"),
  ...FeatureBase,
  details: RetextureItemDetails,
});
const RetextureBlockFeature = z.object({
  type: z.literal("retexture_block"),
  ...FeatureBase,
  details: RetextureBlockDetails,
});

export const FeatureSchema = z.discriminatedUnion("type", [
  ItemFeature,
  BlockFeature,
  ToolFeature,
  WeaponFeature,
  RecipeFeature,
  CommandFeature,
  RetextureItemFeature,
  RetextureBlockFeature,
]);

// ---------- ModSpec + cross-validation ----------

const ModSpecBase = z.object({
  modId: SnakeId,
  modName: z.string().min(1),
  modVersion: SemverLike.default("1.0.0"),
  mcVersion: z.string().min(1),
  modLoader: z.literal("fabric"),
  packageName: JavaPackage,
  mainClass: JavaClass,
  description: z.string().default(""),
  features: z.array(FeatureSchema).default([]),
  filesToCreate: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
});

const JAVA_RESERVED: ReadonlySet<string> = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new",
  "package", "private", "protected", "public", "return", "short", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while",
  "true", "false", "null",
  "var", "yield", "record", "sealed", "permits",
]);

function pascalCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter((p) => p.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

export const ModSpecSchema = ModSpecBase.superRefine((spec, ctx) => {
  // 1. Unique feature ids.
  const seenIds = new Map<string, number>();
  spec.features.forEach((f, i) => {
    const prev = seenIds.get(f.id);
    if (prev !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate feature id "${f.id}" (also at features[${prev}])`,
        path: ["features", i, "id"],
      });
    } else {
      seenIds.set(f.id, i);
    }
  });

  // 2. Unique command names.
  const cmdSeen = new Map<string, number>();
  spec.features.forEach((f, i) => {
    if (f.type !== "command") return;
    const name = f.details.commandName;
    const prev = cmdSeen.get(name);
    if (prev !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate command name "${name}" (also at features[${prev}])`,
        path: ["features", i, "details", "commandName"],
      });
    } else {
      cmdSeen.set(name, i);
    }
  });

  // 3. Java class collisions among generated classes.
  const generatedClasses = new Map<string, string>();
  generatedClasses.set(spec.mainClass, "mainClass");
  spec.features.forEach((f, i) => {
    if (f.type !== "tool" && f.type !== "weapon") return;
    const cls = `${pascalCase(f.id)}Item`;
    if (generatedClasses.has(cls)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `generated class name "${cls}" collides with ${generatedClasses.get(cls)}`,
        path: ["features", i, "id"],
      });
    } else {
      generatedClasses.set(cls, `features[${i}]`);
    }
  });

  // 4. Java reserved words in package + class names.
  for (const seg of spec.packageName.split(".")) {
    if (JAVA_RESERVED.has(seg)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `package segment "${seg}" is a Java reserved word`,
        path: ["packageName"],
      });
    }
  }
  if (JAVA_RESERVED.has(spec.mainClass)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `mainClass "${spec.mainClass}" is a Java reserved word`,
      path: ["mainClass"],
    });
  }
  spec.features.forEach((f, i) => {
    if (f.type !== "tool" && f.type !== "weapon") return;
    const cls = `${pascalCase(f.id)}Item`;
    if (JAVA_RESERVED.has(cls) || JAVA_RESERVED.has(cls.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `generated class name "${cls}" is a Java reserved word`,
        path: ["features", i, "id"],
      });
    }
  });

  // 5. Local item references must point to declared item/block/tool/weapon features.
  const localItemIds = new Set<string>();
  for (const f of spec.features) {
    if (
      f.type === "item" ||
      f.type === "block" ||
      f.type === "tool" ||
      f.type === "weapon"
    ) {
      localItemIds.add(f.id);
    }
  }
  const checkRef = (ref: string, path: (string | number)[]) => {
    if (ref.startsWith("#")) return;
    const colon = ref.indexOf(":");
    let ns: string;
    let p: string;
    if (colon > 0) {
      ns = ref.slice(0, colon);
      p = ref.slice(colon + 1);
    } else {
      ns = spec.modId;
      p = ref;
    }
    if (ns === spec.modId && !localItemIds.has(p)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `local item reference "${ref}" does not match any declared item/block/tool/weapon feature`,
        path,
      });
    }
  };
  spec.features.forEach((f, i) => {
    if (f.type === "recipe") {
      checkRef(f.details.result.itemId, [
        "features", i, "details", "result", "itemId",
      ]);
      if (f.details.shape === "shaped") {
        for (const [k, v] of Object.entries(f.details.key)) {
          checkRef(v, ["features", i, "details", "key", k]);
        }
      } else {
        f.details.ingredients.forEach((ing, j) =>
          checkRef(ing, ["features", i, "details", "ingredients", j]),
        );
      }
    } else if (f.type === "command") {
      checkRef(f.details.action.itemId, [
        "features", i, "details", "action", "itemId",
      ]);
    }
  });

  // 6. Shaped recipe cross-field validation.
  spec.features.forEach((f, i) => {
    if (f.type !== "recipe" || f.details.shape !== "shaped") return;
    const { pattern, key } = f.details;
    const widths = pattern.map((r) => r.length);
    if (new Set(widths).size > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `all pattern rows must have the same width (got widths: ${widths.join(",")})`,
        path: ["features", i, "details", "pattern"],
      });
    }
    const usedChars = new Set(
      [...pattern.join("")].filter((c) => c !== " "),
    );
    for (const ch of usedChars) {
      if (!(ch in key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `pattern uses '${ch}' but it is not defined in key`,
          path: ["features", i, "details", "key"],
        });
      }
    }
    for (const k of Object.keys(key)) {
      if (!usedChars.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `key '${k}' is defined but not used in pattern`,
          path: ["features", i, "details", "key", k],
        });
      }
    }
  });

  // 7a. Duplicate retexture target detection.
  //     Two retexture features that target the same vanilla item, or two
  //     retexture_block features whose face sets overlap on the same target,
  //     would race to write the same PNG. Reject the second one.
  const retextureItemSeen = new Map<string, number>();
  spec.features.forEach((f, i) => {
    if (f.type !== "retexture_item") return;
    const key = f.details.vanillaTarget;
    const prev = retextureItemSeen.get(key);
    if (prev !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate retexture_item target "${key}" (also at features[${prev}])`,
        path: ["features", i, "details", "vanillaTarget"],
      });
    } else {
      retextureItemSeen.set(key, i);
    }
  });
  // For blocks we track by (target, face). Need to expand "all" to concrete
  // faces using the allowlist so overlap detection is correct.
  const retextureBlockSeen = new Map<string, number>();
  spec.features.forEach((f, i) => {
    if (f.type !== "retexture_block") return;
    const target = VANILLA_BLOCK_TARGETS[f.details.vanillaTarget];
    if (!target) return; // already reported by 7b below
    const requested = f.details.faces ?? target.defaultFaces;
    // Reject duplicates within a single feature's faces.
    const facesSeen = new Set<string>();
    requested.forEach((face, j) => {
      if (facesSeen.has(face)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate face "${face}" in retexture_block feature`,
          path: ["features", i, "details", "faces", j],
        });
      } else {
        facesSeen.add(face);
      }
    });
    // Expand "all" the same way the generator will.
    const concreteFaces: string[] = [];
    for (const face of requested) {
      if (face === "all" && !target.texturePaths.all) {
        for (const k of Object.keys(target.texturePaths)) {
          if (k !== "all") concreteFaces.push(k);
        }
      } else {
        concreteFaces.push(face);
      }
    }
    for (const face of concreteFaces) {
      const key = `${f.details.vanillaTarget}::${face}`;
      const prev = retextureBlockSeen.get(key);
      if (prev !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate retexture_block target "${f.details.vanillaTarget}" face "${face}" (also at features[${prev}])`,
          path: ["features", i, "details", "vanillaTarget"],
        });
      } else {
        retextureBlockSeen.set(key, i);
      }
    }
  });

  // 7b. Retexture vanillaTarget allowlist.
  spec.features.forEach((f, i) => {
    if (f.type === "retexture_item") {
      if (!isVanillaItemTarget(f.details.vanillaTarget)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `vanillaTarget "${f.details.vanillaTarget}" is not in the retexture allowlist. Allowed item targets: ${vanillaItemKeys().join(", ")}`,
          path: ["features", i, "details", "vanillaTarget"],
        });
      }
    } else if (f.type === "retexture_block") {
      const target = f.details.vanillaTarget;
      if (!isVanillaBlockTarget(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `vanillaTarget "${target}" is not in the retexture allowlist. Allowed block targets: ${vanillaBlockKeys().join(", ")}`,
          path: ["features", i, "details", "vanillaTarget"],
        });
        return;
      }
      // If faces specified, every requested face must be allowed for this target.
      if (f.details.faces) {
        const allowed = new Set(VANILLA_BLOCK_TARGETS[target]!.allowedFaces);
        for (let j = 0; j < f.details.faces.length; j++) {
          const face = f.details.faces[j]!;
          if (!allowed.has(face)) {
            const base = `grass_block supports top, side, or all. Use "all" to retexture the visible grass faces (the bottom face is dirt and is not part of the grass retexture target).`;
            const generic = `face "${face}" is not allowed for "${target}". Allowed: ${[...allowed].join(", ")}`;
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: target === "minecraft:grass_block" ? base : generic,
              path: ["features", i, "details", "faces", j],
            });
          }
        }
      }
    }
  });
});

// ---------- generic LLM response schemas ----------

export const GeneratedFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const CodegenResponseSchema = z.object({
  files: z.array(GeneratedFileSchema).min(1),
});

export const RepairResponseSchema = z.object({
  diagnosis: z.string().optional(),
  files: z.array(GeneratedFileSchema),
});

// ---------- types ----------

export type ModSpec = z.infer<typeof ModSpecSchema>;
export type ModFeature = z.infer<typeof FeatureSchema>;
export type ItemFeatureT = z.infer<typeof ItemFeature>;
export type BlockFeatureT = z.infer<typeof BlockFeature>;
export type ToolFeatureT = z.infer<typeof ToolFeature>;
export type WeaponFeatureT = z.infer<typeof WeaponFeature>;
export type RecipeFeatureT = z.infer<typeof RecipeFeature>;
export type CommandFeatureT = z.infer<typeof CommandFeature>;
export type RetextureItemFeatureT = z.infer<typeof RetextureItemFeature>;
export type RetextureBlockFeatureT = z.infer<typeof RetextureBlockFeature>;
export type CodegenResponse = z.infer<typeof CodegenResponseSchema>;
export type RepairResponse = z.infer<typeof RepairResponseSchema>;

// ---------- helpers ----------

export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  label: string,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues
    .slice(0, 12)
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(
    `${label} failed schema validation:\n${issues}${
      result.error.issues.length > 12
        ? `\n  ... and ${result.error.issues.length - 12} more issue(s)`
        : ""
    }`,
  );
}
