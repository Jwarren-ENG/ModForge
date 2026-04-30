import crypto from "node:crypto";
import { config } from "../config.js";
import type {
  BuildResult,
  ModSpec,
  RepairAttemptRecord,
  RepairOutcome,
} from "../types.js";
import { runGradleBuild } from "./runGradleBuild.js";
import { repairBuild } from "../agent/repairBuild.js";
import { packageSuccessfulBuild } from "../workspace/packageSuccessfulBuild.js";

export interface RepairLoopOptions {
  spec: ModSpec;
  projectPath: string;
  maxRepairs?: number;
  buildTimeoutMs?: number;
  onLog?: (line: string) => void;
  onEvent?: (event: RepairEvent) => void;
}

export type RepairEvent =
  | { type: "build:start"; attempt: number }
  | { type: "build:result"; attempt: number; result: BuildResult }
  | { type: "repair:start"; attempt: number }
  | {
      type: "repair:done";
      attempt: number;
      diagnosis?: string;
      filesChanged: string[];
    }
  | { type: "stop"; reason: string };

export async function repairLoop({
  spec,
  projectPath,
  maxRepairs = config.maxRepairs,
  buildTimeoutMs,
  onLog = () => {},
  onEvent = () => {},
}: RepairLoopOptions): Promise<RepairOutcome> {
  const history: RepairAttemptRecord[] = [];
  let buildAttempts = 0;
  let repairAttempts = 0;
  let lastSignature = "";
  let finalReason: RepairOutcome["finalReason"] = "build-failed";

  // Build #1.
  let build = await runBuild(projectPath, buildTimeoutMs, onLog, onEvent, ++buildAttempts);
  let signature = errorSignature(build);
  pushHistory(history, buildAttempts, build, signature);

  while (!build.success) {
    finalReason = build.reason;

    // Spawn failure or timeout: do not try to repair the source — the build
    // didn't even reach a compile error worth diagnosing.
    if (build.reason === "spawn-failed") {
      stop(history, "Gradle could not be launched (PATH/permission issue).", onEvent);
      break;
    }
    if (build.reason === "timeout") {
      stop(history, "Build timed out — repair would not address the cause.", onEvent);
      break;
    }

    if (repairAttempts >= maxRepairs) {
      finalReason = "max-repairs";
      stop(history, `Reached MODFORGE_MAX_REPAIRS=${maxRepairs}.`, onEvent);
      break;
    }

    // Identical error signature = no progress. Don't waste another LLM call.
    if (lastSignature && signature === lastSignature) {
      finalReason = "no-progress";
      stop(history, "Identical build error signature as previous attempt — repair not making progress.", onEvent);
      break;
    }
    lastSignature = signature;

    repairAttempts++;
    onEvent({ type: "repair:start", attempt: repairAttempts });
    onLog(`\n[repair ${repairAttempts}/${maxRepairs}] asking Claude to repair...\n`);

    let repairResult;
    try {
      repairResult = await repairBuild({
        spec,
        projectPath,
        buildLog: combineLog(build),
        attempt: buildAttempts,
        previousAttempts: history.map((h) => ({
          diagnosis: h.diagnosis,
          filesChanged: h.filesChanged,
        })),
      });
    } catch (err) {
      const msg = (err as Error).message;
      onLog(`\n[repair] failed: ${msg}\n`);
      stop(history, `Repair agent error: ${msg}`, onEvent);
      break;
    }

    const last = history[history.length - 1]!;
    last.diagnosis = repairResult.diagnosis;
    last.filesChanged = repairResult.filesChanged;
    onEvent({
      type: "repair:done",
      attempt: repairAttempts,
      diagnosis: repairResult.diagnosis,
      filesChanged: repairResult.filesChanged,
    });

    if (repairResult.filesChanged.length === 0) {
      finalReason = "no-changes";
      stop(history, "Repair returned no changed files — bailing out.", onEvent);
      break;
    }

    // Next build.
    build = await runBuild(projectPath, buildTimeoutMs, onLog, onEvent, ++buildAttempts);
    signature = errorSignature(build);
    pushHistory(history, buildAttempts, build, signature);
  }

  if (build.success) finalReason = "success";

  const jarPath = build.success
    ? await packageSuccessfulBuild(projectPath)
    : undefined;

  return {
    success: build.success,
    buildAttempts,
    repairAttempts,
    history,
    finalReason,
    jarPath,
  };
}

async function runBuild(
  projectPath: string,
  timeoutMs: number | undefined,
  onLog: (line: string) => void,
  onEvent: (e: RepairEvent) => void,
  attempt: number,
): Promise<BuildResult> {
  onEvent({ type: "build:start", attempt });
  onLog(`\n[build ${attempt}] running gradle build...\n`);
  const result = await runGradleBuild({
    projectPath,
    timeoutMs,
    onChunk: (chunk) => onLog(chunk),
  });
  onEvent({ type: "build:result", attempt, result });
  return result;
}

function pushHistory(
  history: RepairAttemptRecord[],
  attempt: number,
  build: BuildResult,
  signature: string,
): void {
  history.push({
    attempt,
    buildReason: build.reason,
    buildDurationMs: build.durationMs,
    errorSignature: signature,
    filesChanged: [],
  });
}

function stop(
  history: RepairAttemptRecord[],
  reason: string,
  onEvent: (e: RepairEvent) => void,
): void {
  const last = history[history.length - 1];
  if (last) last.stopReason = reason;
  onEvent({ type: "stop", reason });
}

function combineLog(b: BuildResult): string {
  return `--- STDOUT ---\n${b.stdout}\n--- STDERR ---\n${b.stderr}`;
}

/**
 * Hash the "interesting" lines of a build log (compiler errors, FAILED markers)
 * so the loop can detect "we made no progress" without being fooled by
 * timestamps and per-run noise.
 */
function errorSignature(b: BuildResult): string {
  if (b.success) return "success";
  if (b.reason === "spawn-failed") return "spawn-failed";
  if (b.reason === "timeout") return "timeout";
  const log = `${b.stdout}\n${b.stderr}`;
  const interesting = log
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) =>
      /error:|FAILED|cannot find symbol|incompatible types|cannot resolve|package .* does not exist|Compilation failed|Unresolved reference/i.test(
        l,
      ),
    )
    // Strip absolute paths so identical errors hash to the same value across runs.
    .map((l) => l.replace(/(\/[\w./-]+)+/g, "<path>"))
    .map((l) => l.replace(/:\d+:/g, ":<line>:"));
  return crypto
    .createHash("sha1")
    .update(interesting.join("\n"))
    .digest("hex");
}
