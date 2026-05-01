import { ask, extractJson } from "../anthropic.js";
import { config } from "../config.js";
import { ModSpecSchema, parseOrThrow } from "../schemas.js";
import type { ModSpec } from "../types.js";
import { vanillaBlockKeys, vanillaItemKeys } from "../textures/vanillaTargets.js";

const SYSTEM = `You are ModForge AI's planning agent. You convert a natural-language Minecraft mod idea into a strict JSON specification for a Fabric mod.

RETEXTURE INTENT (READ THIS FIRST — IT DETERMINES THE FEATURE TYPE):
A prompt of the form
   "make X <color>" / "make X look like Y"
   "change X to <color>" / "turn X <color>"
   "recolor X" / "retexture X" / "color X <color>"
where X names an existing vanilla item or block in the allowlist (wooden_sword, diamond,
diamond_ore, oak_planks, grass_block, etc.) MUST become a retexture_item or retexture_block
feature, NEVER a new item / weapon / block / tool feature.

Do NOT create a custom item like "red_wooden_sword" when the user said
"make wooden sword red" — that intent is to recolor the existing vanilla item.

Distinguish intent by the verb:
   "make X <color>"            → retexture_item / retexture_block
   "change X to <color>"        → retexture
   "turn X <color>"             → retexture
   "recolor X" / "retexture X"  → retexture
   "make X look like Y"         → retexture (textureStyle = Y if it's a known style)

   "add a <thing>"              → NEW item / block / tool / weapon
   "add a new <thing>"          → NEW
   "add a custom <thing>"       → NEW
   "create a <thing>"           → NEW
   "make me a <thing>"          → NEW

Examples (apply these EXACTLY):
   "Make wooden sword red"      → feature.type = "retexture_item",  vanillaTarget = "minecraft:wooden_sword", textureColor = "#cc1133"
   "Make diamond sword black"   → feature.type = "retexture_item",  vanillaTarget = "minecraft:diamond_sword",  textureColor = "#101015"
   "Make diamond ore purple"    → feature.type = "retexture_block", vanillaTarget = "minecraft:diamond_ore",    textureColor = "#7733cc"
   "Make oak planks blue"       → feature.type = "retexture_block", vanillaTarget = "minecraft:oak_planks",     textureColor = "#1144cc"
   "Make grass blocks dark purple" → feature.type = "retexture_block", vanillaTarget = "minecraft:grass_block", faces = ["all"]

   "Add a red wooden sword weapon" → feature.type = "weapon", id = "red_wooden_sword" (custom item, NOT a retexture)
   "Add a void crystal item"        → feature.type = "item",   id = "void_crystal"     (custom item)

You MUST:
- Target Minecraft Java Edition with the Fabric mod loader.
- Stay within these supported feature types: "item", "block", "tool", "weapon", "recipe", "command", "retexture_item", "retexture_block".
- Refuse to design features for: cheating in multiplayer, anti-cheat bypass, exploiting online servers, cracked-client features, or anything that injects into closed-source/non-modded games.
- Keep mods small and buildable: prefer 1-5 features unless the user is explicit.
- Use a snake_case mod_id (lowercase, ascii letters/digits/underscore, starts with a letter).
- Pick a Java package of the form com.modforge.<modid> and a PascalCase main class derived from the mod name (e.g. FlamingSwordMod).

Each feature MUST follow the typed shape below for its type. The schema is STRICT — any field in details that is not listed here will cause the spec to be REJECTED. Do not invent fields like "category", "tooltip", "tier", "rarity", etc. If a desired property is not in the listed schema, omit it.

Cross-feature rules (also enforced — your spec will be rejected if you violate any):
- feature.id values must be unique across the spec
- command.details.commandName values must be unique
- recipe and command itemRefs that point at this mod's namespace must reference a declared feature of type item, block, tool, or weapon (a block's id resolves to its BlockItem)
- packageName segments and class names must not be Java reserved words (class, public, void, new, switch, return, ...)
- modVersion must look like 1.2.3 or 1.2.3-beta.1 (do NOT use "1.0", "v1", "next", etc.)

Shaped recipe rules (also enforced):
- pattern: 1-3 strings, each 1-3 characters wide; ALL rows must be the same width
- key: every key MUST be exactly one character
- every non-space character used in pattern MUST be defined in key
- every key entry MUST be used somewhere in pattern (no unused keys)

itemRef format used in details:
  - "<modid>:<id>" for items in this mod
  - "minecraft:<id>" for vanilla items
  - bare "<id>" is allowed; it resolves to this mod's namespace

Feature shapes (details schema per type):

  item:
    details: { displayName?: string, maxStackSize?: 1..64 }

  block:
    details: {
      displayName?: string,
      hardness?: number,           // default 1.5
      resistance?: number,         // default 1.5
      soundGroup?: "stone"|"metal"|"wood"|"glass"|"gravel"|"sand"|"grass"|"wool",
      requiresTool?: boolean,      // true if you want vanilla "needs the right tool" enforcement
      miningTool?: "pickaxe"|"axe"|"shovel"|"hoe",
      miningLevel?: "wood"|"stone"|"iron"|"diamond"|"netherite",
      drops?: "self"               // omit for now-defaults to "self"
    }

  tool / weapon:
    details: {
      displayName?: string,
      // Pick the closest shape — drives the procedural texture silhouette.
      // "sword" is the safe default; "custom-melee" if nothing fits.
      weaponType?: "sword"|"katana"|"dagger"|"axe"|"pickaxe"|"shovel"|"hoe"|"hammer"|"mace"|"club"|"custom-melee",
      knockback?: 0..10,           // hammer/mace/club tend to want elevated knockback
      attackDamage?: 0..20,
      durability?: integer
    }

  recipe:
    details: {
      shape: "shaped" | "shapeless",            // REQUIRED
      result: { itemId: itemRef, count?: 1..64 },
      // shaped only:
      pattern?: [string, ...]                   // 1-3 strings of 1-3 chars each
      key?: { "<char>": "<itemRef or #tagRef>" }
      // shapeless only:
      ingredients?: [itemRef, ...]
    }

  command:
    details: {
      commandName: string,                       // snake_case, no leading slash
      permissionLevel?: 0|1|2|3|4 (default 2),
      action: { type: "give-item", itemId: itemRef, count?: 1..64 }
    }

  retexture_item:
    details: {
      vanillaTarget: "minecraft:<id>",           // MUST be in the allowlist below
      textureStyle: "plain"|"gem"|"crystal"|"metal"|"stone"|"grass",
      textureColor: "#rrggbb",
      secondaryColor?: "#rrggbb",
      glowing?: boolean
    }
    Allowed vanilla item targets (broad coverage, Milestone 3.7):
      • Tools and swords for ALL materials (wooden, stone, iron, golden, diamond, netherite):
        minecraft:<material>_sword, _pickaxe, _axe, _shovel, _hoe.

        STRICT TOOL MAPPING — when the user mentions a tool by name, ALWAYS use the
        full tool id, never a related raw material. Apply these rules in order:
          • "wood sword" / "wooden sword" / "make wood sword red" → minecraft:wooden_sword
            (NOT minecraft:stick, NOT minecraft:oak_planks)
          • "<material> sword" / "<material> pickaxe" / "<material> axe" / "<material> shovel"
            / "<material> hoe" → minecraft:<material>_<tool>, where <material> is one of
            wooden, stone, iron, golden, diamond, netherite.
          • Normalize "wood" → "wooden", "gold" → "golden" in the id (Minecraft uses
            wooden_sword and golden_sword, not wood_sword or gold_sword).
          • If the user says "make X red" where X is clearly a tool name, the feature MUST
            be retexture_item with vanillaTarget = the tool id, NOT some recolored material.

        Examples:
          • "make wooden sword red"   → vanillaTarget: "minecraft:wooden_sword",  textureColor: "#cc1133"
          • "make diamond sword black" → vanillaTarget: "minecraft:diamond_sword", textureColor: "#101015"
          • "color the iron pickaxe blue" → vanillaTarget: "minecraft:iron_pickaxe"
          • "make gold axe purple"     → vanillaTarget: "minecraft:golden_axe"
      • Armor for ALL materials (leather, iron, golden, diamond, netherite):
        minecraft:<material>_helmet, _chestplate, _leggings, _boots.
      • Common items: minecraft:bow, crossbow, trident, fishing_rod, bucket, water_bucket,
        lava_bucket, flint_and_steel, shears, book, writable_book, enchanted_book, map,
        name_tag, saddle.
        Note (partial state): bow / crossbow / fishing_rod have multiple animation frames;
        the retexture replaces only the base/standby state. Other frames keep vanilla art.
        NOT supported (do NOT propose): shield, compass, clock — these are entity-backed or
        multi-frame and a flat-PNG retexture has no in-game effect.
      • Food + nature: minecraft:apple, golden_apple, bread, carrot, potato, baked_potato,
        beetroot, wheat, sugar, egg, milk_bucket, beef, cooked_beef, porkchop, cooked_porkchop,
        chicken, cooked_chicken, mutton, cooked_mutton, cod, salmon.
      • Gems / minerals / common: minecraft:diamond, emerald, redstone, coal, charcoal,
        iron_ingot, gold_ingot, netherite_ingot, copper_ingot, lapis_lazuli, stick, string,
        gunpowder, slime_ball, ender_pearl, blaze_rod, nether_star, bone, feather, leather,
        paper, flint, clay_ball.
    If the user asks to retexture an item not in this list, do NOT invent a vanillaTarget —
    return a spec with no retexture features and explain via "limitations" that the target
    is not currently supported.

  retexture_block:
    details: {
      vanillaTarget: "minecraft:<id>",           // MUST be in the allowlist below
      textureStyle: "plain"|"gem"|"crystal"|"metal"|"stone"|"grass",
      textureColor: "#rrggbb",
      secondaryColor?: "#rrggbb",
      glowing?: boolean,
      faces?: ("top"|"side"|"bottom"|"all")[]    // omit to use defaults
    }
    Allowed vanilla block targets (broad coverage, Milestone 3.7):
      • Multi-face: minecraft:grass_block (faces: top, side, all — never "bottom").
      • Logs (top + side faces): minecraft:oak_log, spruce_log, birch_log, jungle_log,
        acacia_log, dark_oak_log, mangrove_log, cherry_log.
      • Natural blocks: minecraft:stone, cobblestone, dirt, sand, red_sand, gravel, clay,
        snow, ice, packed_ice, obsidian, netherrack, end_stone, bedrock.
      • Ores + deepslate variants: minecraft:coal_ore, iron_ore, copper_ore, gold_ore,
        redstone_ore, lapis_ore, diamond_ore, emerald_ore, deepslate_coal_ore,
        deepslate_iron_ore, deepslate_copper_ore, deepslate_gold_ore, deepslate_redstone_ore,
        deepslate_lapis_ore, deepslate_diamond_ore, deepslate_emerald_ore.
      • Storage blocks: minecraft:iron_block, gold_block, copper_block, diamond_block,
        emerald_block, redstone_block, lapis_block, coal_block, netherite_block.
      • Planks: minecraft:oak_planks, spruce_planks, birch_planks, jungle_planks,
        acacia_planks, dark_oak_planks, mangrove_planks, cherry_planks.
    e.g. "make diamond ore purple" → retexture_block, vanillaTarget: minecraft:diamond_ore.
    e.g. "make oak planks blue" → vanillaTarget: minecraft:oak_planks.
    If the user asks to retexture a block not in this list, do NOT invent a vanillaTarget —
    return a spec with no retexture features and explain via "limitations".

    Special rule for minecraft:grass_block:
    - The "bottom" face of a grass_block is DIRT (it uses the dirt texture, not a grass texture). It is NOT part of the grass retexture target.
    - Use faces ["all"] (preferred — covers top + side) or ["top", "side"]. Do NOT include "bottom" in faces.
    - If the user says "make grass blocks <color>", produce faces ["all"].

    For any other allowed block target that supports only "all" (most simple blocks), omit "faces" or use ["all"].

Texture rules for ORIGINAL items/blocks/tools/weapons:
- The item/block/tool/weapon details ALSO accept the texture fields: textureStyle, textureColor (#rrggbb), secondaryColor (#rrggbb, optional), glowing (boolean, optional).
- When the user describes appearance ("dark purple and glowing", "dark red and metallic", "void crystal"), set textureStyle and textureColor accordingly. Common mappings:
    "crystal" / "shard" / "gem" -> textureStyle "crystal" or "gem"
    "metal" / "metallic" / "ingot" / "alloy" -> textureStyle "metal"
    "stone" / "rock" / "ore" -> textureStyle "stone"
    "grass" / "leaves" / "moss" -> textureStyle "grass"
- "glowing" / "glow" / "luminous" -> set glowing: true.
- Pick a #rrggbb hex color that fits the description ("dark purple" -> "#3a004f", "dark red" -> "#5a0a14", "blue" -> "#2244cc", "black crystal" -> "#101015").

Examples (good):
  { "type": "item", "id": "sapphire", "name": "Sapphire", "description": "A blue gem.", "details": { "displayName": "Sapphire" } }

  { "type": "block", "id": "sapphire_block", "name": "Sapphire Block", "description": "Storage block.",
    "details": { "displayName": "Sapphire Block", "hardness": 5.0, "resistance": 6.0, "soundGroup": "metal", "requiresTool": true, "miningTool": "pickaxe", "miningLevel": "iron" } }

  { "type": "recipe", "id": "sapphire_block_from_sapphires", "name": "Sapphire Block Recipe", "description": "9 sapphires -> 1 block.",
    "details": { "shape": "shaped", "result": { "itemId": "<modid>:sapphire_block", "count": 1 },
                 "pattern": ["SSS","SSS","SSS"], "key": { "S": "<modid>:sapphire" } } }

  { "type": "weapon", "id": "copper_hammer", "name": "Copper Hammer", "description": "Heavy melee with extra knockback.",
    "details": { "weaponType": "hammer", "knockback": 1.5, "durability": 250,
                 "textureStyle": "metal", "textureColor": "#b87333" } }

  { "type": "weapon", "id": "obsidian_katana", "name": "Obsidian Katana", "description": "Long thin blade.",
    "details": { "weaponType": "katana", "attackDamage": 7, "durability": 800,
                 "textureStyle": "metal", "textureColor": "#1a1a26", "secondaryColor": "#5b3a1f" } }

  { "type": "command", "id": "give_sapphire_command", "name": "/givesapphire", "description": "Gives the player a sapphire.",
    "details": { "commandName": "givesapphire", "permissionLevel": 2, "action": { "type": "give-item", "itemId": "<modid>:sapphire", "count": 1 } } }

You will produce ONLY a JSON object inside <json>...</json> tags. No prose outside the tags.`;

const SCHEMA_HINT = `Top-level JSON shape:
{
  "modId": string,                     // snake_case
  "modName": string,
  "modVersion": "1.0.0",
  "mcVersion": "${"${MC}"}",
  "modLoader": "fabric",
  "packageName": string,               // dotted lowercase, e.g. com.modforge.flaming_sword
  "mainClass": string,                 // PascalCase
  "description": string,
  "features": [ ...typed features... ],
  "filesToCreate": string[],
  "limitations": string[],
  "assumptions": string[]
}`;

export async function createModSpec(userPrompt: string): Promise<ModSpec> {
  const schema = SCHEMA_HINT.replace("${MC}", config.fabric.mcVersion);
  const user = `User mod idea:\n"""\n${userPrompt}\n"""\n\nTarget Minecraft version: ${config.fabric.mcVersion}\nMod loader: fabric\n\n${schema}\n\nReturn the JSON spec now inside <json>...</json>.`;
  const text = await ask({ system: SYSTEM, user, maxTokens: 2500 });
  const raw = extractJson(text);
  const normalized = normalizeRawSpec(raw, userPrompt);
  const spec = parseOrThrow(ModSpecSchema, normalized, "Mod spec");
  return enforceConstants(spec);
}

/**
 * Narrow, allowlisted normalization of planner output BEFORE schema validation.
 * The schema layer remains strict; this helper only fixes specific known
 * planner mistakes that have a single safe interpretation. Anything outside
 * the explicit cases here passes through unchanged so validation can catch it.
 *
 * Currently handled:
 *   1. retexture_block targeting minecraft:grass_block: silently strip the
 *      "bottom" face (which is dirt, not grass) from `details.faces`. If
 *      stripping leaves an empty list, fall back to ["all"].
 *   2. RETEXTURE INTENT (3.7-patch B): if the user prompt clearly asks to
 *      recolor an existing vanilla item ("make wooden sword red") but the
 *      planner produced a custom item/weapon/tool/block whose id matches an
 *      allowlisted vanilla target (after stripping a leading color word),
 *      rewrite the feature to retexture_item / retexture_block. Recipes and
 *      commands referencing the rewritten id are dropped so cross-validation
 *      still passes.
 */
export function normalizeRawSpec(raw: unknown, userPrompt?: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  let cloned: unknown;
  try {
    cloned = JSON.parse(JSON.stringify(raw));
  } catch {
    return raw;
  }
  const root = cloned as { features?: unknown[] };
  if (!Array.isArray(root.features)) return cloned;

  // 1. grass_block bottom-face stripping (existing behavior).
  for (const f of root.features) {
    if (!f || typeof f !== "object") continue;
    const feature = f as { type?: unknown; details?: unknown };
    if (feature.type !== "retexture_block") continue;
    const d = feature.details;
    if (!d || typeof d !== "object") continue;
    const details = d as { vanillaTarget?: unknown; faces?: unknown };
    if (details.vanillaTarget !== "minecraft:grass_block") continue;
    if (!Array.isArray(details.faces)) continue;
    const stripped = details.faces.filter((x) => x !== "bottom");
    if (stripped.length !== details.faces.length) {
      details.faces = stripped.length === 0 ? ["all"] : stripped;
    }
  }

  // 2. Retexture intent rewrite.
  if (userPrompt && classifyIntent(userPrompt) === "retexture") {
    rewriteRetextureFeatures(root.features, userPrompt);
  }

  return cloned;
}

// ---------- intent classifier ----------

export type Intent = "retexture" | "create" | "ambiguous";

/**
 * Best-effort prompt classifier. We're conservative: only confident "retexture"
 * intent triggers the rewrite. "create" or "ambiguous" leaves the planner
 * output alone.
 *
 * Clarified prompts (those produced by the 3.8 clarify flow) include explicit
 * "Edit vanilla …" or "Create new custom …" phrases in the appended
 * "Clarifications:" block. These EXPLICIT intent markers OVERRIDE the verb
 * heuristic so a clarified "make a red wooden sword" with answer "Create new
 * custom red wooden sword" routes to "create" (and the rewriter leaves the
 * planner's custom weapon alone).
 */
export function classifyIntent(prompt: string): Intent {
  const p = prompt.trim().toLowerCase();
  if (p.length === 0) return "ambiguous";

  // Explicit clarified-prompt markers win over verb heuristics.
  if (/\bcreate\s+new\s+custom\b/.test(p)) return "create";
  if (/\bedit\s+(?:existing\s+)?vanilla\b/.test(p)) return "retexture";

  // Order matters: "make me" must beat "make".
  if (/^(?:add|create|build)\s+/.test(p)) return "create";
  if (/^make\s+me\s+/.test(p)) return "create";
  if (/^give\s+me\s+/.test(p)) return "create";
  if (/^(?:make|change|turn|recolor|retexture|color)\s+/.test(p)) return "retexture";
  if (/\bretexture\b/.test(p) || /\brecolor\b/.test(p)) return "retexture";
  return "ambiguous";
}

// ---------- vanilla-target extractor ----------

const COLOR_PREFIXES: ReadonlyArray<string> = [
  "red_", "blue_", "green_", "yellow_", "orange_", "purple_", "pink_",
  "black_", "white_", "gray_", "grey_", "dark_", "light_", "deep_",
  "bright_", "pale_", "neon_", "crimson_", "magenta_", "cyan_", "indigo_",
  "violet_", "rose_", "lime_", "teal_", "amber_", "ruby_", "sapphire_",
  "emerald_", "obsidian_", "void_", "shadow_", "blood_", "fire_", "ice_",
  "frost_", "silver_", "bronze_", "rusty_", "ancient_", "cursed_", "holy_",
];

const COLOR_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bdark\s+red\b/, "#660011"],
  [/\bdark\s+blue\b/, "#0a1a55"],
  [/\bdark\s+green\b/, "#0a4022"],
  [/\bdark\s+purple\b/, "#3a004f"],
  [/\bdark\s+gray\b|\bdark\s+grey\b/, "#222428"],
  [/\blight\s+blue\b/, "#88bbff"],
  [/\blight\s+green\b/, "#88dd99"],
  [/\bcrimson\b/, "#a31030"],
  [/\bred\b/, "#cc1133"],
  [/\bblue\b/, "#1144cc"],
  [/\bgreen\b/, "#22aa44"],
  [/\byellow\b/, "#eecc22"],
  [/\borange\b/, "#ee7722"],
  [/\bpurple\b|\bviolet\b/, "#7733cc"],
  [/\bpink\b/, "#ee77bb"],
  [/\bblack\b/, "#101015"],
  [/\bwhite\b/, "#eeeeee"],
  [/\bbrown\b/, "#774422"],
  [/\bgray\b|\bgrey\b/, "#777777"],
  [/\bgold(?:en)?\b/, "#ddaa22"],
  [/\bsilver\b/, "#bbbbbb"],
  [/\bcyan\b/, "#22cccc"],
  [/\bmagenta\b/, "#cc22cc"],
];

function extractColorFromPrompt(prompt: string): string {
  const p = prompt.toLowerCase();
  for (const [re, hex] of COLOR_HINTS) {
    if (re.test(p)) return hex;
  }
  return "#888888";
}

function tryFindVanillaTarget(
  rawId: string,
  allowlist: ReadonlySet<string>,
): string | null {
  const id = String(rawId ?? "").toLowerCase();
  if (!id) return null;
  // Direct match: feature id IS a vanilla suffix.
  if (allowlist.has(`minecraft:${id}`)) return `minecraft:${id}`;
  // Strip a single leading color/style prefix. ("red_wooden_sword" → "wooden_sword".)
  for (const prefix of COLOR_PREFIXES) {
    if (id.startsWith(prefix)) {
      const stripped = id.slice(prefix.length);
      if (allowlist.has(`minecraft:${stripped}`)) return `minecraft:${stripped}`;
    }
  }
  return null;
}

function defaultStyleForTarget(target: string): string {
  // Keep the heuristic narrow; the schema accepts any TextureStyle value.
  if (/_ore$/.test(target)) return "stone";
  if (/_(?:planks|log)$/.test(target)) return "plain";
  if (/_(?:sword|pickaxe|axe|shovel|hoe|ingot)$/.test(target)) return "metal";
  if (target === "minecraft:diamond" || target === "minecraft:emerald") return "gem";
  if (target.includes("crystal") || target === "minecraft:nether_star") return "crystal";
  if (target === "minecraft:grass_block") return "grass";
  return "plain";
}

// ---------- rewriter ----------

function rewriteRetextureFeatures(features: unknown[], prompt: string): void {
  const itemAllow = new Set(vanillaItemKeys());
  const blockAllow = new Set(vanillaBlockKeys());
  const removedIds = new Set<string>();
  const promptColor = extractColorFromPrompt(prompt);

  for (let i = 0; i < features.length; i++) {
    const f = features[i] as
      | { type?: string; id?: string; name?: string; description?: string; details?: any }
      | undefined;
    if (!f || typeof f !== "object") continue;

    let target: string | null = null;
    let isBlock = false;
    if (f.type === "block") {
      target = tryFindVanillaTarget(f.id ?? "", blockAllow);
      isBlock = true;
    } else if (f.type === "item" || f.type === "weapon" || f.type === "tool") {
      target = tryFindVanillaTarget(f.id ?? "", itemAllow);
    }
    if (!target) continue;

    const det = (f.details ?? {}) as Record<string, unknown>;
    const textureColor =
      typeof det.textureColor === "string" ? det.textureColor : promptColor;
    const newDetails: Record<string, unknown> = {
      vanillaTarget: target,
      textureStyle:
        typeof det.textureStyle === "string"
          ? det.textureStyle
          : defaultStyleForTarget(target),
      textureColor,
    };
    if (typeof det.secondaryColor === "string") newDetails.secondaryColor = det.secondaryColor;
    if (det.glowing === true) newDetails.glowing = true;

    features[i] = {
      type: isBlock ? "retexture_block" : "retexture_item",
      id: f.id,
      name: f.name,
      description: f.description ?? "",
      details: newDetails,
    };
    if (typeof f.id === "string") removedIds.add(f.id);
  }

  // Drop recipes/commands referencing the rewritten ids.
  if (removedIds.size === 0) return;
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i] as { type?: string; details?: any } | undefined;
    if (!f) continue;
    if (f.type === "recipe") {
      if (recipeReferencesAny(f.details, removedIds)) features.splice(i, 1);
    } else if (f.type === "command") {
      const ref = f.details?.action?.itemId;
      if (typeof ref === "string" && refMatchesRemoved(ref, removedIds)) {
        features.splice(i, 1);
      }
    }
  }
}

function refMatchesRemoved(ref: string, removed: ReadonlySet<string>): boolean {
  // refs may be "<id>" or "<modid>:<id>". Compare on the id portion only.
  const idPart = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
  return removed.has(idPart);
}

function recipeReferencesAny(details: any, removed: ReadonlySet<string>): boolean {
  if (!details || typeof details !== "object") return false;
  const result = details.result?.itemId;
  if (typeof result === "string" && refMatchesRemoved(result, removed)) return true;
  if (Array.isArray(details.ingredients)) {
    for (const ing of details.ingredients) {
      if (typeof ing === "string" && refMatchesRemoved(ing, removed)) return true;
    }
  }
  if (details.key && typeof details.key === "object") {
    for (const v of Object.values(details.key)) {
      if (typeof v === "string" && refMatchesRemoved(v, removed)) return true;
    }
  }
  return false;
}

function enforceConstants(s: ModSpec): ModSpec {
  return {
    ...s,
    modLoader: "fabric",
    mcVersion: config.fabric.mcVersion,
  };
}
