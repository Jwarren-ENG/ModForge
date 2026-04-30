import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Buffer } from "node:buffer";
import { createApp, type OpenInFinderFn, type RunGenerationFn } from "../src/web/app.js";
import { _resetJobs } from "../src/web/jobs.js";
import type { GenerationEvent } from "../src/core/runGeneration.js";

interface PendingJob {
  emit: (e: GenerationEvent) => void;
  resolve: () => void;
}

function makeStub(): { runGen: RunGenerationFn; pending: PendingJob[] } {
  const pending: PendingJob[] = [];
  const runGen: RunGenerationFn = (_opts, onEvent) =>
    new Promise((resolve) => {
      pending.push({ emit: onEvent, resolve: () => resolve(undefined) });
    });
  return { runGen, pending };
}

async function startServer(opts: {
  runGen?: RunGenerationFn;
  maxActiveJobs?: number;
  openInFinder?: OpenInFinderFn;
} = {}): Promise<{ port: number; close: () => Promise<void> }> {
  _resetJobs();
  const app = createApp({
    runGeneration: opts.runGen,
    maxActiveJobs: opts.maxActiveJobs,
    openInFinder: opts.openInFinder,
    clientDir: null, // skip static serving for tests
  });
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

const POST_JSON = (port: number, body: string, ct = "application/json") =>
  fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": ct },
    body,
  });

test("GET /api/health returns ok", async () => {
  const s = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type")?.split(";")[0], "application/json");
    const j = (await r.json()) as { status: string; jobs: number; activeJobs: number };
    assert.equal(j.status, "ok");
    assert.equal(typeof j.jobs, "number");
    assert.equal(typeof j.activeJobs, "number");
  } finally {
    await s.close();
  }
});

test("POST /api/generate rejects empty idea (400 JSON)", async () => {
  const s = await startServer();
  try {
    const r = await POST_JSON(s.port, JSON.stringify({}));
    assert.equal(r.status, 400);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
    const j = (await r.json()) as { error: string };
    assert.match(j.error, /idea is required/);
  } finally {
    await s.close();
  }
});

test("POST /api/generate rejects malformed JSON (400 JSON, not HTML)", async () => {
  const s = await startServer();
  try {
    const r = await POST_JSON(s.port, "{not valid json");
    assert.equal(r.status, 400);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
    const j = (await r.json()) as { error: string };
    assert.match(j.error, /Invalid JSON/);
  } finally {
    await s.close();
  }
});

test("POST /api/generate rejects oversized body (413 JSON, not HTML)", async () => {
  const s = await startServer();
  try {
    // 32KB limit; send 64KB.
    const big = "x".repeat(64 * 1024);
    const r = await POST_JSON(s.port, JSON.stringify({ idea: big }));
    assert.equal(r.status, 413);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
    const j = (await r.json()) as { error: string };
    assert.match(j.error, /too large/i);
  } finally {
    await s.close();
  }
});

test("unknown /api/* returns 404 JSON", async () => {
  const s = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/garbage`);
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
    const j = (await r.json()) as { error: string };
    assert.equal(j.error, "not found");
  } finally {
    await s.close();
  }
});

test("GET /api/events/:id returns 404 JSON for unknown job", async () => {
  const s = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/events/not-a-real-job`);
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
  } finally {
    await s.close();
  }
});

test("active job limit (default 1): second concurrent POST returns 429 JSON", async () => {
  const stub = makeStub();
  const s = await startServer({ runGen: stub.runGen });
  try {
    const r1 = await POST_JSON(s.port, JSON.stringify({ idea: "first" }));
    assert.equal(r1.status, 200);
    // Second job should be rejected because the first is still pending.
    const r2 = await POST_JSON(s.port, JSON.stringify({ idea: "second" }));
    assert.equal(r2.status, 429);
    const j = (await r2.json()) as { error: string };
    assert.match(j.error, /already running/i);

    // Finish the first job; a third POST should now succeed.
    const first = stub.pending[0]!;
    first.emit({
      type: "done",
      outcome: {
        success: true,
        buildAttempts: 1,
        repairAttempts: 0,
        history: [],
        finalReason: "success",
        jarPath: "/tmp/x.jar",
      },
      summary: "ok",
      projectPath: "/tmp/proj",
    });
    first.resolve();

    const r3 = await POST_JSON(s.port, JSON.stringify({ idea: "third" }));
    assert.equal(r3.status, 200);

    // Cleanup the third job.
    stub.pending[1]!.emit({
      type: "error",
      error: "test cleanup",
    });
    stub.pending[1]!.resolve();
  } finally {
    await s.close();
  }
});

test("SSE replay: events emitted before the consumer connects are delivered", async () => {
  const stub = makeStub();
  const s = await startServer({ runGen: stub.runGen });
  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };

    // Emit a few events BEFORE the SSE consumer connects.
    const p = stub.pending[0]!;
    p.emit({ type: "phase", name: "spec", message: "Creating spec" });
    p.emit({
      type: "preflight",
      result: {
        ok: true,
        java: { found: true, version: 17 },
        gradle: { found: true, version: "8.8", major: 8 },
        problems: [],
        hints: [],
      },
    });
    p.emit({ type: "done", outcome: {
      success: true, buildAttempts: 1, repairAttempts: 0, history: [], finalReason: "success",
    }, summary: "ok", projectPath: "/tmp/proj" });
    p.resolve();

    const events = await readSseToCompletion(`http://127.0.0.1:${s.port}/api/events/${jobId}`);
    const types = events.map((e) => e.type);
    assert.deepEqual(types, ["phase", "preflight", "done"]);
  } finally {
    await s.close();
  }
});

test("preview: serves an allowlisted PNG by jobId + index", async () => {
  const stub = makeStub();
  const s = await startServer({ runGen: stub.runGen });
  // Set up a real on-disk project with a real PNG.
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-preview-"));
  const pngRel = "src/main/resources/assets/demo/textures/item/foo.png";
  const pngAbs = path.join(tmp, pngRel);
  await fs.mkdir(path.dirname(pngAbs), { recursive: true });
  // Encode a real 1x1 PNG using the project's encoder.
  const { encodePng } = await import("../src/textures/png.js");
  const rgba = new Uint8Array([255, 0, 0, 255]);
  const pngBuf = encodePng(1, 1, rgba);
  await fs.writeFile(pngAbs, pngBuf);

  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };
    const p = stub.pending[0]!;
    p.emit({ type: "workspace", projectPath: tmp });
    p.emit({ type: "codegen:done", written: [pngRel], source: "templates" });

    const got = await fetch(`http://127.0.0.1:${s.port}/api/preview/${jobId}/0`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), "image/png");
    const body = Buffer.from(await got.arrayBuffer());
    assert.deepEqual(body, pngBuf);

    // Cleanup the job so the active limit doesn't bleed into subsequent tests.
    p.emit({
      type: "done",
      outcome: { success: true, buildAttempts: 1, repairAttempts: 0, history: [], finalReason: "success" },
      summary: "ok", projectPath: tmp,
    });
    p.resolve();
  } finally {
    await s.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("preview: 404 for unknown job, out-of-range index, and bad index format", async () => {
  const s = await startServer();
  try {
    let r = await fetch(`http://127.0.0.1:${s.port}/api/preview/no-such-job/0`);
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);

    // Start a real job (no PNGs registered) so we have a valid jobId.
    const stub = makeStub();
    await s.close();
    const s2 = await startServer({ runGen: stub.runGen });
    try {
      const post = await POST_JSON(s2.port, JSON.stringify({ idea: "x" }));
      const { jobId } = (await post.json()) as { jobId: string };
      // No workspace event yet.
      r = await fetch(`http://127.0.0.1:${s2.port}/api/preview/${jobId}/0`);
      assert.equal(r.status, 404);
      const j = (await r.json()) as { error: string };
      assert.match(j.error, /no project workspace/);

      // Set workspace + empty codegen list. Index 0 is out of range.
      const p = stub.pending[0]!;
      p.emit({ type: "workspace", projectPath: "/tmp" });
      p.emit({ type: "codegen:done", written: [], source: "templates" });
      r = await fetch(`http://127.0.0.1:${s2.port}/api/preview/${jobId}/0`);
      assert.equal(r.status, 404);

      // Bad index format.
      r = await fetch(`http://127.0.0.1:${s2.port}/api/preview/${jobId}/abc`);
      assert.equal(r.status, 400);

      p.emit({ type: "error", error: "test cleanup" });
      p.resolve();
    } finally {
      await s2.close();
    }
  } catch (e) {
    await s.close().catch(() => {});
    throw e;
  }
});

test("preview: cannot smuggle a non-PNG path through codegen:done", async () => {
  const stub = makeStub();
  const s = await startServer({ runGen: stub.runGen });
  try {
    const post = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await post.json()) as { jobId: string };
    const p = stub.pending[0]!;
    p.emit({ type: "workspace", projectPath: "/tmp" });
    // Simulate a malformed event: pngFiles only retains .png entries via the
    // server-side filter, so a .java path is dropped before it could ever be
    // exposed by the preview endpoint.
    p.emit({
      type: "codegen:done",
      written: ["src/main/java/com/x/X.java", "secret.env"],
      source: "templates",
    });
    // Index 0 must be out-of-range because pngFiles is empty.
    const r = await fetch(`http://127.0.0.1:${s.port}/api/preview/${jobId}/0`);
    assert.equal(r.status, 404);

    p.emit({ type: "error", error: "test cleanup" });
    p.resolve();
  } finally {
    await s.close();
  }
});

test("download: serves the jar for a completed job with proper headers", async () => {
  const stub = makeStub();
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-dl-"));
  const jarRel = "build/libs/demo_mod-1.0.0.jar";
  const jarAbs = path.join(tmp, jarRel);
  await fs.mkdir(path.dirname(jarAbs), { recursive: true });
  const jarBytes = Buffer.from("PK\x03\x04 fake jar bytes for test");
  await fs.writeFile(jarAbs, jarBytes);

  const s = await startServer({ runGen: stub.runGen });
  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };
    const p = stub.pending[0]!;
    p.emit({ type: "workspace", projectPath: tmp });
    p.emit({ type: "codegen:done", written: [], source: "templates" });
    p.emit({
      type: "done",
      outcome: { success: true, buildAttempts: 1, repairAttempts: 0, history: [], finalReason: "success", jarPath: jarAbs },
      summary: "ok",
      projectPath: tmp,
    });
    p.resolve();

    const got = await fetch(`http://127.0.0.1:${s.port}/api/download/${jobId}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), "application/java-archive");
    assert.match(got.headers.get("content-disposition") ?? "", /attachment; filename="demo_mod-1\.0\.0\.jar"/);
    assert.equal(got.headers.get("x-content-type-options"), "nosniff");
    const body = Buffer.from(await got.arrayBuffer());
    assert.deepEqual(body, jarBytes);
  } finally {
    await s.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("download: 404 for unknown job", async () => {
  const s = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/download/no-such-job`);
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
  } finally {
    await s.close();
  }
});

test("download: 404 for completed job with no jar artifact (failed build)", async () => {
  const stub = makeStub();
  const s = await startServer({ runGen: stub.runGen });
  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };
    const p = stub.pending[0]!;
    p.emit({ type: "workspace", projectPath: "/tmp" });
    p.emit({ type: "codegen:done", written: [], source: "templates" });
    p.emit({
      type: "done",
      outcome: { success: false, buildAttempts: 1, repairAttempts: 0, history: [], finalReason: "build-failed" },
      summary: "fail",
      projectPath: "/tmp",
    });
    p.resolve();

    const got = await fetch(`http://127.0.0.1:${s.port}/api/download/${jobId}`);
    assert.equal(got.status, 404);
    const j = (await got.json()) as { error: string };
    assert.match(j.error, /no jar artifact/);
  } finally {
    await s.close();
  }
});

test("download: 403 if recorded jarPath escapes the project workspace", async () => {
  const stub = makeStub();
  const s = await startServer({ runGen: stub.runGen });
  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };
    const p = stub.pending[0]!;
    p.emit({ type: "workspace", projectPath: "/tmp/some-project" });
    p.emit({
      type: "done",
      outcome: { success: true, buildAttempts: 1, repairAttempts: 0, history: [], finalReason: "success", jarPath: "/etc/passwd" },
      summary: "ok",
      projectPath: "/tmp/some-project",
    });
    p.resolve();

    const got = await fetch(`http://127.0.0.1:${s.port}/api/download/${jobId}`);
    assert.equal(got.status, 403);
    const j = (await got.json()) as { error: string };
    assert.match(j.error, /outside.*workspace/);
  } finally {
    await s.close();
  }
});

test("download: 409 if job is not yet complete", async () => {
  const stub = makeStub();
  const s = await startServer({ runGen: stub.runGen });
  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };
    const got = await fetch(`http://127.0.0.1:${s.port}/api/download/${jobId}`);
    assert.equal(got.status, 409);
    // Cleanup pending job.
    stub.pending[0]!.emit({ type: "error", error: "test cleanup" });
    stub.pending[0]!.resolve();
  } finally {
    await s.close();
  }
});

test("open/reveal: use stub opener, succeed for completed job, refuse outside workspace", async () => {
  const stub = makeStub();
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-op-"));
  const jarRel = "build/libs/x.jar";
  const jarAbs = path.join(tmp, jarRel);
  await fs.mkdir(path.dirname(jarAbs), { recursive: true });
  await fs.writeFile(jarAbs, Buffer.from("x"));

  const calls: Array<{ p: string; mode: string }> = [];
  const opener = async (p: string, mode: string) => {
    calls.push({ p, mode });
  };

  const s = await startServer({ runGen: stub.runGen, openInFinder: opener });
  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };
    const p = stub.pending[0]!;
    p.emit({ type: "workspace", projectPath: tmp });
    p.emit({
      type: "done",
      outcome: { success: true, buildAttempts: 1, repairAttempts: 0, history: [], finalReason: "success", jarPath: jarAbs },
      summary: "ok",
      projectPath: tmp,
    });
    p.resolve();

    // open project folder
    let r2 = await fetch(`http://127.0.0.1:${s.port}/api/open/${jobId}`, { method: "POST" });
    assert.equal(r2.status, 200);
    // reveal jar
    r2 = await fetch(`http://127.0.0.1:${s.port}/api/reveal/${jobId}`, { method: "POST" });
    assert.equal(r2.status, 200);

    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.p, tmp);
    assert.equal(calls[0]!.mode, "folder");
    assert.equal(calls[1]!.p, jarAbs);
    assert.equal(calls[1]!.mode, "reveal");

    // unknown job
    const r3 = await fetch(`http://127.0.0.1:${s.port}/api/open/nope`, { method: "POST" });
    assert.equal(r3.status, 404);
    const r4 = await fetch(`http://127.0.0.1:${s.port}/api/reveal/nope`, { method: "POST" });
    assert.equal(r4.status, 404);
  } finally {
    await s.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("open: 409 if job not yet complete", async () => {
  const stub = makeStub();
  const opener = async () => { /* should never be called */ };
  const s = await startServer({ runGen: stub.runGen, openInFinder: opener });
  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };
    const got = await fetch(`http://127.0.0.1:${s.port}/api/open/${jobId}`, { method: "POST" });
    assert.equal(got.status, 409);
    stub.pending[0]!.emit({ type: "error", error: "test cleanup" });
    stub.pending[0]!.resolve();
  } finally {
    await s.close();
  }
});

test("reveal: 403 if recorded jarPath escapes workspace", async () => {
  const stub = makeStub();
  const opener = async () => { /* should never be called */ };
  const s = await startServer({ runGen: stub.runGen, openInFinder: opener });
  try {
    const r = await POST_JSON(s.port, JSON.stringify({ idea: "x" }));
    const { jobId } = (await r.json()) as { jobId: string };
    const p = stub.pending[0]!;
    p.emit({ type: "workspace", projectPath: "/tmp/some-project" });
    p.emit({
      type: "done",
      outcome: { success: true, buildAttempts: 1, repairAttempts: 0, history: [], finalReason: "success", jarPath: "/etc/passwd" },
      summary: "ok",
      projectPath: "/tmp/some-project",
    });
    p.resolve();
    const got = await fetch(`http://127.0.0.1:${s.port}/api/reveal/${jobId}`, { method: "POST" });
    assert.equal(got.status, 403);
  } finally {
    await s.close();
  }
});

test("local helpers do not accept any client-supplied path (URL params are jobId only)", async () => {
  // Sanity: even a path-shaped jobId is treated as a job id and returns 404.
  const s = await startServer();
  try {
    const r1 = await fetch(`http://127.0.0.1:${s.port}/api/download/${encodeURIComponent("../../etc/passwd")}`);
    assert.equal(r1.status, 404);
    const r2 = await fetch(`http://127.0.0.1:${s.port}/api/open/${encodeURIComponent("/etc")}`, { method: "POST" });
    assert.equal(r2.status, 404);
    const r3 = await fetch(`http://127.0.0.1:${s.port}/api/reveal/${encodeURIComponent("/etc/passwd")}`, { method: "POST" });
    assert.equal(r3.status, 404);
  } finally {
    await s.close();
  }
});

test("/api/health advertises every helper endpoint capability", async () => {
  const s = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/health`);
    const j = (await r.json()) as { capabilities?: string[] };
    assert.ok(Array.isArray(j.capabilities), "capabilities array required");
    for (const cap of ["health", "generate", "events", "preview", "open", "reveal", "download"]) {
      assert.ok(j.capabilities!.includes(cap), `capability "${cap}" must be advertised`);
    }
  } finally {
    await s.close();
  }
});

test("end-to-end: jobId from /api/generate is the EXACT id accepted by /download, /reveal, /open", async () => {
  // Reproduces the user-reported workflow: POST /api/generate, take the
  // returned jobId verbatim, drive a successful generation through events,
  // then call all three helper endpoints with that same id and verify each
  // returns 200 / 200 / 200.
  const stub = makeStub();
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "modforge-e2e-"));
  const jarRel = "build/libs/black_crystal_diamond-1.0.0.jar";
  const jarAbs = path.join(tmp, jarRel);
  await fs.mkdir(path.dirname(jarAbs), { recursive: true });
  await fs.writeFile(jarAbs, Buffer.from("PK\x03\x04 jar bytes"));

  const opens: Array<{ p: string; mode: string }> = [];
  const opener = async (p: string, mode: string) => { opens.push({ p, mode }); };

  const s = await startServer({ runGen: stub.runGen, openInFinder: opener });
  try {
    // Step 1: generate.
    const gen = await POST_JSON(s.port, JSON.stringify({ idea: "test e2e" }));
    assert.equal(gen.status, 200);
    const { jobId } = (await gen.json()) as { jobId: string };
    assert.ok(typeof jobId === "string" && jobId.length > 0, "must return a non-empty jobId");

    // Step 2: simulate the engine producing a successful build.
    const p = stub.pending[0]!;
    p.emit({ type: "workspace", projectPath: tmp });
    p.emit({ type: "codegen:done", written: [], source: "templates" });
    p.emit({
      type: "done",
      outcome: {
        success: true,
        buildAttempts: 1,
        repairAttempts: 0,
        history: [],
        finalReason: "success",
        jarPath: jarAbs,
      },
      summary: "ok",
      projectPath: tmp,
    });
    p.resolve();

    // Step 3: hit all three helpers with the SAME jobId.
    const dl = await fetch(`http://127.0.0.1:${s.port}/api/download/${encodeURIComponent(jobId)}`);
    assert.equal(dl.status, 200, `download must accept the jobId from /api/generate (got ${dl.status})`);
    assert.match(dl.headers.get("content-disposition") ?? "", /black_crystal_diamond-1\.0\.0\.jar/);

    const rev = await fetch(`http://127.0.0.1:${s.port}/api/reveal/${encodeURIComponent(jobId)}`, { method: "POST" });
    assert.equal(rev.status, 200, `reveal must accept the jobId from /api/generate (got ${rev.status})`);

    const op = await fetch(`http://127.0.0.1:${s.port}/api/open/${encodeURIComponent(jobId)}`, { method: "POST" });
    assert.equal(op.status, 200, `open must accept the jobId from /api/generate (got ${op.status})`);

    // The opener must have been called with exactly the recorded paths.
    assert.equal(opens.length, 2);
    assert.deepEqual(opens.find((o) => o.mode === "folder")?.p, tmp);
    assert.deepEqual(opens.find((o) => o.mode === "reveal")?.p, jarAbs);
  } finally {
    await s.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("response headers include nosniff + CSP", async () => {
  const s = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/health`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    const csp = r.headers.get("content-security-policy");
    assert.ok(csp, "CSP header must be present");
    assert.match(csp!, /default-src 'self'/);
    assert.match(csp!, /frame-ancestors 'none'/);
  } finally {
    await s.close();
  }
});

// ---------- helpers ----------

async function readSseToCompletion(url: string): Promise<Array<{ type: string }>> {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Array<{ type: string }> = [];
  // Bound how long we read so a buggy stream doesn't hang the test.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("data: ")) {
          try { events.push(JSON.parse(line.slice(6))); }
          catch { /* */ }
        }
      }
    }
  }
  return events;
}

// Avoid unused import warnings (used to suppress lint when tsc strict is on).
void Buffer;
