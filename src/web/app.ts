import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { runGeneration as defaultRunGeneration } from "../core/runGeneration.js";
import type {
  GenerationEvent,
  RunGenerationOptions,
} from "../core/runGeneration.js";
import { generateClarification as defaultClarify } from "../agent/clarify.js";
import type { ClarificationResponse } from "../schemas.js";
import {
  activeJobCount,
  createJob,
  getJob,
  jobCount,
  pushEvent,
} from "./jobs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type RunGenerationFn = (
  opts: RunGenerationOptions,
  onEvent: (e: GenerationEvent) => void,
) => Promise<unknown>;

export type OpenMode = "folder" | "reveal";
export type OpenInFinderFn = (filePath: string, mode: OpenMode) => Promise<void>;
export type ClarifyFn = (idea: string) => Promise<ClarificationResponse>;

export interface AppDeps {
  runGeneration?: RunGenerationFn;
  /** Cap on simultaneously-running generation jobs. Default 1. */
  maxActiveJobs?: number;
  /** Override the served client directory (tests). */
  clientDir?: string | null;
  /** Override the system "open in Finder" call (tests). */
  openInFinder?: OpenInFinderFn;
  /** Override the clarification LLM call (tests). */
  clarify?: ClarifyFn;
}

/**
 * Default Finder/Explorer launcher. Spawns the platform's native opener with
 * the path as a single argv element (no shell), so a malicious path cannot
 * inject a command — though the path itself is sourced from the recorded job
 * state, not from the client.
 */
const defaultOpenInFinder: OpenInFinderFn = (filePath, mode) =>
  new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];
    if (process.platform === "darwin") {
      cmd = "open";
      args = mode === "reveal" ? ["-R", filePath] : [filePath];
    } else if (process.platform === "win32") {
      cmd = "explorer";
      args = mode === "reveal" ? [`/select,${filePath}`] : [filePath];
    } else if (process.platform === "linux") {
      cmd = "xdg-open";
      // Linux has no universal "reveal in file manager"; open the parent dir.
      args = [mode === "reveal" ? path.dirname(filePath) : filePath];
    } else {
      return reject(new Error(`open not supported on platform: ${process.platform}`));
    }
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.on("error", (e) => reject(e));
      child.unref();
      // `open` returns immediately on macOS; we don't wait for the GUI to come up.
      resolve();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });

function isInside(child: string, parent: string): boolean {
  if (!parent) return false;
  const c = path.resolve(child);
  const p = path.resolve(parent);
  const pSep = p.endsWith(path.sep) ? p : p + path.sep;
  return c === p || c.startsWith(pSep);
}

const DEFAULT_MAX_ACTIVE_JOBS = 1;

export function createApp(deps: AppDeps = {}): Express {
  const runGen = deps.runGeneration ?? defaultRunGeneration;
  const maxActive = deps.maxActiveJobs ?? DEFAULT_MAX_ACTIVE_JOBS;
  const clientDir =
    deps.clientDir === null
      ? null
      : (deps.clientDir ?? path.resolve(__dirname, "client"));
  const openInFinder = deps.openInFinder ?? defaultOpenInFinder;
  const clarifyFn = deps.clarify ?? defaultClarify;

  const app = express();

  // Cheap defense-in-depth headers that don't break the static client.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.use(express.json({ limit: "32kb" }));

  // ---------- API ----------

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      jobs: jobCount(),
      activeJobs: activeJobCount(),
      maxActiveJobs: maxActive,
      // Used by the client to detect a stale server. If you add a new route,
      // append its name here so the UI can surface a clear "restart npm run
      // web" message instead of a confusing 404 from the catch-all.
      capabilities: [
        "health",
        "generate",
        "events",
        "preview",
        "open",
        "reveal",
        "download",
        "clarify",
      ],
    });
  });

  /**
   * Ask Claude whether the user's idea needs clarification, and if so return
   * up to 3 short questions with relevant answer choices. Synchronous (one
   * Claude call); does not consume an active-job slot.
   *
   * Body: { idea: string } (≤ 2000 chars).
   * Response shape: { skip, questions[], summary } per ClarificationResponseSchema.
   */
  app.post("/api/clarify", async (req, res) => {
    const body = req.body ?? {};
    const ideaRaw = typeof body.idea === "string" ? body.idea : "";
    const idea = ideaRaw.trim();
    if (idea.length === 0) {
      res.status(400).json({ error: "idea is required (non-empty string)" });
      return;
    }
    if (idea.length > 2000) {
      res.status(400).json({ error: "idea too long (max 2000 chars)" });
      return;
    }
    try {
      const result = await clarifyFn(idea);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/generate", (req, res) => {
    const body = req.body ?? {};
    const ideaRaw = typeof body.idea === "string" ? body.idea : "";
    const idea = ideaRaw.trim();
    if (idea.length === 0) {
      res.status(400).json({ error: "idea is required (non-empty string)" });
      return;
    }
    if (idea.length > 2000) {
      res.status(400).json({ error: "idea too long (max 2000 chars)" });
      return;
    }

    if (activeJobCount() >= maxActive) {
      res.status(429).json({
        error: "A generation job is already running. Please wait for it to finish.",
      });
      return;
    }

    const job = createJob(idea);
    runGen({ idea }, (e) => pushEvent(job, e)).catch((err) => {
      pushEvent(job, {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });

    res.json({ jobId: job.id });
  });

  app.get("/api/events/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    for (const e of job.events) {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    }
    if (job.done) {
      res.end();
      return;
    }

    job.listeners.add(res);
    const ka = setInterval(() => {
      try { res.write(": ka\n\n"); } catch { /* */ }
    }, 25_000);
    req.on("close", () => {
      clearInterval(ka);
      job.listeners.delete(res);
    });
  });

  /**
   * Serve a generated PNG texture by job id + file index.
   *
   * Safety:
   *   - jobId must be a known job
   *   - index must be an integer within job.pngFiles
   *   - the stored relative path must end in .png and contain no traversal
   *   - the resolved absolute path must be inside the job's project workspace
   *
   * The client NEVER sends a file path. Index-based lookup means the server
   * is the only thing that can choose what to read, and only from the list
   * the codegen step recorded.
   */
  app.get("/api/preview/:jobId/:index", async (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    if (!job.projectPath) {
      res.status(404).json({ error: "no project workspace for job yet" });
      return;
    }
    const idxRaw = req.params.index;
    if (!/^\d+$/.test(idxRaw)) {
      res.status(400).json({ error: "index must be a non-negative integer" });
      return;
    }
    const idx = Number(idxRaw);
    if (idx < 0 || idx >= job.pngFiles.length) {
      res.status(404).json({ error: "preview index out of range" });
      return;
    }
    const rel = job.pngFiles[idx]!;
    if (!rel.toLowerCase().endsWith(".png")) {
      res.status(403).json({ error: "preview only available for PNG files" });
      return;
    }
    if (rel.split(/[\\/]+/).includes("..") || path.isAbsolute(rel)) {
      // Should be unreachable — safeWriteFiles already validated these — but
      // defense-in-depth before opening a filesystem read.
      res.status(403).json({ error: "preview path is unsafe" });
      return;
    }
    const projectAbs = path.resolve(job.projectPath);
    const projectAbsWithSep = projectAbs.endsWith(path.sep)
      ? projectAbs
      : projectAbs + path.sep;
    const fileAbs = path.resolve(projectAbs, rel);
    if (fileAbs !== projectAbs && !fileAbs.startsWith(projectAbsWithSep)) {
      res.status(403).json({ error: "preview path escapes project directory" });
      return;
    }
    try {
      const data = await fsp.readFile(fileAbs);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(data);
    } catch {
      res.status(404).json({ error: "preview file not found on disk" });
    }
  });

  /**
   * Open the project workspace folder in Finder/Explorer.
   * Client passes only jobId. Server uses the recorded `job.projectPath`.
   * Refuses if the job is not yet complete (avoids opening a half-written tree).
   */
  app.post("/api/open/:jobId", async (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "job not found" }); return; }
    if (!job.done) { res.status(409).json({ error: "job not yet complete" }); return; }
    if (!job.projectPath) { res.status(404).json({ error: "no project workspace recorded" }); return; }
    try {
      const stat = await fsp.stat(job.projectPath);
      if (!stat.isDirectory()) { res.status(404).json({ error: "project path is not a directory" }); return; }
    } catch {
      res.status(404).json({ error: "project path no longer exists on disk" });
      return;
    }
    try {
      await openInFinder(job.projectPath, "folder");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: `could not open project folder: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  /**
   * Reveal the built JAR in Finder/Explorer.
   * Client passes only jobId. Server uses the recorded `job.jarPath` and
   * verifies it lives inside the recorded project workspace.
   */
  app.post("/api/reveal/:jobId", async (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "job not found" }); return; }
    if (!job.done) { res.status(409).json({ error: "job not yet complete" }); return; }
    if (!job.jarPath) { res.status(404).json({ error: "no jar artifact for this job" }); return; }
    if (!job.projectPath || !isInside(job.jarPath, job.projectPath)) {
      res.status(403).json({ error: "jar path is outside the job's project workspace" });
      return;
    }
    try {
      const stat = await fsp.stat(job.jarPath);
      if (!stat.isFile()) { res.status(404).json({ error: "jar is not a file" }); return; }
    } catch {
      res.status(404).json({ error: "jar file no longer exists on disk" });
      return;
    }
    try {
      await openInFinder(job.jarPath, "reveal");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: `could not reveal jar: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  /**
   * Download the built JAR. Client passes only jobId; server uses the recorded
   * `job.jarPath` after re-verifying it lives inside the project workspace.
   */
  app.get("/api/download/:jobId", async (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "job not found" }); return; }
    if (!job.done) { res.status(409).json({ error: "job not yet complete" }); return; }
    if (!job.jarPath) { res.status(404).json({ error: "no jar artifact for this job" }); return; }
    if (!job.projectPath || !isInside(job.jarPath, job.projectPath)) {
      res.status(403).json({ error: "jar path is outside the job's project workspace" });
      return;
    }
    let data: Buffer;
    try {
      data = await fsp.readFile(job.jarPath);
    } catch {
      res.status(404).json({ error: "jar file not readable" });
      return;
    }
    // Sanitize the basename for Content-Disposition. The basename comes from
    // a path the engine produced (mod_id-version.jar), so it's already tame,
    // but be conservative anyway.
    const safeName = path.basename(job.jarPath).replace(/[^A-Za-z0-9._-]/g, "_") || "modforge.jar";
    res.setHeader("Content-Type", "application/java-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("Content-Length", String(data.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.send(data);
  });

  // Tiny favicon — serve a 1x1 transparent PNG so browsers stop logging
  // /favicon.ico 404s during local dev. No user-visible impact either way.
  app.get("/favicon.ico", (_req, res) => {
    // 1x1 transparent PNG bytes (smallest valid).
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(png);
  });

  // Anything else under /api/* is a clean JSON 404.
  app.all("/api/*", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // ---------- Static client ----------

  if (clientDir !== null) {
    if (!fs.existsSync(clientDir)) {
      // Not a hard error — tests pass clientDir: null; for the real server,
      // server.ts checks this up front and refuses to start.
      // eslint-disable-next-line no-console
      console.warn(`[modforge web] client directory not found: ${clientDir}`);
    } else {
      app.use(
        express.static(clientDir, {
          index: "index.html",
          extensions: ["html"],
        }),
      );
    }
  }

  // ---------- Error middleware (must be last) ----------
  // Catch body parser failures (malformed JSON, oversized body) and any
  // unhandled error, returning JSON instead of Express's HTML default.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === "entity.too.large" || e?.status === 413) {
      res.status(413).json({ error: "Request body too large (max 32KB)" });
      return;
    }
    if (
      e?.type === "entity.parse.failed" ||
      (err instanceof SyntaxError && "body" in (err as object))
    ) {
      res.status(400).json({ error: "Invalid JSON in request body" });
      return;
    }
    if (e?.type === "encoding.unsupported") {
      res.status(415).json({ error: "Unsupported request encoding" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
