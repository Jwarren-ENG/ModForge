// Schema-derived types (single source of truth for the validated shapes).
// GeneratedFile is intentionally NOT re-exported from schemas — internal
// generators may produce Buffer content (PNGs), while AI responses are
// validated as string-only. See `safeWriteFiles` for the union.
export type {
  ModSpec,
  ModFeature,
  CodegenResponse,
  RepairResponse,
} from "./schemas.js";

import type { Buffer } from "node:buffer";

/** Internal file representation. PNGs and other binaries arrive as Buffer. */
export interface GeneratedFile {
  path: string;
  content: string | Buffer;
}

export type BuildReason =
  | "success"
  | "build-failed"
  | "timeout"
  | "spawn-failed";

export interface BuildResult {
  success: boolean;
  reason: BuildReason;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  timedOut: boolean;
}

export interface RepairAttemptRecord {
  attempt: number;
  buildReason: BuildReason;
  buildDurationMs: number;
  errorSignature: string;
  diagnosis?: string;
  filesChanged: string[];
  stopReason?: string;
}

export interface RepairOutcome {
  success: boolean;
  buildAttempts: number;
  repairAttempts: number;
  history: RepairAttemptRecord[];
  finalReason: BuildReason | "no-progress" | "no-changes" | "max-repairs";
  jarPath?: string;
}
