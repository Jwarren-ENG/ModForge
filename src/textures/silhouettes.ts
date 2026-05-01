/**
 * 16x16 region maps used to give item textures a recognizable Minecraft-like
 * pixel-art shape with a transparent background. Block faces still tile, so
 * they don't use these.
 *
 * Each silhouette is a `number[][]` where:
 *   0  = background (transparent)
 *   1  = body / blade / head    (rendered in the primary palette)
 *   2  = grip / handle          (rendered in the secondary palette)
 *   3  = guard / accent ring    (rendered in a bright primary accent)
 *
 * Single-region shapes (diamond, crystal-shard, ingot, generic-item) only
 * use region 1 — the painter still produces the same look as before. The
 * region split lets weapons read as "blade + handle" instead of one capsule.
 */

export type Silhouette =
  | "diamond"
  | "crystal-shard"
  | "ingot"
  | "generic-item"
  | "sword"
  | "katana"
  | "dagger"
  | "pickaxe"
  | "axe"
  | "shovel"
  | "hoe"
  | "hammer";

export const SILHOUETTE_SIZE = 16;

export const REGION_BG = 0;
export const REGION_BODY = 1;
export const REGION_GRIP = 2;
export const REGION_GUARD = 3;

/** Inclusive [start, end, region?] column ranges per row (region defaults to 1). */
type Span = readonly [number, number] | readonly [number, number, number];
type RowSpec = ReadonlyArray<ReadonlyArray<Span>>;

function rows(spec: RowSpec): number[][] {
  const mask: number[][] = [];
  for (let y = 0; y < SILHOUETTE_SIZE; y++) {
    const row = new Array<number>(SILHOUETTE_SIZE).fill(REGION_BG);
    for (const span of spec[y] ?? []) {
      const [s, e, region] = span;
      const r = region ?? REGION_BODY;
      for (let x = s; x <= e; x++) row[x] = r;
    }
    mask.push(row);
  }
  return mask;
}

// ---- Single-region shapes (legacy, all REGION_BODY) ----

function diamondMask(): number[][] {
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

function crystalShardMask(): number[][] {
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

function ingotMask(): number[][] {
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

function genericItemMask(): number[][] {
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

// ---- Multi-region weapon/tool shapes ----

/**
 * Sword: 2-px-wide diagonal blade from upper-right tip to mid-canvas, a
 * cross-guard row that visibly extends past the blade, then a 2-px grip
 * with a small pommel. The guard region breaks the "capsule" look that a
 * single-region thick diagonal produces.
 */
function swordMask(): number[][] {
  return rows([
    [],
    [[13, 14, REGION_BODY]],
    [[12, 13, REGION_BODY]],
    [[11, 12, REGION_BODY]],
    [[10, 11, REGION_BODY]],
    [[9, 10, REGION_BODY]],
    [[8, 9, REGION_BODY]],
    [[7, 8, REGION_BODY]],
    [[6, 7, REGION_BODY]],
    [[5, 6, REGION_BODY]],
    [[4, 5, REGION_BODY]],
    [[3, 6, REGION_GUARD]],
    [[3, 4, REGION_GRIP]],
    [[2, 3, REGION_GRIP]],
    [[1, 2, REGION_GRIP]],
    [],
  ]);
}

/**
 * Katana: a longer, thinner (1-px) blade angled top-right → mid-canvas,
 * a small tsuba (guard), and a slim grip running diagonally toward the
 * lower-left corner.
 */
function katanaMask(): number[][] {
  return rows([
    [[14, 14, REGION_BODY]],
    [[13, 14, REGION_BODY]],
    [[12, 13, REGION_BODY]],
    [[11, 12, REGION_BODY]],
    [[10, 11, REGION_BODY]],
    [[9, 10, REGION_BODY]],
    [[8, 9, REGION_BODY]],
    [[7, 8, REGION_BODY]],
    [[6, 7, REGION_BODY]],
    [[5, 7, REGION_GUARD]],
    [[4, 5, REGION_GRIP]],
    [[3, 4, REGION_GRIP]],
    [[2, 3, REGION_GRIP]],
    [[1, 2, REGION_GRIP]],
    [[1, 1, REGION_GRIP]],
    [],
  ]);
}

/**
 * Dagger: short blade in the upper-right + small guard + 2-px grip.
 */
function daggerMask(): number[][] {
  return rows([
    [],
    [],
    [[13, 13, REGION_BODY]],
    [[12, 13, REGION_BODY]],
    [[11, 12, REGION_BODY]],
    [[10, 11, REGION_BODY]],
    [[9, 10, REGION_BODY]],
    [[8, 9, REGION_BODY]],
    [[6, 10, REGION_GUARD]],
    [[6, 7, REGION_GRIP]],
    [[5, 6, REGION_GRIP]],
    [[5, 5, REGION_GRIP]],
    [],
    [],
    [],
    [],
  ]);
}

/**
 * Hammer: a chunky head at the top with a slim, slightly-diagonal grip
 * running toward the lower-right corner. Region 1 is the head, region 2
 * is the grip — clearly separated by both shape and color.
 */
function hammerMask(): number[][] {
  return rows([
    [],
    [[3, 11, REGION_BODY]],
    [[2, 12, REGION_BODY]],
    [[2, 12, REGION_BODY]],
    [[3, 11, REGION_BODY]],
    [[5, 6, REGION_GRIP]],
    [[5, 6, REGION_GRIP]],
    [[6, 7, REGION_GRIP]],
    [[6, 7, REGION_GRIP]],
    [[7, 8, REGION_GRIP]],
    [[7, 8, REGION_GRIP]],
    [[8, 9, REGION_GRIP]],
    [[8, 9, REGION_GRIP]],
    [[9, 10, REGION_GRIP]],
    [[9, 10, REGION_GRIP]],
    [],
  ]);
}

/**
 * Pickaxe: wide head + spike at the top, diagonal grip to the lower-left.
 */
function pickaxeMask(): number[][] {
  return rows([
    [],
    [[2, 13, REGION_BODY]],
    [[3, 12, REGION_BODY]],
    [[6, 9, REGION_BODY]],
    [[6, 9, REGION_BODY]],
    [[7, 9, REGION_GRIP]],
    [[6, 8, REGION_GRIP]],
    [[5, 7, REGION_GRIP]],
    [[4, 6, REGION_GRIP]],
    [[3, 5, REGION_GRIP]],
    [[3, 5, REGION_GRIP]],
    [[2, 4, REGION_GRIP]],
    [[2, 4, REGION_GRIP]],
    [[1, 3, REGION_GRIP]],
    [[1, 3, REGION_GRIP]],
    [],
  ]);
}

/**
 * Axe: head on the upper-right, diagonal grip toward the lower-left.
 */
function axeMask(): number[][] {
  return rows([
    [],
    [[7, 12, REGION_BODY]],
    [[6, 13, REGION_BODY]],
    [[6, 12, REGION_BODY]],
    [[7, 11, REGION_BODY]],
    [[7, 9, REGION_GRIP]],
    [[6, 8, REGION_GRIP]],
    [[5, 7, REGION_GRIP]],
    [[4, 6, REGION_GRIP]],
    [[4, 6, REGION_GRIP]],
    [[3, 5, REGION_GRIP]],
    [[3, 5, REGION_GRIP]],
    [[2, 4, REGION_GRIP]],
    [[2, 4, REGION_GRIP]],
    [[1, 3, REGION_GRIP]],
    [],
  ]);
}

/**
 * Shovel: small head at the top with a long thin diagonal handle.
 */
function shovelMask(): number[][] {
  return rows([
    [],
    [[10, 13, REGION_BODY]],
    [[9, 13, REGION_BODY]],
    [[9, 12, REGION_BODY]],
    [[8, 11, REGION_BODY]],
    [[8, 10, REGION_GRIP]],
    [[7, 9, REGION_GRIP]],
    [[6, 8, REGION_GRIP]],
    [[5, 7, REGION_GRIP]],
    [[4, 6, REGION_GRIP]],
    [[3, 5, REGION_GRIP]],
    [[3, 5, REGION_GRIP]],
    [[2, 4, REGION_GRIP]],
    [[2, 4, REGION_GRIP]],
    [[1, 3, REGION_GRIP]],
    [],
  ]);
}

/**
 * Hoe: small angular head at the top with a long thin diagonal handle.
 */
function hoeMask(): number[][] {
  return rows([
    [],
    [[10, 14, REGION_BODY]],
    [[10, 12, REGION_BODY]],
    [[9, 11, REGION_BODY]],
    [[9, 10, REGION_GRIP]],
    [[8, 9, REGION_GRIP]],
    [[7, 8, REGION_GRIP]],
    [[6, 7, REGION_GRIP]],
    [[5, 6, REGION_GRIP]],
    [[4, 5, REGION_GRIP]],
    [[3, 4, REGION_GRIP]],
    [[3, 4, REGION_GRIP]],
    [[2, 3, REGION_GRIP]],
    [[2, 3, REGION_GRIP]],
    [[1, 2, REGION_GRIP]],
    [],
  ]);
}

export function getMask(s: Silhouette): number[][] {
  switch (s) {
    case "diamond": return diamondMask();
    case "crystal-shard": return crystalShardMask();
    case "ingot": return ingotMask();
    case "sword": return swordMask();
    case "katana": return katanaMask();
    case "dagger": return daggerMask();
    case "pickaxe": return pickaxeMask();
    case "axe": return axeMask();
    case "shovel": return shovelMask();
    case "hoe": return hoeMask();
    case "hammer": return hammerMask();
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

/**
 * Map a planner-supplied weaponType to a silhouette. Used by the tool/weapon
 * generator so a katana request gets a katana shape, a hammer gets a hammer
 * shape, etc. Unknown values fall back to "sword".
 */
export function silhouetteForWeaponType(t: string | undefined): Silhouette {
  switch (t) {
    case "katana": return "katana";
    case "dagger": return "dagger";
    case "sword": return "sword";
    case "axe": return "axe";
    case "pickaxe": return "pickaxe";
    case "shovel": return "shovel";
    case "hoe": return "hoe";
    case "hammer":
    case "mace":
    case "club":
      return "hammer";
    case "custom-melee":
    default:
      return "sword";
  }
}
