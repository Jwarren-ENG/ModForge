import type { Buffer } from "node:buffer";
import { assertApiKey, config } from "../config.js";
import { runPreflight, type PreflightResult } from "../preflight.js";
import { createModSpec } from "../agent/createModSpec.js";
import { generateModCode } from "../agent/generateModCode.js";
import { generateReadme } from "../agent/generateReadme.js";
import { generateProjectSummary } from "../agent/generateProjectSummary.js";
import { createProjectWorkspace } from "../workspace/createProjectWorkspace.js";
import { generateFabricProject } from "../workspace/generateFabricProject.js";
import { repairLoop, type RepairEvent } from "../build/repairLoop.js";
import { tryGenerateDeterministically } from "../generators/index.js";
import {
  aiTexturesEnabled,
  precomputeAiTextures,
} from "../textures/openAiTexture.js";
import { safeWriteFiles } from "../workspace/safeWrite.js";
import type { BuildResult, ModSpec, RepairOutcome } from "../types.js";

export interface RunGenerationOptions {
  idea: string;
  maxRepairs?: number;
  buildTimeoutMs?: number;
  /** Skip preflight (e.g. tests). Default false. */
  skipPreflight?: boolean;
}

/**
 * Discriminated union of every event the core service emits during a run.
 * The CLI renders these to stdout; a future web frontend can stream them.
 */
export type GenerationEvent =
  | { type: "preflight"; result: PreflightResult }
  | { type: "phase"; name: PhaseName; message: string }
  | { type: "spec"; spec: ModSpec }
  | { type: "workspace"; projectPath: string }
  | { type: "scaffold:done" }
  | {
      type: "codegen:done";
      written: string[];
      source: "templates" | "ai";
      uncoveredReasons?: string[];
    }
  | { type: "build:start"; attempt: number }
  | { type: "build:chunk"; chunk: string }
  | { type: "build:result"; attempt: number; result: BuildResult }
  | { type: "repair:start"; attempt: number }
  | {
      type: "repair:done";
      attempt: number;
      diagnosis?: string;
      filesChanged: string[];
    }
  | { type: "stop"; reason: string }
  | { type: "done"; outcome: RepairOutcome; summary: string; projectPath: string }
  | { type: "error"; error: string };

export type PhaseName =
  | "preflight"
  | "spec"
  | "workspace"
  | "scaffold"
  | "codegen"
  | "build";

export interface RunGenerationResult {
  ok: boolean;
  spec?: ModSpec;
  projectPath?: string;
  outcome?: RepairOutcome;
  error?: string;
}

/**
 * Headless core. The CLI is a thin adapter around this. A future web
 * frontend can call this and stream events over websockets / SSE.
 */
export async function runGeneration(
  opts: RunGenerationOptions,
  onEvent: (e: GenerationEvent) => void = () => {},
): Promise<RunGenerationResult> {
  try {
    if (!opts.skipPreflight) {
      onEvent({ type: "phase", name: "preflight", message: "Checking JDK + Gradle" });
      const pf = await runPreflight();
      onEvent({ type: "preflight", result: pf });
      if (!pf.ok) {
        return { ok: false, error: "Preflight failed. " + pf.problems.join(" ") };
      }
    }

    assertApiKey();

    onEvent({ type: "phase", name: "spec", message: "Creating mod spec" });
    const spec = await createModSpec(opts.idea);
    onEvent({ type: "spec", spec });

    onEvent({ type: "phase", name: "workspace", message: "Creating project workspace" });
    const projectPath = await createProjectWorkspace(spec.modId);
    onEvent({ type: "workspace", projectPath });

    onEvent({ type: "phase", name: "scaffold", message: "Scaffolding Fabric project" });
    await generateFabricProject(spec, projectPath);
    onEvent({ type: "scaffold:done" });

    onEvent({ type: "phase", name: "codegen", message: "Generating mod code" });

    // Optional: pre-fetch AI textures for custom item/weapon/tool features
    // when both env vars are set. Failures fall back to procedural silently
    // per feature; a notice surfaces in the generated README.
    let aiNotices: string[] = [];
    let aiTextures: ReadonlyMap<string, Buffer> | undefined;
    if (aiTexturesEnabled()) {
      const { textures, failures } = await precomputeAiTextures(spec);
      aiTextures = textures;
      aiNotices = failures.map(
        (f) =>
          `AI texture generation was attempted for ${f.id} but failed: ${f.reason}. Used deterministic fallback.`,
      );
    }
    const determ = tryGenerateDeterministically(spec, { aiTextures, aiNotices });
    let writtenPaths: string[];
    let codegenSource: "templates" | "ai";
    let extraLimitations: string[] = [];
    if (determ.fullyCovered) {
      const result = await safeWriteFiles(projectPath, determ.files);
      writtenPaths = result.written;
      codegenSource = "templates";
      // Surface generator notices (e.g. "fell back to procedural texture")
      // in the generated README's Limitations section.
      extraLimitations = determ.noticeMessages.slice();
    } else {
      const code = await generateModCode(spec, projectPath);
      writtenPaths = code.written;
      codegenSource = "ai";
    }
    onEvent({
      type: "codegen:done",
      written: writtenPaths,
      source: codegenSource,
      uncoveredReasons:
        determ.uncoveredReasons.length > 0 ? determ.uncoveredReasons : undefined,
    });

    onEvent({
      type: "phase",
      name: "build",
      message: "Running gradle build (first run downloads MC + mappings; this can take a while)",
    });
    const outcome = await repairLoop({
      spec,
      projectPath,
      maxRepairs: opts.maxRepairs ?? config.maxRepairs,
      buildTimeoutMs: opts.buildTimeoutMs,
      onLog: (line) => onEvent({ type: "build:chunk", chunk: line }),
      onEvent: (e: RepairEvent) => forwardRepairEvent(e, onEvent),
    });

    if (outcome.success) {
      await generateReadme(spec, projectPath, outcome.jarPath, extraLimitations);
    }
    const summary = generateProjectSummary(spec, outcome, projectPath);
    onEvent({ type: "done", outcome, summary, projectPath });

    return { ok: outcome.success, spec, projectPath, outcome };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onEvent({ type: "error", error: msg });
    return { ok: false, error: msg };
  }
}

function forwardRepairEvent(
  e: RepairEvent,
  onEvent: (e: GenerationEvent) => void,
): void {
  switch (e.type) {
    case "build:start":
      onEvent({ type: "build:start", attempt: e.attempt });
      break;
    case "build:result":
      onEvent({ type: "build:result", attempt: e.attempt, result: e.result });
      break;
    case "repair:start":
      onEvent({ type: "repair:start", attempt: e.attempt });
      break;
    case "repair:done":
      onEvent({
        type: "repair:done",
        attempt: e.attempt,
        diagnosis: e.diagnosis,
        filesChanged: e.filesChanged,
      });
      break;
    case "stop":
      onEvent({ type: "stop", reason: e.reason });
      break;
  }
}
