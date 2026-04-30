import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeWriteFiles } from "../src/workspace/safeWrite.js";

async function tmpProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "modforge-test-"));
}

test("safeWriteFiles rejects fabric.mod.json (anywhere)", async () => {
  const dir = await tmpProject();
  await assert.rejects(
    () =>
      safeWriteFiles(dir, [
        { path: "src/main/resources/fabric.mod.json", content: "{}" },
      ]),
    /fabric\.mod\.json.*scaffolder owns it/,
  );
  // Even outside the standard resources path, fabric.mod.json is denied by basename.
  await assert.rejects(
    () =>
      safeWriteFiles(dir, [
        { path: "src/main/java/fabric.mod.json", content: "{}" },
      ]),
    /fabric\.mod\.json/,
  );
  await fs.rm(dir, { recursive: true });
});

test("safeWriteFiles rejects build.gradle / settings.gradle / gradle.properties", async () => {
  const dir = await tmpProject();
  for (const p of ["build.gradle", "settings.gradle", "gradle.properties"]) {
    await assert.rejects(
      () => safeWriteFiles(dir, [{ path: p, content: "x" }]),
      /not writable by the LLM|outside the allowlist/,
      `expected rejection for ${p}`,
    );
    await assert.rejects(
      () => safeWriteFiles(dir, [{ path: `src/main/java/${p}`, content: "x" }]),
      /not writable by the LLM/,
      `expected rejection for nested ${p}`,
    );
  }
  await fs.rm(dir, { recursive: true });
});

test("safeWriteFiles rejects package.json / tsconfig.json / .env", async () => {
  const dir = await tmpProject();
  for (const p of ["package.json", "tsconfig.json", ".env"]) {
    await assert.rejects(
      () => safeWriteFiles(dir, [{ path: `src/main/resources/${p}`, content: "x" }]),
      /not writable by the LLM/,
    );
  }
  await fs.rm(dir, { recursive: true });
});

test("safeWriteFiles rejects path traversal and absolute paths", async () => {
  const dir = await tmpProject();
  await assert.rejects(
    () => safeWriteFiles(dir, [{ path: "/etc/passwd", content: "x" }]),
    /absolute paths are not allowed/,
  );
  await assert.rejects(
    () => safeWriteFiles(dir, [{ path: "../escape.txt", content: "x" }]),
    /traversal/,
  );
  await assert.rejects(
    () => safeWriteFiles(dir, [{ path: "src/main/java/../../etc/x", content: "x" }]),
    /traversal/,
  );
  await fs.rm(dir, { recursive: true });
});

test("safeWriteFiles rejects duplicate normalized output paths in a batch", async () => {
  const dir = await tmpProject();
  await assert.rejects(
    () =>
      safeWriteFiles(dir, [
        { path: "src/main/java/com/x/X.java", content: "package com.x;" },
        { path: "src/main/java/com/x/X.java", content: "package com.x; // dupe" },
      ]),
    /Duplicate output path/,
  );
  // Backslash-to-forward-slash normalization: same logical path, dedup catches it.
  await assert.rejects(
    () =>
      safeWriteFiles(dir, [
        { path: "src/main/java/com/x/X.java", content: "x" },
        { path: "src\\main\\java\\com\\x\\X.java", content: "x" },
      ]),
    /Duplicate output path/,
  );
  await fs.rm(dir, { recursive: true });
});

test("safeWriteFiles accepts allowlisted Java + resources paths", async () => {
  const dir = await tmpProject();
  const result = await safeWriteFiles(dir, [
    { path: "src/main/java/com/x/X.java", content: "package com.x; class X{}" },
    { path: "src/main/resources/assets/x/lang/en_us.json", content: "{}" },
  ]);
  assert.equal(result.written.length, 2);
  // Verify on disk.
  const javaContent = await fs.readFile(
    path.join(dir, "src/main/java/com/x/X.java"),
    "utf8",
  );
  assert.match(javaContent, /class X/);
  await fs.rm(dir, { recursive: true });
});
