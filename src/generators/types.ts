import type { GeneratedFile } from "../types.js";

/**
 * A per-feature contribution to the deterministic generator output.
 * The composer (mainClass.ts) merges contributions into a single
 * ModInitializer .java file plus all referenced resource files.
 */
export interface FeatureContribution {
  /** Fully qualified imports (no leading "import"; no semicolon). Deduped by composer. */
  imports: string[];
  /** Lines like `public static final Item SAPPHIRE = new Item(new Item.Settings());`. Order preserved. */
  fieldDecls: string[];
  /** Statements registered in the items group inside onInitialize. */
  itemRegisters: string[];
  /** Statements registered in the blocks group (block + blockitem). */
  blockRegisters: string[];
  /** Full `dispatcher.register(...)` calls, one per command. */
  commandRegisters: string[];
  /** Additional .java files (e.g. custom Item subclass for a hammer). */
  extraJavaFiles: GeneratedFile[];
  /** Plain resource files (models, blockstates, recipes, loot tables). */
  resources: GeneratedFile[];
  /** Translation entries merged into a single en_us.json. */
  langEntries: Record<string, string>;
  /** Block tag contributions: tagPath -> array of "<modid>:<id>" values, merged across features. */
  blockTags: Record<string, string[]>;
}

export function emptyContribution(): FeatureContribution {
  return {
    imports: [],
    fieldDecls: [],
    itemRegisters: [],
    blockRegisters: [],
    commandRegisters: [],
    extraJavaFiles: [],
    resources: [],
    langEntries: {},
    blockTags: {},
  };
}
