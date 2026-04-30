import { ask, extractJson } from "../anthropic.js";
import { config } from "../config.js";
import { ModSpecSchema, parseOrThrow } from "../schemas.js";
import type { ModSpec } from "../types.js";

const SYSTEM = `You are ModForge AI's planning agent. You convert a natural-language Minecraft mod idea into a strict JSON specification for a Fabric mod.

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
      weaponType?: "hammer"|"mace"|"club"|"sword"|"custom-melee",  // default "hammer"
      knockback?: 0..10,           // for hammer-type weapons
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
    Allowed vanilla item targets: minecraft:diamond, minecraft:emerald, minecraft:redstone, minecraft:coal, minecraft:charcoal, minecraft:iron_ingot, minecraft:gold_ingot, minecraft:netherite_ingot, minecraft:copper_ingot, minecraft:lapis_lazuli, minecraft:apple, minecraft:bone, minecraft:wheat, minecraft:stick, minecraft:string, minecraft:gunpowder, minecraft:slime_ball, minecraft:ender_pearl, minecraft:blaze_rod, minecraft:nether_star, minecraft:bread, minecraft:feather, minecraft:leather, minecraft:paper, minecraft:flint, minecraft:clay_ball.

  retexture_block:
    details: {
      vanillaTarget: "minecraft:<id>",           // MUST be in the allowlist below
      textureStyle: "plain"|"gem"|"crystal"|"metal"|"stone"|"grass",
      textureColor: "#rrggbb",
      secondaryColor?: "#rrggbb",
      glowing?: boolean,
      faces?: ("top"|"side"|"bottom"|"all")[]    // omit to use defaults
    }
    Allowed vanilla block targets: minecraft:grass_block (faces: top, side, all), minecraft:stone, minecraft:dirt, minecraft:cobblestone, minecraft:oak_planks, minecraft:spruce_planks, minecraft:birch_planks, minecraft:diamond_ore, minecraft:iron_ore, minecraft:gold_ore, minecraft:coal_ore, minecraft:emerald_ore, minecraft:redstone_ore, minecraft:lapis_ore, minecraft:copper_ore, minecraft:netherrack, minecraft:end_stone, minecraft:obsidian, minecraft:sand, minecraft:gravel, minecraft:bedrock.

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
    "details": { "weaponType": "hammer", "knockback": 1.5, "durability": 250 } }

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
  const normalized = normalizeRawSpec(raw);
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
 *   - retexture_block targeting minecraft:grass_block: silently strip the
 *     "bottom" face (which is dirt, not grass) from `details.faces`. If
 *     stripping leaves an empty list, fall back to ["all"].
 */
export function normalizeRawSpec(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  let cloned: unknown;
  try {
    cloned = JSON.parse(JSON.stringify(raw));
  } catch {
    return raw;
  }
  const root = cloned as { features?: unknown };
  if (!Array.isArray(root.features)) return cloned;
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
  return cloned;
}

function enforceConstants(s: ModSpec): ModSpec {
  return {
    ...s,
    modLoader: "fabric",
    mcVersion: config.fabric.mcVersion,
  };
}
