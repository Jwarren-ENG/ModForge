#!/usr/bin/env tsx
/**
 * Populate ./vanilla-assets-1.20.1/ from the user's local Minecraft 1.20.1
 * launcher install. The output directory is gitignored — Mojang assets stay
 * local. Run with:
 *
 *   npm run vanilla:extract
 *
 * Then point ModForge at it:
 *
 *   export MODFORGE_VANILLA_ASSETS_DIR="$(pwd)/vanilla-assets-1.20.1"
 *
 * The script reads the launcher's standard `assets/indexes/1.20.1.json`,
 * looks up each path in ModForge's vanilla retexture allowlist, and copies
 * the corresponding content-addressed object file into the expected layout.
 * Anything not found in the local install is skipped with a warning;
 * ModForge falls back to its procedural texture for those.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VANILLA_ITEM_TARGETS,
  VANILLA_BLOCK_TARGETS,
} from "../src/textures/vanillaTargets.js";
import { readZipCentralDirectory, readZipEntry } from "./zip.js";

interface AssetEntry {
  hash: string;
  size: number;
}
interface AssetIndex {
  objects: Record<string, AssetEntry>;
}

// --------------------------------------------------------------------------
// Pure helpers (exported for unit tests).
// --------------------------------------------------------------------------

/** Standard Minecraft launcher root for the current OS. */
export function mcLauncherRoot(): string {
  const platform = process.platform;
  if (platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "minecraft",
    );
  }
  if (platform === "win32") {
    return path.join(process.env.APPDATA ?? "", ".minecraft");
  }
  return path.join(os.homedir(), ".minecraft");
}

const DEFAULT_VERSION_ID = "1.20.1";

export function mcVersionManifestPath(
  versionId: string = DEFAULT_VERSION_ID,
  root: string = mcLauncherRoot(),
): string {
  return path.join(root, "versions", versionId, `${versionId}.json`);
}

/**
 * Path to the asset index file. The launcher names the file by its
 * `assetIndex.id` (declared in the version's manifest), NOT by the
 * version id itself. Modern 1.20.1 installs use id "5". Older or
 * differently-installed setups may use "1.20.1". Pass the id you
 * resolved via `resolveAssetIndexId`.
 */
export function mcAssetsIndexPath(
  assetIndexId: string = DEFAULT_VERSION_ID,
  root: string = mcLauncherRoot(),
): string {
  return path.join(root, "assets", "indexes", `${assetIndexId}.json`);
}

export function mcObjectsRoot(root: string = mcLauncherRoot()): string {
  return path.join(root, "assets", "objects");
}

/** Path to the version client jar (e.g. .../versions/1.20.1/1.20.1.jar). */
export function mcVersionJarPath(
  versionId: string = DEFAULT_VERSION_ID,
  root: string = mcLauncherRoot(),
): string {
  return path.join(root, "versions", versionId, `${versionId}.jar`);
}

/**
 * Extract allowlisted texture PNGs out of a Minecraft client jar.
 *
 * Only entries whose name exactly matches one of `wantedPaths` are written.
 * Returns the set of allowlist paths that were successfully extracted, so the
 * caller can fall back to the asset index for the rest.
 */
export function extractTexturesFromJar(
  jarPath: string,
  wantedPaths: readonly string[],
  outputRoot: string,
): { extracted: Set<string>; errors: Array<{ path: string; reason: string }> } {
  const wanted = new Set(wantedPaths);
  const extracted = new Set<string>();
  const errors: Array<{ path: string; reason: string }> = [];
  const buf = fs.readFileSync(jarPath);
  const entries = readZipCentralDirectory(buf);
  for (const entry of entries) {
    if (!wanted.has(entry.name)) continue;
    try {
      const data = readZipEntry(buf, entry);
      const outPath = path.join(outputRoot, entry.name);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, data);
      extracted.add(entry.name);
    } catch (e) {
      errors.push({ path: entry.name, reason: (e as Error).message });
    }
  }
  return { extracted, errors };
}

/**
 * Read `<root>/versions/<versionId>/<versionId>.json`, parse the
 * `assetIndex.id` field, and return it. Returns null when:
 *   - the version manifest doesn't exist
 *   - the JSON is malformed
 *   - assetIndex.id is missing / non-string / empty
 *   - the id contains path-unsafe characters (defense-in-depth — should never
 *     happen with real launcher data, but the id ends up in a filesystem
 *     path so we restrict to a safe character class)
 */
export function resolveAssetIndexId(
  root: string = mcLauncherRoot(),
  versionId: string = DEFAULT_VERSION_ID,
): string | null {
  const manifestPath = mcVersionManifestPath(versionId, root);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { assetIndex?: { id?: unknown } };
    const id = parsed?.assetIndex?.id;
    if (typeof id !== "string" || id.length === 0) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
    return id;
  } catch {
    return null;
  }
}

/** ModForge stores allowlist paths as `assets/minecraft/textures/...`; the
 *  launcher index keys are without the leading `assets/`. */
export function relIndexKeyForAllowlistPath(p: string): string {
  const norm = String(p).replace(/\\/g, "/");
  if (norm.startsWith("assets/")) return norm.slice("assets/".length);
  return norm;
}

/** Content-addressed storage layout: `<first-2-hash-chars>/<full-hash>`. */
export function objectStorageRelPath(hash: string): string {
  if (typeof hash !== "string" || !/^[0-9a-f]+$/i.test(hash) || hash.length < 2) {
    throw new Error(`bad hash: ${JSON.stringify(hash)}`);
  }
  return path.join(hash.slice(0, 2), hash);
}

/** Collect every texture path the retexture allowlist references. */
export function collectAllowlistTexturePaths(): string[] {
  const paths = new Set<string>();
  for (const t of Object.values(VANILLA_ITEM_TARGETS)) {
    paths.add(t.texturePath);
  }
  for (const t of Object.values(VANILLA_BLOCK_TARGETS)) {
    for (const p of Object.values(t.texturePaths)) {
      if (p) paths.add(p);
    }
  }
  return [...paths].sort();
}

// --------------------------------------------------------------------------
// CLI entry point.
// --------------------------------------------------------------------------

interface RunResult {
  copied: number;
  fromJar: number;
  fromIndex: number;
  missing: number;
  outputRoot: string;
}

export async function run(): Promise<RunResult> {
  // Modern 1.20.1 installs ship most textures inside versions/<id>/<id>.jar,
  // not in the content-addressed assets/objects/ store. Use the jar as the
  // primary source, and fall back to the asset index for anything missing.
  const versionManifestPath = mcVersionManifestPath();
  const detectedId = resolveAssetIndexId();
  const indexId = detectedId ?? DEFAULT_VERSION_ID;
  const indexPath = mcAssetsIndexPath(indexId);
  const jarPath = mcVersionJarPath();

  console.log(
    `Version manifest: ${versionManifestPath} ${
      fs.existsSync(versionManifestPath) ? "(found)" : "(missing)"
    }`,
  );
  console.log(
    `Detected assetIndex.id: ${
      detectedId
        ? `"${detectedId}"`
        : `(unresolved — falling back to "${DEFAULT_VERSION_ID}")`
    }`,
  );
  console.log(
    `Version jar: ${jarPath} ${fs.existsSync(jarPath) ? "(found)" : "(missing)"}`,
  );
  console.log(
    `Asset index path: ${indexPath} ${
      fs.existsSync(indexPath) ? "(found)" : "(missing)"
    }`,
  );

  const outputRoot = path.resolve("vanilla-assets-1.20.1");
  fs.mkdirSync(outputRoot, { recursive: true });
  const wanted = collectAllowlistTexturePaths();

  // -- Primary source: client jar --
  let extractedFromJar = new Set<string>();
  if (fs.existsSync(jarPath)) {
    try {
      const result = extractTexturesFromJar(jarPath, wanted, outputRoot);
      extractedFromJar = result.extracted;
      for (const err of result.errors) {
        console.warn(`skip (jar entry failed: ${err.path}): ${err.reason}`);
      }
    } catch (e) {
      console.warn(
        `Failed to read version jar at ${jarPath}: ${(e as Error).message}`,
      );
    }
  }

  // -- Fallback: asset index for paths not in the jar --
  const remaining = wanted.filter((p) => !extractedFromJar.has(p));
  let fromIndex = 0;
  let missing = 0;

  if (remaining.length > 0) {
    if (!fs.existsSync(indexPath)) {
      // Jar covered everything, or jar+index both missing.
      missing += remaining.length;
      if (extractedFromJar.size === 0) {
        console.error("");
        console.error(
          `Couldn't find a Minecraft client jar at ${jarPath} or asset index at ${indexPath}.`,
        );
        console.error(
          "  Launch Minecraft 1.20.1 in the official launcher at least once so it downloads them.",
        );
        process.exit(1);
      }
      for (const p of remaining) {
        console.warn(`skip (not in jar; index missing): ${p}`);
      }
    } else {
      let index: AssetIndex;
      try {
        index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as AssetIndex;
      } catch (e) {
        console.error(
          `Failed to parse index at ${indexPath}: ${(e as Error).message}`,
        );
        process.exit(1);
      }
      if (!index.objects || typeof index.objects !== "object") {
        console.error(`Index at ${indexPath} has no "objects" map.`);
        process.exit(1);
      }

      const objectsRoot = mcObjectsRoot();
      for (const wantedPath of remaining) {
        const indexKey = relIndexKeyForAllowlistPath(wantedPath);
        const entry = index.objects[indexKey];
        if (!entry || typeof entry.hash !== "string") {
          console.warn(`skip (not in jar or index): ${indexKey}`);
          missing++;
          continue;
        }
        let storageRel: string;
        try {
          storageRel = objectStorageRelPath(entry.hash);
        } catch (e) {
          console.warn(
            `skip (bad hash for ${indexKey}): ${(e as Error).message}`,
          );
          missing++;
          continue;
        }
        const objPath = path.join(objectsRoot, storageRel);
        if (!fs.existsSync(objPath)) {
          console.warn(`skip (object file missing): ${indexKey} -> ${objPath}`);
          missing++;
          continue;
        }
        const outPath = path.join(outputRoot, wantedPath);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.copyFileSync(objPath, outPath);
        fromIndex++;
      }
    }
  }

  const fromJar = extractedFromJar.size;
  const copied = fromJar + fromIndex;

  console.log("");
  console.log(
    `Copied ${copied} texture(s) into ${outputRoot} (${fromJar} from jar, ${fromIndex} from asset index)`,
  );
  if (missing > 0) {
    console.log(
      `  (${missing} not available in your local install — that's fine; ModForge will fall back to procedural for those)`,
    );
  }
  console.log("");
  console.log("Next: point ModForge at this directory:");
  console.log(`  export MODFORGE_VANILLA_ASSETS_DIR="${outputRoot}"`);
  console.log("Then re-run the web UI (npm run web) or the CLI.");

  return { copied, fromJar, fromIndex, missing, outputRoot };
}

// Run when invoked as a CLI; do nothing when imported by tests.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
