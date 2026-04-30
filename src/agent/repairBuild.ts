import fs from "node:fs/promises";
import path from "node:path";
import { ask, extractJson } from "../anthropic.js";
import { config } from "../config.js";
import { RepairResponseSchema, parseOrThrow } from "../schemas.js";
import type { GeneratedFile, ModSpec } from "../types.js";
import { diffChangedPaths, safeWriteFiles } from "../workspace/safeWrite.js";

const SYSTEM = `You are ModForge AI's repair agent. A Fabric mod failed to build. You will read the build error log and a curated set of project files, identify the root cause, and emit FULL replacement contents for ONLY the files that need to change.

Stack (do not change):
- Minecraft \${MC}, Fabric Loader \${LOADER}, Fabric API \${FABRIC_API}, Yarn \${YARN}, Java 17

Hard rules:
- Output ONE JSON object inside <json>...</json>. No prose outside.
- Only include files you are changing. Do NOT include unchanged files.
- All file paths MUST start with one of:
    src/main/java/
    src/main/resources/
  Any other path will be REJECTED by the writer (you cannot modify build.gradle, settings.gradle, gradle.properties, fabric.mod.json, package.json, or top-level files).
- Do not invent APIs. Prefer minimal edits that resolve the specific compiler/Gradle errors shown.
- If a referenced symbol does not exist in the targeted Yarn mappings, replace it with the correct stable Yarn name for MC \${MC}.
- If you have already attempted a fix that didn't work, try a DIFFERENT root-cause hypothesis — repeating the same patch wastes a repair attempt.`;

export interface RepairInput {
  spec: ModSpec;
  projectPath: string;
  buildLog: string;
  attempt: number;
  previousAttempts: ReadonlyArray<{ diagnosis?: string; filesChanged: string[] }>;
}

export interface RepairOutput {
  diagnosis?: string;
  filesChanged: string[];   // paths actually different from on-disk content
  filesProposed: number;    // total files in the LLM response
}

export async function repairBuild({
  spec,
  projectPath,
  buildLog,
  attempt,
  previousAttempts,
}: RepairInput): Promise<RepairOutput> {
  const f = config.fabric;
  const system = SYSTEM
    .replaceAll("${MC}", f.mcVersion)
    .replaceAll("${LOADER}", f.loaderVersion)
    .replaceAll("${FABRIC_API}", f.fabricApiVersion)
    .replaceAll("${YARN}", f.yarnMappings);

  const editable = await collectEditableFiles(projectPath);
  // collectEditableFiles only returns text files (binaries are skipped), so
  // values are always strings even though GeneratedFile.content is widened.
  const editableMap = new Map<string, string>(
    editable.map((e) => [e.path, typeof e.content === "string" ? e.content : ""]),
  );
  const trimmedLog = trimLog(buildLog, 12000);

  const historyBlock = previousAttempts.length
    ? `Previous repair attempts (most recent last):\n${previousAttempts
        .map(
          (a, i) =>
            `  ${i + 1}. diagnosis="${a.diagnosis ?? "(none)"}" files=${a.filesChanged.join(", ") || "(none)"}`,
        )
        .join("\n")}\n\n`
    : "";

  const user = `Build attempt #${attempt} failed. Repair the mod.

Spec:
\`\`\`json
${JSON.stringify(spec, null, 2)}
\`\`\`

${historyBlock}Build log (truncated):
\`\`\`
${trimmedLog}
\`\`\`

Current project files (full contents, project-relative paths):
${editable.map((e) => `--- FILE: ${e.path} ---\n${e.content}`).join("\n\n")}

Output JSON shape:
{
  "diagnosis": "short root-cause summary",
  "files": [ { "path": "...", "content": "..." } ]
}

Return the JSON now inside <json>...</json>. If you cannot determine a fix, return an empty "files" array.`;

  const text = await ask({ system, user, maxTokens: 16000 });
  const raw = extractJson(text);
  const parsed = parseOrThrow(RepairResponseSchema, raw, "Repair response");

  // The repair LLM only ever produces text. Reject any attempt to write a
  // binary asset — its content arrived as a UTF-8 string and writing it out
  // would corrupt PNGs (or other binaries). Procedural PNGs are still emitted
  // by trusted template code via Buffer; this filter only blocks the LLM path.
  rejectBinaryRepairPaths(parsed.files);

  // Filter to actually-changed files before writing — saves a wasted retry
  // when the LLM echoes unchanged content.
  const changed = filterChanged(parsed.files, editableMap);
  if (changed.length > 0) {
    await safeWriteFiles(projectPath, changed);
  }

  return {
    diagnosis: parsed.diagnosis,
    filesChanged: diffChangedPaths(editableMap, changed),
    filesProposed: parsed.files.length,
  };
}

function filterChanged(
  files: GeneratedFile[],
  current: Map<string, string>,
): GeneratedFile[] {
  return files.filter((f) => {
    const rel = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
    return current.get(rel) !== f.content;
  });
}

const REPAIR_BINARY_EXT: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".ogg", ".wav",
  ".jar", ".class", ".zip",
]);

export function rejectBinaryRepairPaths(files: GeneratedFile[]): void {
  for (const f of files) {
    const lower = f.path.toLowerCase();
    const dot = lower.lastIndexOf(".");
    const ext = dot >= 0 ? lower.slice(dot) : "";
    if (REPAIR_BINARY_EXT.has(ext)) {
      throw new Error(
        `Repair response tried to write a binary file via text content: "${f.path}". ` +
          `Repair is text-only; binaries (textures, audio, archives) are produced exclusively ` +
          `by deterministic templates and cannot be modified by AI repair.`,
      );
    }
  }
}

const EDITABLE_DIRS = ["src/main/java", "src/main/resources"];
// Repair only handles text. PNGs (and other binary assets) are skipped when
// building the editable file list — sending them to Claude as garbled UTF-8
// would corrupt them on round-trip.
const SKIP_BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".ogg", ".wav", ".mp3",
  ".jar", ".zip",
]);

async function collectEditableFiles(
  projectPath: string,
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  for (const dir of EDITABLE_DIRS) {
    const abs = path.join(projectPath, dir);
    await walk(abs, projectPath, files);
  }
  return files;
}

async function walk(
  dir: string,
  root: string,
  out: GeneratedFile[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, root, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (SKIP_BINARY_EXT.has(ext)) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      const content = await fs.readFile(full, "utf8");
      out.push({ path: rel, content });
    }
  }
}

function trimLog(log: string, maxChars: number): string {
  if (log.length <= maxChars) return log;
  const head = log.slice(0, Math.floor(maxChars * 0.3));
  const tail = log.slice(log.length - Math.floor(maxChars * 0.7));
  return `${head}\n... [${log.length - maxChars} chars truncated] ...\n${tail}`;
}
