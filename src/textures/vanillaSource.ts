import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";

/**
 * Optional opt-in: when MODFORGE_VANILLA_ASSETS_DIR is set to a directory
 * the user has populated with their own extracted Minecraft 1.20.1 assets,
 * the retexture generators read the source PNG from there and recolor it
 * (preserving the original silhouette + detail). Without this env var, the
 * generators fall back to the procedural texture path.
 *
 * SAFETY: the path passed to readVanillaSource ALWAYS comes from the
 * hardcoded VANILLA_ITEM_TARGETS / VANILLA_BLOCK_TARGETS allowlist. User
 * input never reaches this function. We re-validate that:
 *   - the env var is set and a real directory
 *   - the relative path has no `..` segments and is not absolute
 *   - the resolved absolute path stays inside the configured root
 *   - the file ends in .png
 *
 * No web endpoint reads vanilla assets. This is a build-time/codegen-time
 * helper only.
 */

export function getVanillaAssetsDir(): string | null {
  const raw = process.env.MODFORGE_VANILLA_ASSETS_DIR;
  if (!raw || raw.trim().length === 0) return null;
  return path.resolve(raw.trim());
}

/**
 * Read the vanilla source PNG for an allowlisted texture path.
 * Returns null when:
 *   - the env var is not set
 *   - the path looks unsafe (defensive — shouldn't happen given the allowlist)
 *   - the configured directory doesn't exist
 *   - the file doesn't exist or isn't readable
 */
export function readVanillaSource(allowlistTexturePath: string): Buffer | null {
  const dir = getVanillaAssetsDir();
  if (!dir) return null;

  const normalized = String(allowlistTexturePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (normalized.length === 0) return null;
  if (normalized.split("/").includes("..")) return null;
  if (path.isAbsolute(normalized)) return null;
  if (!normalized.toLowerCase().endsWith(".png")) return null;

  const dirAbs = dir;
  const fileAbs = path.resolve(dirAbs, normalized);
  const dirSep = dirAbs.endsWith(path.sep) ? dirAbs : dirAbs + path.sep;
  if (fileAbs !== dirAbs && !fileAbs.startsWith(dirSep)) return null;

  try {
    const stat = fs.statSync(fileAbs);
    if (!stat.isFile()) return null;
    return fs.readFileSync(fileAbs);
  } catch {
    return null;
  }
}
