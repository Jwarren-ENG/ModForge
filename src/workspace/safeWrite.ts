import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import type { GeneratedFile } from "../types.js";

/**
 * Phase-specific allowlists. Codegen and repair are only allowed to write
 * inside the Java source tree and the resources tree; anything else (Gradle
 * config, manifests, package.json, top-level files) is the scaffolder's
 * responsibility and must be rejected when it comes from an LLM.
 */
export const LLM_WRITE_ALLOWLIST: ReadonlyArray<string> = [
  "src/main/java/",
  "src/main/resources/",
];

/**
 * Always rejected by name, no matter where they appear. The deterministic
 * scaffolder is the only writer permitted to touch these — the LLM (codegen
 * or repair) must not be able to overwrite the Fabric manifest, Gradle config,
 * or any Node/IDE config.
 */
const DENY_BASENAMES: ReadonlySet<string> = new Set([
  "fabric.mod.json",
  "fabric.mod.json5",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".env",
  ".env.local",
  ".npmrc",
]);

export interface SafeWriteOptions {
  /** Allowlist of project-relative path prefixes (default: LLM_WRITE_ALLOWLIST). */
  allowPrefixes?: ReadonlyArray<string>;
}

export interface SafeWriteResult {
  written: string[];      // project-relative paths that were written
  rejected: Array<{ path: string; reason: string }>;
}

/**
 * Write a list of LLM-produced files into a project, enforcing:
 *   - no absolute paths
 *   - no `..` traversal
 *   - resolved path stays inside `projectPath`
 *   - relative path matches one of the allowlist prefixes
 *   - basename is not on the deny list
 *
 * Throws on the first violation. Either every file in the batch is safe,
 * or none of them are written. This way a malicious / hallucinated path
 * cannot stomp the scaffolder's output partway through a batch.
 */
export async function safeWriteFiles(
  projectPath: string,
  files: GeneratedFile[],
  opts: SafeWriteOptions = {},
): Promise<SafeWriteResult> {
  const allow = opts.allowPrefixes ?? LLM_WRITE_ALLOWLIST;
  const projectAbs = path.resolve(projectPath);
  const projectAbsWithSep = projectAbs.endsWith(path.sep)
    ? projectAbs
    : projectAbs + path.sep;

  // Validate everything first.
  const checked: Array<{ rel: string; abs: string; content: string | Buffer }> = [];
  const seenPaths = new Map<string, number>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const reason = validate(file.path, projectAbs, projectAbsWithSep, allow);
    if (reason) {
      throw new Error(
        `Rejected unsafe file path from LLM: "${file.path}" — ${reason}`,
      );
    }
    const rel = normalizeRel(file.path);
    const prev = seenPaths.get(rel);
    if (prev !== undefined) {
      // Two entries in the same batch resolve to the same on-disk path. The
      // later one would silently overwrite the earlier one — refuse the whole
      // batch so the caller has to deduplicate intentionally.
      throw new Error(
        `Duplicate output path in write batch: "${rel}" (entries ${prev} and ${i}). ` +
          `Refusing to write so an earlier file is not silently overwritten.`,
      );
    }
    seenPaths.set(rel, i);
    const abs = path.join(projectAbs, rel);
    checked.push({ rel, abs, content: file.content });
  }

  // All clear — write. Buffers are written as binary; strings as utf8.
  const written: string[] = [];
  for (const c of checked) {
    await fs.mkdir(path.dirname(c.abs), { recursive: true });
    if (Buffer.isBuffer(c.content)) {
      await fs.writeFile(c.abs, c.content);
    } else {
      await fs.writeFile(c.abs, c.content, "utf8");
    }
    written.push(c.rel);
  }
  return { written, rejected: [] };
}

function validate(
  rawPath: string,
  projectAbs: string,
  projectAbsWithSep: string,
  allow: ReadonlyArray<string>,
): string | null {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return "empty path";
  }
  if (path.isAbsolute(rawPath)) {
    return "absolute paths are not allowed";
  }
  // Detect `..` segments before normalization (post-normalize they may collapse).
  const parts = rawPath.split(/[\\/]+/);
  if (parts.some((p) => p === "..")) {
    return "path traversal ('..') is not allowed";
  }
  if (parts.some((p) => p === "" || p === ".")) {
    // Empty segment between // is fine via split, but reject explicit "." segments.
    if (parts.includes(".")) return "'.' segment is not allowed";
  }

  const rel = normalizeRel(rawPath);
  const abs = path.resolve(projectAbs, rel);
  if (abs !== projectAbs && !abs.startsWith(projectAbsWithSep)) {
    return "resolved path escapes the project directory";
  }

  const base = path.basename(rel);
  if (DENY_BASENAMES.has(base)) {
    return `basename "${base}" is not writable by the LLM (scaffolder owns it)`;
  }

  if (!allow.some((prefix) => rel === stripTrailingSlash(prefix) || rel.startsWith(prefix))) {
    return `path is outside the allowlist [${allow.join(", ")}]`;
  }

  return null;
}

function normalizeRel(rawPath: string): string {
  // Force forward-slash project-relative form.
  return rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Project-relative paths that actually changed on disk between two file lists,
 * comparing by content hash. Used by the repair loop to track real progress.
 */
export function diffChangedPaths(
  before: Map<string, string>,
  after: GeneratedFile[],
): string[] {
  const changed: string[] = [];
  for (const f of after) {
    // Binary files are never compared — repair only ever produces text.
    if (typeof f.content !== "string") continue;
    const rel = normalizeRel(f.path);
    if (before.get(rel) !== f.content) changed.push(rel);
  }
  return changed;
}
