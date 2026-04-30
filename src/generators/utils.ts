/**
 * "sapphire_block" -> "Sapphire Block"
 */
export function humanize(id: string): string {
  return id
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * "sapphire_block" -> "SAPPHIRE_BLOCK".
 */
export function constName(id: string): string {
  return id.toUpperCase();
}

/**
 * "copper_hammer" -> "CopperHammer".
 */
export function pascalCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter((p) => p.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/**
 * Parse "modid:path" / "minecraft:path" / "path".
 * Bare path resolves to the supplied default namespace.
 */
export function parseItemRef(
  ref: string,
  defaultNamespace: string,
): { namespace: string; path: string; full: string } {
  const colon = ref.indexOf(":");
  if (colon > 0) {
    const namespace = ref.slice(0, colon);
    const path = ref.slice(colon + 1);
    return { namespace, path, full: `${namespace}:${path}` };
  }
  return {
    namespace: defaultNamespace,
    path: ref,
    full: `${defaultNamespace}:${ref}`,
  };
}

/**
 * Recipe key entries can be either an item ref ("modid:foo") or a tag ref ("#modid:tag").
 * Returns the JSON object to put under recipe.key[<char>].
 */
export function ingredientObject(
  ref: string,
  defaultNamespace: string,
): { item: string } | { tag: string } {
  if (ref.startsWith("#")) {
    const tag = parseItemRef(ref.slice(1), defaultNamespace);
    return { tag: tag.full };
  }
  const item = parseItemRef(ref, defaultNamespace);
  return { item: item.full };
}

/**
 * Java-escape a string literal: backslashes, quotes, and newlines.
 */
export function javaString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/**
 * Map our soundGroup enum to the Yarn BlockSoundGroup field.
 */
export function blockSoundGroupField(group: string): string {
  switch (group) {
    case "metal":
      return "BlockSoundGroup.METAL";
    case "wood":
      return "BlockSoundGroup.WOOD";
    case "glass":
      return "BlockSoundGroup.GLASS";
    case "gravel":
      return "BlockSoundGroup.GRAVEL";
    case "sand":
      return "BlockSoundGroup.SAND";
    case "grass":
      return "BlockSoundGroup.GRASS";
    case "wool":
      return "BlockSoundGroup.WOOL";
    case "stone":
    default:
      return "BlockSoundGroup.STONE";
  }
}

const TOOL_TAG: Record<string, string> = {
  pickaxe: "data/minecraft/tags/blocks/mineable/pickaxe.json",
  axe: "data/minecraft/tags/blocks/mineable/axe.json",
  shovel: "data/minecraft/tags/blocks/mineable/shovel.json",
  hoe: "data/minecraft/tags/blocks/mineable/hoe.json",
};

const LEVEL_TAG: Record<string, string | null> = {
  wood: null, // no needs_* tag — wood is the default
  stone: "data/minecraft/tags/blocks/needs_stone_tool.json",
  iron: "data/minecraft/tags/blocks/needs_iron_tool.json",
  diamond: "data/minecraft/tags/blocks/needs_diamond_tool.json",
  netherite: "data/minecraft/tags/blocks/needs_diamond_tool.json", // no netherite tag in 1.20.1
};

export function mineableTagPath(tool: string): string {
  return TOOL_TAG[tool] ?? TOOL_TAG.pickaxe!;
}

export function levelTagPath(level: string): string | null {
  return LEVEL_TAG[level] ?? null;
}
