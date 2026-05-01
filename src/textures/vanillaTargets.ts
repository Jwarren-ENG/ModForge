/**
 * Allowlist of vanilla Minecraft textures that retexture features may
 * overwrite. Anything outside this set is rejected at the schema layer.
 *
 * Milestone 3.7 expanded coverage to most everyday vanilla items + blocks
 * (weapons, tools, armor, common items, food, natural blocks, ores +
 * deepslate variants, storage blocks, logs, planks). The allowlist model
 * is unchanged: every entry maps a `minecraft:<id>` key to a hardcoded
 * texture path string. User input never participates in path construction.
 */

export type Face = "top" | "side" | "bottom" | "all" | "item";

export interface VanillaItemTarget {
  texturePath: string;
}

export interface VanillaBlockTarget {
  /** Faces that the user may request. */
  allowedFaces: Face[];
  /** Faces written when the user does not specify any. */
  defaultFaces: Face[];
  /** Map of face -> resource path under src/main/resources/. */
  texturePaths: Partial<Record<Face, string>>;
}

const ITEM = (name: string): VanillaItemTarget => ({
  texturePath: `assets/minecraft/textures/item/${name}.png`,
});

const SIMPLE_BLOCK = (name: string): VanillaBlockTarget => ({
  allowedFaces: ["all"],
  defaultFaces: ["all"],
  texturePaths: { all: `assets/minecraft/textures/block/${name}.png` },
});

/** Two-face block (e.g. logs): top + side. */
const LOG_BLOCK = (name: string): VanillaBlockTarget => ({
  allowedFaces: ["top", "side", "all"],
  defaultFaces: ["top", "side"],
  texturePaths: {
    top: `assets/minecraft/textures/block/${name}_top.png`,
    side: `assets/minecraft/textures/block/${name}.png`,
  },
});

// =====================================================================
// Items
// =====================================================================

export const VANILLA_ITEM_TARGETS: Readonly<Record<string, VanillaItemTarget>> = {
  // ---- gems / minerals / common (3.6 baseline) ----
  "minecraft:diamond": ITEM("diamond"),
  "minecraft:emerald": ITEM("emerald"),
  "minecraft:redstone": ITEM("redstone"),
  "minecraft:coal": ITEM("coal"),
  "minecraft:charcoal": ITEM("charcoal"),
  "minecraft:iron_ingot": ITEM("iron_ingot"),
  "minecraft:gold_ingot": ITEM("gold_ingot"),
  "minecraft:netherite_ingot": ITEM("netherite_ingot"),
  "minecraft:copper_ingot": ITEM("copper_ingot"),
  "minecraft:lapis_lazuli": ITEM("lapis_lazuli"),
  "minecraft:stick": ITEM("stick"),
  "minecraft:string": ITEM("string"),
  "minecraft:gunpowder": ITEM("gunpowder"),
  "minecraft:slime_ball": ITEM("slime_ball"),
  "minecraft:ender_pearl": ITEM("ender_pearl"),
  "minecraft:blaze_rod": ITEM("blaze_rod"),
  "minecraft:nether_star": ITEM("nether_star"),
  "minecraft:bone": ITEM("bone"),
  "minecraft:feather": ITEM("feather"),
  "minecraft:leather": ITEM("leather"),
  "minecraft:paper": ITEM("paper"),
  "minecraft:flint": ITEM("flint"),
  "minecraft:clay_ball": ITEM("clay_ball"),

  // ---- weapons / tools (3.7 broad coverage) ----
  // swords
  "minecraft:wooden_sword": ITEM("wooden_sword"),
  "minecraft:stone_sword": ITEM("stone_sword"),
  "minecraft:iron_sword": ITEM("iron_sword"),
  "minecraft:golden_sword": ITEM("golden_sword"),
  "minecraft:diamond_sword": ITEM("diamond_sword"),
  "minecraft:netherite_sword": ITEM("netherite_sword"),
  // pickaxes
  "minecraft:wooden_pickaxe": ITEM("wooden_pickaxe"),
  "minecraft:stone_pickaxe": ITEM("stone_pickaxe"),
  "minecraft:iron_pickaxe": ITEM("iron_pickaxe"),
  "minecraft:golden_pickaxe": ITEM("golden_pickaxe"),
  "minecraft:diamond_pickaxe": ITEM("diamond_pickaxe"),
  "minecraft:netherite_pickaxe": ITEM("netherite_pickaxe"),
  // axes
  "minecraft:wooden_axe": ITEM("wooden_axe"),
  "minecraft:stone_axe": ITEM("stone_axe"),
  "minecraft:iron_axe": ITEM("iron_axe"),
  "minecraft:golden_axe": ITEM("golden_axe"),
  "minecraft:diamond_axe": ITEM("diamond_axe"),
  "minecraft:netherite_axe": ITEM("netherite_axe"),
  // shovels
  "minecraft:wooden_shovel": ITEM("wooden_shovel"),
  "minecraft:stone_shovel": ITEM("stone_shovel"),
  "minecraft:iron_shovel": ITEM("iron_shovel"),
  "minecraft:golden_shovel": ITEM("golden_shovel"),
  "minecraft:diamond_shovel": ITEM("diamond_shovel"),
  "minecraft:netherite_shovel": ITEM("netherite_shovel"),
  // hoes
  "minecraft:wooden_hoe": ITEM("wooden_hoe"),
  "minecraft:stone_hoe": ITEM("stone_hoe"),
  "minecraft:iron_hoe": ITEM("iron_hoe"),
  "minecraft:golden_hoe": ITEM("golden_hoe"),
  "minecraft:diamond_hoe": ITEM("diamond_hoe"),
  "minecraft:netherite_hoe": ITEM("netherite_hoe"),

  // ---- armor (item icons) ----
  "minecraft:leather_helmet": ITEM("leather_helmet"),
  "minecraft:leather_chestplate": ITEM("leather_chestplate"),
  "minecraft:leather_leggings": ITEM("leather_leggings"),
  "minecraft:leather_boots": ITEM("leather_boots"),
  "minecraft:iron_helmet": ITEM("iron_helmet"),
  "minecraft:iron_chestplate": ITEM("iron_chestplate"),
  "minecraft:iron_leggings": ITEM("iron_leggings"),
  "minecraft:iron_boots": ITEM("iron_boots"),
  "minecraft:golden_helmet": ITEM("golden_helmet"),
  "minecraft:golden_chestplate": ITEM("golden_chestplate"),
  "minecraft:golden_leggings": ITEM("golden_leggings"),
  "minecraft:golden_boots": ITEM("golden_boots"),
  "minecraft:diamond_helmet": ITEM("diamond_helmet"),
  "minecraft:diamond_chestplate": ITEM("diamond_chestplate"),
  "minecraft:diamond_leggings": ITEM("diamond_leggings"),
  "minecraft:diamond_boots": ITEM("diamond_boots"),
  "minecraft:netherite_helmet": ITEM("netherite_helmet"),
  "minecraft:netherite_chestplate": ITEM("netherite_chestplate"),
  "minecraft:netherite_leggings": ITEM("netherite_leggings"),
  "minecraft:netherite_boots": ITEM("netherite_boots"),

  // ---- common ranged / utility ----
  // PARTIAL-STATE LIMITATION (Milestone 3.7 / 3.7-patch):
  // bow / crossbow / fishing_rod each have multiple visual states (drawn frames,
  // standby, etc.). Our retexture only writes the ONE base texture below — other
  // animation frames keep the vanilla art, which can look inconsistent in-game.
  // Document this in the README rather than auto-replacing all frames.
  "minecraft:bow": ITEM("bow"),                             // inventory icon + base
  "minecraft:crossbow": ITEM("crossbow_standby"),           // unloaded standby state only
  "minecraft:fishing_rod": ITEM("fishing_rod"),             // unreeled state only
  "minecraft:trident": ITEM("trident"),
  // INTENTIONALLY EXCLUDED in 3.7-patch:
  //   - minecraft:shield   (entity-backed; no flat textures/item/shield.png)
  //   - minecraft:compass  (animated frames compass_00..compass_31)
  //   - minecraft:clock    (animated frames clock_00..clock_63)
  // These would silently accept a retexture that has no in-game effect.
  // Re-add only when we model the per-frame / entity-texture path.
  "minecraft:bucket": ITEM("bucket"),
  "minecraft:water_bucket": ITEM("water_bucket"),
  "minecraft:lava_bucket": ITEM("lava_bucket"),
  "minecraft:flint_and_steel": ITEM("flint_and_steel"),
  "minecraft:shears": ITEM("shears"),
  "minecraft:book": ITEM("book"),
  "minecraft:writable_book": ITEM("writable_book"),
  "minecraft:enchanted_book": ITEM("enchanted_book"),
  "minecraft:map": ITEM("map"),
  "minecraft:name_tag": ITEM("name_tag"),
  "minecraft:saddle": ITEM("saddle"),

  // ---- food / nature ----
  "minecraft:apple": ITEM("apple"),
  "minecraft:golden_apple": ITEM("golden_apple"),
  "minecraft:bread": ITEM("bread"),
  "minecraft:carrot": ITEM("carrot"),
  "minecraft:potato": ITEM("potato"),
  "minecraft:baked_potato": ITEM("baked_potato"),
  "minecraft:beetroot": ITEM("beetroot"),
  "minecraft:wheat": ITEM("wheat"),
  "minecraft:sugar": ITEM("sugar"),
  "minecraft:egg": ITEM("egg"),
  "minecraft:milk_bucket": ITEM("milk_bucket"),
  "minecraft:beef": ITEM("beef"),
  "minecraft:cooked_beef": ITEM("cooked_beef"),
  "minecraft:porkchop": ITEM("porkchop"),
  "minecraft:cooked_porkchop": ITEM("cooked_porkchop"),
  "minecraft:chicken": ITEM("chicken"),
  "minecraft:cooked_chicken": ITEM("cooked_chicken"),
  "minecraft:mutton": ITEM("mutton"),
  "minecraft:cooked_mutton": ITEM("cooked_mutton"),
  "minecraft:cod": ITEM("cod"),
  "minecraft:salmon": ITEM("salmon"),
};

// =====================================================================
// Blocks
// =====================================================================

export const VANILLA_BLOCK_TARGETS: Readonly<Record<string, VanillaBlockTarget>> = {
  // ---- multi-face natural ----
  "minecraft:grass_block": {
    allowedFaces: ["top", "side", "all"],
    defaultFaces: ["top", "side"],
    texturePaths: {
      top: "assets/minecraft/textures/block/grass_block_top.png",
      side: "assets/minecraft/textures/block/grass_block_side.png",
    },
  },

  // ---- natural blocks (single face) ----
  "minecraft:stone": SIMPLE_BLOCK("stone"),
  "minecraft:cobblestone": SIMPLE_BLOCK("cobblestone"),
  "minecraft:dirt": SIMPLE_BLOCK("dirt"),
  "minecraft:sand": SIMPLE_BLOCK("sand"),
  "minecraft:red_sand": SIMPLE_BLOCK("red_sand"),
  "minecraft:gravel": SIMPLE_BLOCK("gravel"),
  "minecraft:clay": SIMPLE_BLOCK("clay"),
  "minecraft:snow": SIMPLE_BLOCK("snow"),
  "minecraft:ice": SIMPLE_BLOCK("ice"),
  "minecraft:packed_ice": SIMPLE_BLOCK("packed_ice"),
  "minecraft:obsidian": SIMPLE_BLOCK("obsidian"),
  "minecraft:netherrack": SIMPLE_BLOCK("netherrack"),
  "minecraft:end_stone": SIMPLE_BLOCK("end_stone"),
  "minecraft:bedrock": SIMPLE_BLOCK("bedrock"),

  // ---- ores ----
  "minecraft:coal_ore": SIMPLE_BLOCK("coal_ore"),
  "minecraft:iron_ore": SIMPLE_BLOCK("iron_ore"),
  "minecraft:copper_ore": SIMPLE_BLOCK("copper_ore"),
  "minecraft:gold_ore": SIMPLE_BLOCK("gold_ore"),
  "minecraft:redstone_ore": SIMPLE_BLOCK("redstone_ore"),
  "minecraft:lapis_ore": SIMPLE_BLOCK("lapis_ore"),
  "minecraft:diamond_ore": SIMPLE_BLOCK("diamond_ore"),
  "minecraft:emerald_ore": SIMPLE_BLOCK("emerald_ore"),

  // deepslate ores
  "minecraft:deepslate_coal_ore": SIMPLE_BLOCK("deepslate_coal_ore"),
  "minecraft:deepslate_iron_ore": SIMPLE_BLOCK("deepslate_iron_ore"),
  "minecraft:deepslate_copper_ore": SIMPLE_BLOCK("deepslate_copper_ore"),
  "minecraft:deepslate_gold_ore": SIMPLE_BLOCK("deepslate_gold_ore"),
  "minecraft:deepslate_redstone_ore": SIMPLE_BLOCK("deepslate_redstone_ore"),
  "minecraft:deepslate_lapis_ore": SIMPLE_BLOCK("deepslate_lapis_ore"),
  "minecraft:deepslate_diamond_ore": SIMPLE_BLOCK("deepslate_diamond_ore"),
  "minecraft:deepslate_emerald_ore": SIMPLE_BLOCK("deepslate_emerald_ore"),

  // ---- storage blocks ----
  "minecraft:iron_block": SIMPLE_BLOCK("iron_block"),
  "minecraft:gold_block": SIMPLE_BLOCK("gold_block"),
  "minecraft:copper_block": SIMPLE_BLOCK("copper_block"),
  "minecraft:diamond_block": SIMPLE_BLOCK("diamond_block"),
  "minecraft:emerald_block": SIMPLE_BLOCK("emerald_block"),
  "minecraft:redstone_block": SIMPLE_BLOCK("redstone_block"),
  "minecraft:lapis_block": SIMPLE_BLOCK("lapis_block"),
  "minecraft:coal_block": SIMPLE_BLOCK("coal_block"),
  "minecraft:netherite_block": SIMPLE_BLOCK("netherite_block"),

  // ---- logs (top + side) ----
  "minecraft:oak_log": LOG_BLOCK("oak_log"),
  "minecraft:spruce_log": LOG_BLOCK("spruce_log"),
  "minecraft:birch_log": LOG_BLOCK("birch_log"),
  "minecraft:jungle_log": LOG_BLOCK("jungle_log"),
  "minecraft:acacia_log": LOG_BLOCK("acacia_log"),
  "minecraft:dark_oak_log": LOG_BLOCK("dark_oak_log"),
  "minecraft:mangrove_log": LOG_BLOCK("mangrove_log"),
  "minecraft:cherry_log": LOG_BLOCK("cherry_log"),

  // ---- planks ----
  "minecraft:oak_planks": SIMPLE_BLOCK("oak_planks"),
  "minecraft:spruce_planks": SIMPLE_BLOCK("spruce_planks"),
  "minecraft:birch_planks": SIMPLE_BLOCK("birch_planks"),
  "minecraft:jungle_planks": SIMPLE_BLOCK("jungle_planks"),
  "minecraft:acacia_planks": SIMPLE_BLOCK("acacia_planks"),
  "minecraft:dark_oak_planks": SIMPLE_BLOCK("dark_oak_planks"),
  "minecraft:mangrove_planks": SIMPLE_BLOCK("mangrove_planks"),
  "minecraft:cherry_planks": SIMPLE_BLOCK("cherry_planks"),
};

export function isVanillaItemTarget(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(VANILLA_ITEM_TARGETS, id);
}
export function isVanillaBlockTarget(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(VANILLA_BLOCK_TARGETS, id);
}
export function vanillaItemKeys(): string[] {
  return Object.keys(VANILLA_ITEM_TARGETS);
}
export function vanillaBlockKeys(): string[] {
  return Object.keys(VANILLA_BLOCK_TARGETS);
}
