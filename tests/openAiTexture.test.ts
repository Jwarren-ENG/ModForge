import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  aiTexturesEnabled,
  buildPromptForFeature,
  generateAiTexture,
  pixelCleanIcon,
  postProcessAiImage,
  precomputeAiTextures,
  setAiTextureProvider,
  type AiTextureProvider,
} from "../src/textures/openAiTexture.js";
import { encodePng } from "../src/textures/png.js";
import { decodePng } from "../src/textures/pngDecode.js";
import type { ModSpec } from "../src/types.js";

function withEnv<T>(
  vars: Record<string, string | undefined>,
  body: () => T,
): T {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return body();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withEnvAsync<T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await body();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Build a fake provider PNG with a recognizable silhouette. */
function syntheticPng(
  width: number,
  height: number,
  alphaOf: (x: number, y: number) => number,
  rgbOf: (x: number, y: number) => [number, number, number] = () => [200, 100, 50],
): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = rgbOf(x, y);
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
      rgba[i + 3] = alphaOf(x, y);
    }
  }
  return encodePng(width, height, rgba);
}

const baseSpec: ModSpec = {
  modId: "demo",
  modName: "Demo",
  modVersion: "1.0.0",
  mcVersion: "1.20.1",
  modLoader: "fabric",
  packageName: "com.modforge.demo",
  mainClass: "DemoMod",
  description: "",
  features: [],
  filesToCreate: [],
  limitations: [],
  assumptions: [],
} as ModSpec;

// =====================================================================
// Env-var gating
// =====================================================================

test("aiTexturesEnabled: false unless BOTH OPENAI_API_KEY and MODFORGE_AI_TEXTURES=1 are set", () => {
  withEnv({ OPENAI_API_KEY: undefined, MODFORGE_AI_TEXTURES: undefined }, () => {
    assert.equal(aiTexturesEnabled(), false);
  });
  withEnv({ OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: undefined }, () => {
    assert.equal(aiTexturesEnabled(), false);
  });
  withEnv({ OPENAI_API_KEY: undefined, MODFORGE_AI_TEXTURES: "1" }, () => {
    assert.equal(aiTexturesEnabled(), false);
  });
  withEnv({ OPENAI_API_KEY: "", MODFORGE_AI_TEXTURES: "1" }, () => {
    assert.equal(aiTexturesEnabled(), false);
  });
  withEnv({ OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" }, () => {
    assert.equal(aiTexturesEnabled(), true);
  });
});

test("generateAiTexture: returns null when env vars are off (provider never invoked)", async () => {
  let called = 0;
  setAiTextureProvider(async () => { called++; return Buffer.from([]); });
  try {
    const got = await withEnvAsync(
      { OPENAI_API_KEY: undefined, MODFORGE_AI_TEXTURES: undefined },
      () => generateAiTexture("anything"),
    );
    assert.equal(got, null);
    assert.equal(called, 0, "provider must not be called when AI is disabled");
  } finally {
    setAiTextureProvider(null);
  }
});

test("generateAiTexture: returns 16x16 PNG when provider yields a valid larger image", async () => {
  // 32x32 with a centered diamond silhouette of opaque pixels.
  const provided = syntheticPng(
    32,
    32,
    (x, y) => (Math.abs(x - 16) + Math.abs(y - 16) <= 9 ? 255 : 0),
  );
  setAiTextureProvider(async () => provided);
  try {
    const out = await withEnvAsync(
      { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" },
      () => generateAiTexture("test prompt"),
    );
    assert.ok(out, "should return PNG bytes");
    const dec = decodePng(out!);
    assert.equal(dec.width, 16);
    assert.equal(dec.height, 16);
    assert.equal(dec.rgba.length, 16 * 16 * 4);
    let opaque = 0;
    for (let i = 3; i < dec.rgba.length; i += 4) if (dec.rgba[i]! >= 16) opaque++;
    assert.ok(opaque > 0 && opaque < 256, `unexpected opacity ${opaque}/256`);
  } finally {
    setAiTextureProvider(null);
  }
});

test("postProcessAiImage: rejects empty / fully-transparent images with a reason", () => {
  const empty = syntheticPng(16, 16, () => 0);
  const r = postProcessAiImage(empty);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /empty/);
});

test("postProcessAiImage: rejects full-square fills with a reason", () => {
  const fullBlock = syntheticPng(16, 16, () => 255);
  const r = postProcessAiImage(fullBlock);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /full square/);
});

test("postProcessAiImage: chroma-keys solid background when no alpha is provided", () => {
  // 16x16 with a centered red dot on a uniform white background, no alpha < 255.
  const buf = syntheticPng(
    16,
    16,
    () => 255,
    (x, y) => (Math.abs(x - 8) <= 2 && Math.abs(y - 8) <= 2 ? [200, 30, 30] : [255, 255, 255]),
  );
  const r = postProcessAiImage(buf);
  assert.ok(r.ok, "valid icon should survive post-processing");
  if (!r.ok) return;
  const dec = decodePng(r.png);
  // Corner pixels were white; chroma-key must have made them transparent.
  assert.equal(dec.rgba[3], 0, "(0,0) corner should be transparent after chroma-key");
  // Center pixel was red; alpha must remain ~255.
  const cx = 8, cy = 8;
  const ci = (cy * 16 + cx) * 4;
  assert.equal(dec.rgba[ci + 3], 255, "center red pixel should remain opaque");
});

test("postProcessAiImage: rejects garbage bytes (not a PNG) with a decode reason", () => {
  const r = postProcessAiImage(Buffer.from("definitely not a png"));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /decode/i);
});

test("postProcessAiImage: pads non-square inputs and downsamples to 16x16", () => {
  // 64x32 wide rectangle with a smaller opaque blob.
  const rect = syntheticPng(64, 32, (x, y) =>
    Math.abs(x - 32) <= 8 && Math.abs(y - 16) <= 6 ? 255 : 0,
  );
  const r = postProcessAiImage(rect);
  assert.ok(r.ok, "non-square should be accepted via padding");
  if (!r.ok) return;
  const dec = decodePng(r.png);
  assert.equal(dec.width, 16);
  assert.equal(dec.height, 16);
});

// =====================================================================
// Provider plumbing — timeout / failure / abort
// =====================================================================

test("generateAiTexture: falls back to null when the provider throws", async () => {
  setAiTextureProvider(async () => { throw new Error("boom"); });
  try {
    const out = await withEnvAsync(
      { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" },
      () => generateAiTexture("p"),
    );
    assert.equal(out, null);
  } finally {
    setAiTextureProvider(null);
  }
});

test("generateAiTexture: falls back to null when the provider returns null", async () => {
  setAiTextureProvider(async () => null);
  try {
    const out = await withEnvAsync(
      { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" },
      () => generateAiTexture("p"),
    );
    assert.equal(out, null);
  } finally {
    setAiTextureProvider(null);
  }
});

test("generateAiTexture: signal is passed to the provider (timeout plumbing)", async () => {
  let captured: AbortSignal | null = null;
  const p: AiTextureProvider = async (_prompt, signal) => {
    captured = signal;
    return null;
  };
  setAiTextureProvider(p);
  try {
    await withEnvAsync(
      { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" },
      () => generateAiTexture("p"),
    );
    assert.ok(captured, "provider must receive an AbortSignal");
    assert.ok(typeof (captured as unknown as AbortSignal).aborted === "boolean");
  } finally {
    setAiTextureProvider(null);
  }
});

// =====================================================================
// Prompt construction (pure)
// =====================================================================

test("buildPromptForFeature: katana weapon emits the katana-specific prompt", () => {
  const p = buildPromptForFeature(baseSpec, {
    type: "weapon",
    id: "obsidian_katana",
    name: "Obsidian Katana",
    description: "",
    details: { weaponType: "katana" },
  } as never);
  assert.match(p, /katana/i);
  assert.match(p, /transparent background/i);
  assert.match(p, /no text/i);
  assert.match(p, /pixel art/i);
});

test("buildPromptForFeature: hammer/mace/club share the war-hammer prompt", () => {
  for (const wt of ["hammer", "mace", "club"] as const) {
    const p = buildPromptForFeature(baseSpec, {
      type: "weapon",
      id: "x",
      name: "X",
      description: "",
      details: { weaponType: wt },
    } as never);
    assert.match(p, /war hammer/i, `weaponType=${wt} should map to war hammer prompt`);
  }
});

test("buildPromptForFeature: generic item folds in name/description/style/colors", () => {
  const p = buildPromptForFeature(baseSpec, {
    type: "item",
    id: "lava_shard",
    name: "Lava Shard",
    description: "A glowing crystalline shard.",
    details: { textureStyle: "crystal", textureColor: "#ff4500", secondaryColor: "#3a1f0f" },
  } as never);
  assert.match(p, /Lava Shard/);
  assert.match(p, /glowing crystalline/);
  assert.match(p, /Style: crystal/);
  assert.match(p, /#ff4500/);
  assert.match(p, /#3a1f0f/);
});

// =====================================================================
// precomputeAiTextures — only custom item/weapon/tool, never retexture_*
// =====================================================================

test("precomputeAiTextures: never invokes the provider when AI is disabled", async () => {
  let calls = 0;
  setAiTextureProvider(async () => { calls++; return null; });
  try {
    const spec: ModSpec = {
      ...baseSpec,
      features: [
        { type: "weapon", id: "k", name: "K", description: "", details: { weaponType: "katana" } },
      ],
    } as never;
    const got = await withEnvAsync(
      { OPENAI_API_KEY: undefined, MODFORGE_AI_TEXTURES: undefined },
      () => precomputeAiTextures(spec),
    );
    assert.equal(calls, 0);
    assert.equal(got.textures.size, 0);
    assert.equal(got.failures.length, 0);
  } finally {
    setAiTextureProvider(null);
  }
});

test("precomputeAiTextures: vanilla retexture features NEVER invoke the AI provider", async () => {
  let calls = 0;
  setAiTextureProvider(async () => { calls++; return syntheticPng(16, 16, (x, y) => (Math.abs(x - 8) + Math.abs(y - 8) <= 6 ? 255 : 0)); });
  try {
    const spec: ModSpec = {
      ...baseSpec,
      features: [
        { type: "retexture_item", id: "r1", name: "R1", description: "",
          details: { vanillaTarget: "minecraft:wooden_sword", textureStyle: "metal", textureColor: "#ff0000" } },
        { type: "retexture_block", id: "r2", name: "R2", description: "",
          details: { vanillaTarget: "minecraft:diamond_ore", textureStyle: "stone", textureColor: "#5a008a" } },
        { type: "recipe", id: "r3", name: "R3", description: "",
          details: { shape: "shaped", result: { itemId: "demo:x", count: 1 }, pattern: ["X"], key: { X: "minecraft:stick" } } },
      ],
    } as never;
    const got = await withEnvAsync(
      { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" },
      () => precomputeAiTextures(spec),
    );
    assert.equal(calls, 0, "AI provider must not be called for retexture/non-item features");
    assert.equal(got.textures.size, 0);
  } finally {
    setAiTextureProvider(null);
  }
});

test("precomputeAiTextures: invokes provider for item/weapon/tool features and returns map keyed by id", async () => {
  let calls = 0;
  const lastPrompts: string[] = [];
  setAiTextureProvider(async (prompt) => {
    calls++;
    lastPrompts.push(prompt);
    return syntheticPng(16, 16, (x, y) => (Math.abs(x - 8) + Math.abs(y - 8) <= 6 ? 255 : 0));
  });
  try {
    const spec: ModSpec = {
      ...baseSpec,
      features: [
        { type: "item", id: "a", name: "A", description: "", details: {} },
        { type: "weapon", id: "b", name: "B", description: "", details: { weaponType: "katana" } },
        { type: "tool", id: "c", name: "C", description: "", details: { weaponType: "pickaxe" } },
        // Block — explicitly skipped.
        { type: "block", id: "d", name: "D", description: "", details: {} },
      ],
    } as never;
    const got = await withEnvAsync(
      { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" },
      () => precomputeAiTextures(spec),
    );
    assert.equal(calls, 3);
    assert.ok(got.textures.has("a"));
    assert.ok(got.textures.has("b"));
    assert.ok(got.textures.has("c"));
    assert.ok(!got.textures.has("d"), "block features must NOT receive an AI texture");
    assert.match(lastPrompts.find((p) => /katana/i.test(p))!, /katana/i);
  } finally {
    setAiTextureProvider(null);
  }
});

test("precomputeAiTextures: invalid AI image lands in failures with id + safe reason", async () => {
  setAiTextureProvider(async () => Buffer.from("not a png"));
  try {
    const spec: ModSpec = {
      ...baseSpec,
      features: [
        { type: "weapon", id: "k", name: "K", description: "", details: { weaponType: "katana" } },
      ],
    } as never;
    const got = await withEnvAsync(
      { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" },
      () => precomputeAiTextures(spec),
    );
    assert.equal(got.textures.size, 0);
    assert.equal(got.failures.length, 1);
    assert.equal(got.failures[0]!.id, "k");
    assert.match(got.failures[0]!.reason, /decode/i, `expected a decode-failure reason, got: ${got.failures[0]!.reason}`);
  } finally {
    setAiTextureProvider(null);
  }
});

// =====================================================================
// Generator integration — AI bytes land at the hardcoded path
// =====================================================================

test("generateItem: uses AI texture bytes verbatim when supplied (path is generator-controlled)", async () => {
  const { generateItem } = await import("../src/generators/item.js");
  const aiBytes = syntheticPng(16, 16, (x, y) => (Math.abs(x - 8) + Math.abs(y - 8) <= 6 ? 255 : 0));
  const c = generateItem(
    baseSpec,
    {
      type: "item",
      id: "lava_shard",
      name: "Lava Shard",
      description: "",
      details: { textureColor: "#ff4500" },
    } as never,
    aiBytes,
  );
  const png = c.resources.find((r) => r.path.endsWith("/textures/item/lava_shard.png"));
  assert.ok(png, "PNG must be written at the hardcoded item texture path");
  assert.equal(png!.path, "src/main/resources/assets/demo/textures/item/lava_shard.png");
  // Same byte contents — AI buffer used unchanged, not re-painted.
  assert.deepEqual(png!.content, aiBytes);
});

test("generateToolOrWeapon: uses AI texture bytes when supplied (katana scenario)", async () => {
  const { generateToolOrWeapon } = await import("../src/generators/toolWeapon.js");
  const aiBytes = syntheticPng(16, 16, (x, y) => (x + y > 4 && x + y < 22 ? 255 : 0));
  const c = generateToolOrWeapon(
    baseSpec,
    {
      type: "weapon",
      id: "obsidian_katana",
      name: "Obsidian Katana",
      description: "",
      details: { weaponType: "katana", textureColor: "#1a1a26" },
    } as never,
    aiBytes,
  );
  const png = c.resources.find((r) => r.path.endsWith("/textures/item/obsidian_katana.png"));
  assert.ok(png, "katana PNG must be written");
  assert.deepEqual(png!.content, aiBytes);
});

test("generateItem: omitted AI texture falls back to deterministic procedural (env-off behavior)", async () => {
  const { generateItem } = await import("../src/generators/item.js");
  const a = generateItem(
    baseSpec,
    { type: "item", id: "x", name: "X", description: "", details: { textureColor: "#aabbcc" } } as never,
  );
  const b = generateItem(
    baseSpec,
    { type: "item", id: "x", name: "X", description: "", details: { textureColor: "#aabbcc" } } as never,
  );
  const pa = a.resources.find((r) => r.path.endsWith(".png"));
  const pb = b.resources.find((r) => r.path.endsWith(".png"));
  assert.ok(pa && pb);
  assert.deepEqual(pa!.content, pb!.content, "procedural texture must remain byte-deterministic");
});

// =====================================================================
// tryGenerateDeterministically — surfaces aiNotices and routes textures
// =====================================================================

test("tryGenerateDeterministically: aiNotices flow through to noticeMessages", async () => {
  const { tryGenerateDeterministically } = await import("../src/generators/index.js");
  const spec: ModSpec = {
    ...baseSpec,
    features: [
      { type: "item", id: "a", name: "A", description: "", details: { textureColor: "#aabbcc" } },
    ],
  } as never;
  const r = tryGenerateDeterministically(spec, {
    aiNotices: ["AI texture generation was attempted for a but failed: provider returned no image. Used deterministic fallback."],
  });
  assert.ok(r.fullyCovered);
  assert.ok(r.noticeMessages.some((m) => /attempted for a but failed/.test(m)));
});

// =====================================================================
// Debug logging — gated by MODFORGE_AI_DEBUG=1, never leaks the API key
// =====================================================================

/** Capture console.log lines emitted during `body()` and restore the original. */
async function captureLogs(body: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await body();
  } finally {
    // eslint-disable-next-line no-console
    console.log = orig;
  }
  return lines;
}

test("debug: with MODFORGE_AI_DEBUG=1, precompute logs enabled state and per-feature outcome", async () => {
  setAiTextureProvider(async () => syntheticPng(16, 16, (x, y) => (Math.abs(x - 8) + Math.abs(y - 8) <= 6 ? 255 : 0)));
  try {
    const spec: ModSpec = {
      ...baseSpec,
      features: [
        { type: "weapon", id: "obsidian_katana", name: "Obsidian Katana", description: "", details: { weaponType: "katana" } },
      ],
    } as never;
    const logs = await captureLogs(async () => {
      await withEnvAsync(
        { OPENAI_API_KEY: "sk-LIVE-do-not-leak", MODFORGE_AI_TEXTURES: "1", MODFORGE_AI_DEBUG: "1" },
        () => precomputeAiTextures(spec),
      );
    });
    const all = logs.join("\n");
    assert.match(all, /\[AI texture\] enabled: true/);
    assert.match(all, /\[AI texture\] feature considered: id="obsidian_katana"/);
    assert.match(all, /\[AI texture\] feature "obsidian_katana" eligible/);
    assert.match(all, /\[AI texture\] feature "obsidian_katana": post-processing accepted/);
    // Sanity: API key MUST NOT appear anywhere.
    assert.ok(!all.includes("sk-LIVE-do-not-leak"), "debug logs leaked the API key!");
  } finally {
    setAiTextureProvider(null);
  }
});

test("debug: failure path logs a safe rejection reason and never the API key", async () => {
  setAiTextureProvider(async () => Buffer.from("garbage"));
  try {
    const spec: ModSpec = {
      ...baseSpec,
      features: [
        { type: "weapon", id: "lava_katana", name: "Lava Katana", description: "", details: { weaponType: "katana" } },
      ],
    } as never;
    const logs = await captureLogs(async () => {
      await withEnvAsync(
        { OPENAI_API_KEY: "sk-secret-key-12345", MODFORGE_AI_TEXTURES: "1", MODFORGE_AI_DEBUG: "1" },
        () => precomputeAiTextures(spec),
      );
    });
    const all = logs.join("\n");
    assert.match(all, /\[AI texture\] post-processing rejected: PNG decode failed/);
    assert.match(all, /\[AI texture\] feature "lava_katana": .* — using deterministic fallback/);
    assert.ok(!all.includes("sk-secret-key-12345"), "debug logs leaked the API key!");
  } finally {
    setAiTextureProvider(null);
  }
});

test("debug: when AI is disabled, log a safe disabled reason (no key, no fingerprint)", async () => {
  const logs = await captureLogs(async () => {
    await withEnvAsync(
      { OPENAI_API_KEY: undefined, MODFORGE_AI_TEXTURES: "1", MODFORGE_AI_DEBUG: "1" },
      () => precomputeAiTextures({
        ...baseSpec,
        features: [{ type: "item", id: "x", name: "X", description: "", details: {} }],
      } as never),
    );
  });
  const all = logs.join("\n");
  assert.match(all, /\[AI texture\] enabled: false/);
  assert.match(all, /OPENAI_API_KEY is not set/);
});

test("debug: with MODFORGE_AI_DEBUG unset, no [AI texture] logs are emitted", async () => {
  setAiTextureProvider(async () => syntheticPng(16, 16, (x, y) => (Math.abs(x - 8) + Math.abs(y - 8) <= 6 ? 255 : 0)));
  try {
    const logs = await captureLogs(async () => {
      await withEnvAsync(
        { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1", MODFORGE_AI_DEBUG: undefined },
        () => precomputeAiTextures({
          ...baseSpec,
          features: [{ type: "weapon", id: "k", name: "K", description: "", details: { weaponType: "katana" } }],
        } as never),
      );
    });
    const aiLines = logs.filter((l) => l.includes("[AI texture]"));
    assert.deepEqual(aiLines, [], "no [AI texture] logs should be emitted when MODFORGE_AI_DEBUG is unset");
  } finally {
    setAiTextureProvider(null);
  }
});

test("debug: vanilla retexture features never produce [AI texture] feature-eligible logs", async () => {
  let providerCalls = 0;
  setAiTextureProvider(async () => { providerCalls++; return null; });
  try {
    const spec: ModSpec = {
      ...baseSpec,
      features: [
        { type: "retexture_item", id: "wooden_red", name: "Wooden Red", description: "",
          details: { vanillaTarget: "minecraft:wooden_sword", textureStyle: "metal", textureColor: "#cc1133" } },
        { type: "retexture_block", id: "diamond_purple", name: "Diamond Purple", description: "",
          details: { vanillaTarget: "minecraft:diamond_ore", textureStyle: "stone", textureColor: "#5a008a" } },
      ],
    } as never;
    const logs = await captureLogs(async () => {
      await withEnvAsync(
        { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1", MODFORGE_AI_DEBUG: "1" },
        () => precomputeAiTextures(spec),
      );
    });
    const all = logs.join("\n");
    // Considered logs may appear (the loop walks every feature) but neither
    // retexture feature should be marked eligible or send a prompt.
    assert.ok(!/\[AI texture\] feature "wooden_red" eligible/.test(all));
    assert.ok(!/\[AI texture\] feature "diamond_purple" eligible/.test(all));
    assert.match(all, /feature "wooden_red" skipped: type "retexture_item" is not eligible/);
    assert.match(all, /feature "diamond_purple" skipped: type "retexture_block" is not eligible/);
    assert.equal(providerCalls, 0, "provider must never run for retexture features");
  } finally {
    setAiTextureProvider(null);
  }
});

// =====================================================================
// Thin-weapon-friendly post-processing (Milestone 4.1-patch)
// =====================================================================

test("post-processing accepts thin diagonal katana with sparse opaque pixels spanning the canvas", () => {
  // 16x16 with a 1-px-thick diagonal stroke from (1,1) to (14,14) — 14 opaque
  // pixels, opaque count well under the old 16-pixel floor, but spans the full
  // canvas. Should be accepted under the new bbox-aware validation.
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 1; i <= 14; i++) {
    const idx = (i * W + i) * 4;
    rgba[idx] = 200; rgba[idx + 1] = 200; rgba[idx + 2] = 200; rgba[idx + 3] = 255;
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.ok(r.ok, !r.ok ? `unexpected reject: ${r.reason}` : "");
});

test("post-processing accepts a 12-opaque thin diagonal (lower bound for sparse-elongated)", () => {
  // 12 pixels along the upper-right corner diagonal. spanW = spanH = 12 → maxSpan = 12 ≥ 10.
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < 12; i++) {
    const idx = (i * W + (15 - i)) * 4;
    rgba[idx] = 80; rgba[idx + 1] = 80; rgba[idx + 2] = 80; rgba[idx + 3] = 255;
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.ok(r.ok, !r.ok ? `unexpected reject: ${r.reason}` : "");
});

test("post-processing rejects a tiny 3-pixel cluster (no spatial extent)", () => {
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (const [x, y] of [[8, 8], [9, 8], [8, 9]] as Array<[number, number]>) {
    const i = (y * W + x) * 4;
    rgba[i] = 200; rgba[i + 1] = 50; rgba[i + 2] = 50; rgba[i + 3] = 255;
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /too empty|too sparse/i);
});

test("post-processing rejects a 7-opaque cluster (under the 8-pixel floor)", () => {
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (const [x, y] of [[6, 6], [7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [7, 8]] as Array<[number, number]>) {
    const i = (y * W + x) * 4;
    rgba[i] = 200; rgba[i + 1] = 50; rgba[i + 2] = 50; rgba[i + 3] = 255;
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /too empty/i);
});

test("post-processing recovery: small centered subject in large canvas is rescued by bbox crop + scale", () => {
  // 64x64 image with an 8x8 opaque block at center. Without recovery this
  // would shrink to a ~2x2 patch and fail validation.
  const W = 64, H = 64;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 28; y <= 35; y++) {
    for (let x = 28; x <= 35; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = 50; rgba[i + 1] = 200; rgba[i + 2] = 50; rgba[i + 3] = 255;
    }
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.ok(r.ok, !r.ok ? `recovery should accept small centered subject: ${r.reason}` : "");
  if (!r.ok) return;
  const dec = decodePng(r.png);
  let opaque = 0;
  for (let i = 3; i < dec.rgba.length; i += 4) if (dec.rgba[i]! >= 16) opaque++;
  assert.ok(opaque >= 30, `recovery should restore opaque count, got ${opaque}`);
});

test("post-processing recovery: thin diagonal in a large canvas survives via max-alpha resample", () => {
  // 1024x1024 (mimicking real OpenAI output) with a thin 6-px-thick katana
  // running diagonally from (60,60) to (964,964). Nearest-neighbor at the
  // center of each 64x64 cell would miss most of the stroke; max-alpha
  // pooling preserves it.
  const W = 1024, H = 1024;
  const rgba = new Uint8Array(W * H * 4);
  for (let t = 0; t < 904; t++) {
    for (let dx = -3; dx <= 2; dx++) {
      for (let dy = -3; dy <= 2; dy++) {
        const x = 60 + t + dx;
        const y = 60 + t + dy;
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const i = (y * W + x) * 4;
        rgba[i] = 180; rgba[i + 1] = 180; rgba[i + 2] = 200; rgba[i + 3] = 255;
      }
    }
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.ok(r.ok, !r.ok ? `large-canvas thin diagonal should be accepted: ${r.reason}` : "");
});

test("post-processing still rejects a 16x16 full-square fill", () => {
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 100; rgba[i + 1] = 100; rgba[i + 2] = 100; rgba[i + 3] = 255;
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /full square|too empty/i);
});

test("post-processing still rejects an empty (all-transparent) image", () => {
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4); // all zeros → fully transparent
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.equal(r.ok, false);
});

// =====================================================================
// Pixel-art cleanup (Milestone 4.1-patch 2)
// =====================================================================

function makeRgba16(filler: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const [r, g, b, a] = filler(x, y);
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return rgba;
}

function countOpaque(rgba: Uint8Array): number {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! === 255) n++;
  return n;
}

function uniqueOpaqueColors(rgba: Uint8Array): number {
  const seen = new Set<string>();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 255) seen.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
  }
  return seen.size;
}

test("pixelCleanIcon: snaps semi-transparent pixels to fully transparent or fully opaque", () => {
  const rgba = makeRgba16((x, y) => {
    // Mix of alpha levels: 30 (→ 0), 80 (→ 255), 200 (→ 255), 255 (→ 255).
    const k = (x + y) % 4;
    if (k === 0) return [200, 100, 50, 30];
    if (k === 1) return [200, 100, 50, 80];
    if (k === 2) return [200, 100, 50, 200];
    return [200, 100, 50, 255];
  });
  const out = pixelCleanIcon(rgba);
  for (let i = 3; i < out.length; i += 4) {
    const a = out[i]!;
    assert.ok(a === 0 || a === 255, `pixel ${i / 4} alpha=${a} must be 0 or 255 after cleanup`);
  }
});

test("pixelCleanIcon: reduces unique opaque colors below the palette cap", () => {
  // 16x16 with a smooth gradient → many unique RGB triples.
  const rgba = makeRgba16((x, y) => [
    Math.min(255, x * 16 + 5),
    Math.min(255, y * 16 + 5),
    128,
    255,
  ]);
  const before = uniqueOpaqueColors(rgba);
  const after = uniqueOpaqueColors(pixelCleanIcon(rgba));
  assert.ok(before > 12, `test setup: source should have many colors, had ${before}`);
  assert.ok(after <= 12, `cleaned image should have <=12 colors, had ${after}`);
  assert.ok(after < before, `cleanup must reduce color count (was ${before}, became ${after})`);
});

test("pixelCleanIcon: keeps a 1-px diagonal katana line connected", () => {
  // Single-pixel diagonal from (1,1) to (14,14).
  const rgba = makeRgba16((x, y) => (x === y && x >= 1 && x <= 14 ? [200, 200, 200, 255] : [0, 0, 0, 0]));
  const out = pixelCleanIcon(rgba);
  // Every original pixel must remain opaque (the diagonal forms one
  // 8-connected component, so removeIsolatedNoise won't touch it).
  for (let i = 1; i <= 14; i++) {
    const idx = (i * 16 + i) * 4;
    assert.equal(out[idx + 3], 255, `diagonal pixel (${i},${i}) must remain opaque`);
  }
});

test("pixelCleanIcon: removes an isolated single-pixel noise dot far from the main object", () => {
  const rgba = makeRgba16((x, y) => {
    if (x === y && x >= 1 && x <= 14) return [200, 200, 200, 255]; // diagonal blade
    if (x === 0 && y === 15) return [255, 0, 0, 255];               // isolated noise pixel
    return [0, 0, 0, 0];
  });
  const out = pixelCleanIcon(rgba);
  // Noise pixel at (0,15) must be cleared.
  const ni = (15 * 16 + 0) * 4;
  assert.equal(out[ni + 3], 0, "isolated noise pixel must be removed");
  // Diagonal still intact.
  const di = (8 * 16 + 8) * 4;
  assert.equal(out[di + 3], 255, "main diagonal unaffected by noise removal");
});

test("pixelCleanIcon: produces sharper edges (some perimeter pixels darker than interior)", () => {
  // 6x6 solid block of mid-grey at rows 5..10, cols 5..10.
  const rgba = makeRgba16((x, y) => (x >= 5 && x <= 10 && y >= 5 && y <= 10 ? [160, 160, 160, 255] : [0, 0, 0, 0]));
  const out = pixelCleanIcon(rgba);
  // The interior pixel (8,8) has all 4-neighbors opaque, so it's not an
  // edge pixel; the corner (5,5) IS an edge. Edge should be darker.
  const interior = out[(8 * 16 + 8) * 4]!;
  const edge = out[(5 * 16 + 5) * 4]!;
  assert.ok(edge < interior, `edge pixel should be darker than interior (edge=${edge}, interior=${interior})`);
});

test("pixelCleanIcon: byte-deterministic for the same input", () => {
  const rgba = makeRgba16((x, y) => (x === y && x >= 1 && x <= 14 ? [180, 200, 220, 255] : [0, 0, 0, 0]));
  const a = pixelCleanIcon(rgba);
  const b = pixelCleanIcon(rgba);
  assert.deepEqual(a, b);
});

test("postProcessAiImage: AI image goes through cleanup so the final PNG has ≤ 12 unique opaque colors", () => {
  // Smooth coloured 64x64 disc → many unique colours at first; after
  // resample + cleanup the encoded PNG should be palette-quantised.
  const W = 64, H = 64;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - 32, dy = y - 32;
      const inside = dx * dx + dy * dy <= 18 * 18;
      const i = (y * W + x) * 4;
      if (inside) {
        rgba[i] = (x * 4) & 255;
        rgba[i + 1] = (y * 4) & 255;
        rgba[i + 2] = 80;
        rgba[i + 3] = 255;
      }
    }
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const dec = decodePng(r.png);
  const colours = uniqueOpaqueColors(dec.rgba);
  assert.ok(colours <= 12, `postProcessAiImage output should be palette-quantised, has ${colours} colours`);
  // And every alpha value is fully on or fully off.
  for (let i = 3; i < dec.rgba.length; i += 4) {
    assert.ok(dec.rgba[i] === 0 || dec.rgba[i] === 255, `alpha must be snapped, got ${dec.rgba[i]}`);
  }
});

test("postProcessAiImage: thin diagonal katana stays connected after cleanup", () => {
  // 16x16 input — already at target size — single-pixel diagonal that just
  // barely passes validation (sparse-elongated). Cleanup must not erase it.
  const W = 16, H = 16;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 1; i <= 14; i++) {
    const idx = (i * W + i) * 4;
    rgba[idx] = 200; rgba[idx + 1] = 200; rgba[idx + 2] = 220; rgba[idx + 3] = 255;
  }
  const r = postProcessAiImage(encodePng(W, H, rgba));
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const dec = decodePng(r.png);
  let preserved = 0;
  for (let i = 1; i <= 14; i++) {
    if (dec.rgba[(i * W + i) * 4 + 3] === 255) preserved++;
  }
  assert.ok(preserved >= 12, `cleanup must preserve ≥12 of the 14 katana pixels, got ${preserved}`);
});

test("buildPromptForFeature: katana prompt asks for thicker-than-1px line + canvas fill", async () => {
  const { buildPromptForFeature } = await import("../src/textures/openAiTexture.js");
  const p = buildPromptForFeature(baseSpec, {
    type: "weapon",
    id: "lava_katana",
    name: "Lava Katana",
    description: "",
    details: { weaponType: "katana" },
  } as never);
  assert.match(p, /Fill most of the canvas/i);
  assert.match(p, /thicker than a single pixel line/i);
  assert.match(p, /readable silhouette at 16x16/i);
});

test("notice format: per-feature 'attempted but failed' message includes id and safe reason", async () => {
  setAiTextureProvider(async () => Buffer.from("not a png"));
  try {
    const spec: ModSpec = {
      ...baseSpec,
      features: [
        { type: "weapon", id: "lava_katana", name: "Lava Katana", description: "", details: { weaponType: "katana" } },
      ],
    } as never;
    const got = await withEnvAsync(
      { OPENAI_API_KEY: "sk-test", MODFORGE_AI_TEXTURES: "1" },
      () => precomputeAiTextures(spec),
    );
    assert.equal(got.failures.length, 1);
    const notice = `AI texture generation was attempted for ${got.failures[0]!.id} but failed: ${got.failures[0]!.reason}. Used deterministic fallback.`;
    assert.match(notice, /attempted for lava_katana but failed:/);
    assert.match(notice, /Used deterministic fallback/);
    // The key must not appear in the synthesized notice.
    assert.ok(!notice.includes("sk-test"));
  } finally {
    setAiTextureProvider(null);
  }
});
