import { test } from "node:test";
import assert from "node:assert/strict";
import { rejectBinaryRepairPaths } from "../src/agent/repairBuild.js";

test("rejectBinaryRepairPaths: throws on .png writes from repair", () => {
  assert.throws(
    () =>
      rejectBinaryRepairPaths([
        { path: "src/main/resources/assets/demo/textures/item/foo.png", content: "data" },
      ]),
    /binary file via text content/,
  );
});

test("rejectBinaryRepairPaths: throws on every documented binary extension", () => {
  for (const ext of [
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".ogg", ".wav", ".jar", ".class", ".zip",
  ]) {
    assert.throws(
      () =>
        rejectBinaryRepairPaths([
          { path: `src/main/resources/x${ext}`, content: "x" },
        ]),
      /binary file via text content/,
      `expected rejection for ${ext}`,
    );
  }
});

test("rejectBinaryRepairPaths: matches case-insensitively", () => {
  assert.throws(
    () => rejectBinaryRepairPaths([{ path: "x/Y.PNG", content: "x" }]),
    /binary file via text content/,
  );
});

test("rejectBinaryRepairPaths: allows text files (java, json, mcmeta)", () => {
  rejectBinaryRepairPaths([
    { path: "src/main/java/com/x/Foo.java", content: "package com.x;" },
    { path: "src/main/resources/assets/demo/lang/en_us.json", content: "{}" },
    { path: "src/main/resources/pack.mcmeta", content: "{}" },
  ]);
  // No throw -> pass.
  assert.ok(true);
});
