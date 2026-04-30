/**
 * Allowlist of vanilla Minecraft textures that retexture features may
 * overwrite. Anything outside this set is rejected at the schema layer.
 *
 * The schema also re-exports the keys for use in superRefine validation.
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

const ITEM = (name: string) => ({
  texturePath: `assets/minecraft/textures/item/${name}.png`,
});

const SIMPLE_BLOCK = (name: string): VanillaBlockTarget => ({
  allowedFaces: ["all"],
  defaultFaces: ["all"],
  texturePaths: { all: `assets/minecraft/textures/block/${name}.png` },
});

export const VANILLA_ITEM_TARGETS: Readonly<Record<string, VanillaItemTarget>> = {
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
  "minecraft:apple": ITEM("apple"),
  "minecraft:bone": ITEM("bone"),
  "minecraft:wheat": ITEM("wheat"),
  "minecraft:stick": ITEM("stick"),
  "minecraft:string": ITEM("string"),
  "minecraft:gunpowder": ITEM("gunpowder"),
  "minecraft:slime_ball": ITEM("slime_ball"),
  "minecraft:ender_pearl": ITEM("ender_pearl"),
  "minecraft:blaze_rod": ITEM("blaze_rod"),
  "minecraft:nether_star": ITEM("nether_star"),
  "minecraft:bread": ITEM("bread"),
  "minecraft:feather": ITEM("feather"),
  "minecraft:leather": ITEM("leather"),
  "minecraft:paper": ITEM("paper"),
  "minecraft:flint": ITEM("flint"),
  "minecraft:clay_ball": ITEM("clay_ball"),
};

export const VANILLA_BLOCK_TARGETS: Readonly<Record<string, VanillaBlockTarget>> = {
  "minecraft:grass_block": {
    allowedFaces: ["top", "side", "all"],
    defaultFaces: ["top", "side"],
    texturePaths: {
      top: "assets/minecraft/textures/block/grass_block_top.png",
      side: "assets/minecraft/textures/block/grass_block_side.png",
    },
  },
  "minecraft:stone": SIMPLE_BLOCK("stone"),
  "minecraft:dirt": SIMPLE_BLOCK("dirt"),
  "minecraft:cobblestone": SIMPLE_BLOCK("cobblestone"),
  "minecraft:oak_planks": SIMPLE_BLOCK("oak_planks"),
  "minecraft:spruce_planks": SIMPLE_BLOCK("spruce_planks"),
  "minecraft:birch_planks": SIMPLE_BLOCK("birch_planks"),
  "minecraft:diamond_ore": SIMPLE_BLOCK("diamond_ore"),
  "minecraft:iron_ore": SIMPLE_BLOCK("iron_ore"),
  "minecraft:gold_ore": SIMPLE_BLOCK("gold_ore"),
  "minecraft:coal_ore": SIMPLE_BLOCK("coal_ore"),
  "minecraft:emerald_ore": SIMPLE_BLOCK("emerald_ore"),
  "minecraft:redstone_ore": SIMPLE_BLOCK("redstone_ore"),
  "minecraft:lapis_ore": SIMPLE_BLOCK("lapis_ore"),
  "minecraft:copper_ore": SIMPLE_BLOCK("copper_ore"),
  "minecraft:netherrack": SIMPLE_BLOCK("netherrack"),
  "minecraft:end_stone": SIMPLE_BLOCK("end_stone"),
  "minecraft:obsidian": SIMPLE_BLOCK("obsidian"),
  "minecraft:sand": SIMPLE_BLOCK("sand"),
  "minecraft:gravel": SIMPLE_BLOCK("gravel"),
  "minecraft:bedrock": SIMPLE_BLOCK("bedrock"),
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
