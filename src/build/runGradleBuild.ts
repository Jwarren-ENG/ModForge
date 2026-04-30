import { spawn } from "node:child_process";
import type { BuildResult } from "../types.js";

export interface BuildOptions {
  projectPath: string;
  task?: string;
  /** Hard timeout in ms. The process is SIGTERM'd, then SIGKILL'd. */
  timeoutMs?: number;
  /** Per-stream byte cap for captured logs. Excess is dropped with a marker. */
  maxLogBytes?: number;
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — first Loom build is slow
const DEFAULT_MAX_LOG_BYTES = 1 * 1024 * 1024; // 1 MiB per stream
const SIGKILL_GRACE_MS = 5_000;

/**
 * Runs `gradle <task>` in the given project directory.
 *
 * Distinguishes four outcomes via `result.reason`:
 *   - "success"        — exit 0
 *   - "build-failed"   — non-zero exit
 *   - "timeout"        — killed because timeoutMs elapsed
 *   - "spawn-failed"   — gradle could not be launched at all
 *
 * Both stdout and stderr are bounded; once `maxLogBytes` is hit the rest is
 * dropped and a `[truncated: N bytes]` marker is appended.
 */
export function runGradleBuild({
  projectPath,
  task = "build",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  onChunk,
}: BuildOptions): Promise<BuildResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const out = createBoundedSink(maxLogBytes);
    const err = createBoundedSink(maxLogBytes);
    let timedOut = false;
    let settled = false;

    const settle = (r: BuildResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const child = spawn("gradle", [task, "--no-daemon", "--console=plain"], {
      cwd: projectPath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (b: Buffer) => {
      const s = b.toString("utf8");
      out.push(s);
      onChunk?.(s, "stdout");
    });
    child.stderr.on("data", (b: Buffer) => {
      const s = b.toString("utf8");
      err.push(s);
      onChunk?.(s, "stderr");
    });

    child.on("error", (e) => {
      // Most commonly: gradle not on PATH (ENOENT). Distinguished as spawn-failed.
      settle({
        success: false,
        reason: "spawn-failed",
        exitCode: null,
        stdout: out.read(),
        stderr: err.read() + `\n[spawn error] ${e.message}`,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
        durationMs: Date.now() - start,
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      const reason: BuildResult["reason"] = timedOut
        ? "timeout"
        : code === 0
          ? "success"
          : "build-failed";
      settle({
        success: reason === "success",
        reason,
        exitCode: code,
        stdout: out.read(),
        stderr: err.read(),
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
        durationMs: Date.now() - start,
        timedOut,
      });
    });

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      // SIGTERM first; if it doesn't exit, SIGKILL.
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, SIGKILL_GRACE_MS);
    }, timeoutMs);
  });
}

interface BoundedSink {
  push(s: string): void;
  read(): string;
  truncated: boolean;
}

function createBoundedSink(maxBytes: number): BoundedSink {
  const chunks: string[] = [];
  let bytes = 0;
  let dropped = 0;
  let truncated = false;
  return {
    push(s: string) {
      const len = Buffer.byteLength(s, "utf8");
      if (bytes + len <= maxBytes) {
        chunks.push(s);
        bytes += len;
        return;
      }
      truncated = true;
      const remaining = maxBytes - bytes;
      if (remaining > 0) {
        // Push only what fits; UTF-8 boundary safety isn't critical here
        // because we slice on the JS string, not the byte buffer.
        const ratio = remaining / len;
        const sliceLen = Math.max(0, Math.floor(s.length * ratio));
        if (sliceLen > 0) {
          chunks.push(s.slice(0, sliceLen));
          bytes += Buffer.byteLength(s.slice(0, sliceLen), "utf8");
        }
      }
      dropped += len - Math.max(0, maxBytes - (bytes - len));
    },
    read() {
      const body = chunks.join("");
      return truncated ? `${body}\n[truncated: ~${dropped} bytes dropped]` : body;
    },
    get truncated() {
      return truncated;
    },
  };
}
