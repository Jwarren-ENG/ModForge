/**
 * 16x16 boolean masks used to give item textures a recognizable Minecraft-like
 * pixel-art shape with a transparent background. Block faces still tile, so
 * they don't use these.
 */

export type Silhouette =
  | "diamond"
  | "crystal-shard"
  | "ingot"
  | "generic-item"
  | "sword"
  | "pickaxe"
  | "axe"
  | "shovel"
  | "hoe";

export const SILHOUETTE_SIZE = 16;

/** Inclusive [start, end] column ranges per row. */
type RowSpec = ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

function rows(spec: RowSpec): boolean[][] {
  const mask: boolean[][] = [];
  for (let y = 0; y < SILHOUETTE_SIZE; y++) {
    const row = new Array<boolean>(SILHOUETTE_SIZE).fill(false);
    for (const [s, e] of spec[y] ?? []) {
      for (let x = s; x <= e; x++) row[x] = true;
    }
    mask.push(row);
  }
  return mask;
}

/**
 * Vertical diamond / gem silhouette. Tip at row 1, base at row 14, max width
 * at rows 7-8. Mimics the vanilla diamond/emerald shape closely enough that a
 * recolored version reads as a gem at inventory size.
 */
function diamondMask(): boolean[][] {
  return rows([
    [],
    [[7, 8]],
    [[6, 9]],
    [[5, 10]],
    [[4, 11]],
    [[3, 12]],
    [[2, 13]],
    [[1, 14]],
    [[1, 14]],
    [[2, 13]],
    [[3, 12]],
    [[4, 11]],
    [[5, 10]],
    [[6, 9]],
    [[7, 8]],
    [],
  ]);
}

/**
 * Tall vertical crystal shard with a sharp top tip and a flat-ish base.
 */
function crystalShardMask(): boolean[][] {
  return rows([
    [],
    [[7, 8]],
    [[7, 8]],
    [[6, 9]],
    [[6, 9]],
    [[5, 10]],
    [[5, 10]],
    [[4, 11]],
    [[4, 11]],
    [[5, 10]],
    [[5, 10]],
    [[6, 9]],
    [[7, 8]],
    [[7, 8]],
    [],
    [],
  ]);
}

/** Horizontal rounded ingot. */
function ingotMask(): boolean[][] {
  return rows([
    [], [], [], [], [],
    [[3, 12]],
    [[2, 13]],
    [[1, 14]],
    [[1, 14]],
    [[2, 13]],
    [[3, 12]],
    [], [], [], [], [],
  ]);
}

/** Rounded square fallback for items that don't fit the other categories. */
function genericItemMask(): boolean[][] {
  return rows([
    [],
    [[3, 12]],
    [[2, 13]],
    [[1, 14]],
    [[1, 14]],
    [[1, 14]],
    [[1, 14]],
    [[1, 14]],
    [[1, 14]],
    [[1, 14]],
    [[1, 14]],
    [[1, 14]],
    [[1, 14]],
    [[2, 13]],
    [[3, 12]],
    [],
  ]);
}

/**
 * Diagonal sword silhouette. Pommel near (1, 14), blade tip at (14, 1). The
 * pixel-art width is 1 px along the blade with a guard cross around row 12-13.
 */
function swordMask(): boolean[][] {
  return rows([
    /* y=0 */ [],
    /* y=1 */ [[13, 14]],
    /* y=2 */ [[12, 14]],
    /* y=3 */ [[11, 13]],
    /* y=4 */ [[10, 12]],
    /* y=5 */ [[9, 11]],
    /* y=6 */ [[8, 10]],
    /* y=7 */ [[7, 9]],
    /* y=8 */ [[6, 8]],
    /* y=9 */ [[5, 7]],
    /* y=10 */ [[4, 6]],
    /* y=11 */ [[3, 5]],
    /* y=12 */ [[2, 7]], // guard
    /* y=13 */ [[1, 4]], // hilt
    /* y=14 */ [[2, 3]],
    /* y=15 */ [],
  ]);
}

/**
 * Pickaxe silhouette: a wide head at the top with a diagonal handle.
 */
function pickaxeMask(): boolean[][] {
  return rows([
    /* y=0 */ [],
    /* y=1 */ [[2, 13]],
    /* y=2 */ [[3, 12]],
    /* y=3 */ [[6, 9]],
    /* y=4 */ [[6, 9]],
    /* y=5 */ [[7, 9]],
    /* y=6 */ [[6, 8]],
    /* y=7 */ [[5, 7]],
    /* y=8 */ [[4, 6]],
    /* y=9 */ [[3, 5]],
    /* y=10 */ [[3, 5]],
    /* y=11 */ [[2, 4]],
    /* y=12 */ [[2, 4]],
    /* y=13 */ [[1, 3]],
    /* y=14 */ [[1, 3]],
    /* y=15 */ [],
  ]);
}

/**
 * Axe silhouette: head on the upper-right, diagonal handle to lower-left.
 */
function axeMask(): boolean[][] {
  return rows([
    /* y=0 */ [],
    /* y=1 */ [[7, 12]],
    /* y=2 */ [[6, 13]],
    /* y=3 */ [[6, 12]],
    /* y=4 */ [[7, 11]],
    /* y=5 */ [[7, 9]],
    /* y=6 */ [[6, 8]],
    /* y=7 */ [[5, 7]],
    /* y=8 */ [[4, 6]],
    /* y=9 */ [[4, 6]],
    /* y=10 */ [[3, 5]],
    /* y=11 */ [[3, 5]],
    /* y=12 */ [[2, 4]],
    /* y=13 */ [[2, 4]],
    /* y=14 */ [[1, 3]],
    /* y=15 */ [],
  ]);
}

/**
 * Shovel silhouette: small head at the top with a long thin handle.
 */
function shovelMask(): boolean[][] {
  return rows([
    /* y=0 */ [],
    /* y=1 */ [[10, 13]],
    /* y=2 */ [[9, 13]],
    /* y=3 */ [[9, 12]],
    /* y=4 */ [[8, 11]],
    /* y=5 */ [[8, 10]],
    /* y=6 */ [[7, 9]],
    /* y=7 */ [[6, 8]],
    /* y=8 */ [[5, 7]],
    /* y=9 */ [[4, 6]],
    /* y=10 */ [[3, 5]],
    /* y=11 */ [[3, 5]],
    /* y=12 */ [[2, 4]],
    /* y=13 */ [[2, 4]],
    /* y=14 */ [[1, 3]],
    /* y=15 */ [],
  ]);
}

/**
 * Hoe silhouette: small angular head with a long handle.
 */
function hoeMask(): boolean[][] {
  return rows([
    /* y=0 */ [],
    /* y=1 */ [[10, 14]],
    /* y=2 */ [[10, 12]],
    /* y=3 */ [[9, 11]],
    /* y=4 */ [[9, 10]],
    /* y=5 */ [[8, 9]],
    /* y=6 */ [[7, 8]],
    /* y=7 */ [[6, 7]],
    /* y=8 */ [[5, 6]],
    /* y=9 */ [[4, 5]],
    /* y=10 */ [[3, 4]],
    /* y=11 */ [[3, 4]],
    /* y=12 */ [[2, 3]],
    /* y=13 */ [[2, 3]],
    /* y=14 */ [[1, 2]],
    /* y=15 */ [],
  ]);
}

export function getMask(s: Silhouette): boolean[][] {
  switch (s) {
    case "diamond": return diamondMask();
    case "crystal-shard": return crystalShardMask();
    case "ingot": return ingotMask();
    case "sword": return swordMask();
    case "pickaxe": return pickaxeMask();
    case "axe": return axeMask();
    case "shovel": return shovelMask();
    case "hoe": return hoeMask();
    case "generic-item":
    default: return genericItemMask();
  }
}

/**
 * Map our six texture styles to the most natural item silhouette. The
 * retexture generator may override this when we can be more specific (e.g.
 * `minecraft:diamond` should always use the diamond shape regardless of
 * the chosen style).
 */
export function silhouetteForStyle(style: string): Silhouette {
  switch (style) {
    case "gem":
      return "diamond";
    case "crystal":
      return "crystal-shard";
    case "metal":
      return "ingot";
    case "stone":
    case "grass":
    case "plain":
    default:
      return "generic-item";
  }
}
