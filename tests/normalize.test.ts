import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRawSpec } from "../src/agent/createModSpec.js";
import { ModSpecSchema } from "../src/schemas.js";

const baseSpec = {
  modId: "test_mod",
  modName: "Test",
  modVersion: "1.0.0",
  mcVersion: "1.20.1",
  modLoader: "fabric" as const,
  packageName: "com.modforge.test_mod",
  mainClass: "TestMod",
  description: "",
  features: [] as unknown[],
  filesToCreate: [],
  limitations: [],
  assumptions: [],
};

function grassFeature(faces: string[]) {
  return {
    type: "retexture_block",
    id: "purple_grass",
    name: "Purple Grass",
    description: "",
    details: {
      vanillaTarget: "minecraft:grass_block",
      textureStyle: "grass",
      textureColor: "#5a008a",
      faces,
    },
  };
}

test("normalizeRawSpec: grass_block ['top','side','bottom'] -> ['top','side']", () => {
  const raw = { ...baseSpec, features: [grassFeature(["top", "side", "bottom"])] };
  const out = normalizeRawSpec(raw) as typeof raw;
  const f = out.features[0] as { details: { faces: string[] } };
  assert.deepEqual(f.details.faces, ["top", "side"]);
  // Original input should not be mutated.
  const origFaces = (raw.features[0] as { details: { faces: string[] } }).details.faces;
  assert.deepEqual(origFaces, ["top", "side", "bottom"]);
});

test("normalizeRawSpec: grass_block ['bottom'] alone -> ['all']", () => {
  const raw = { ...baseSpec, features: [grassFeature(["bottom"])] };
  const out = normalizeRawSpec(raw) as typeof raw;
  const f = out.features[0] as { details: { faces: string[] } };
  assert.deepEqual(f.details.faces, ["all"]);
});

test("normalizeRawSpec: grass_block ['all'] left alone", () => {
  const raw = { ...baseSpec, features: [grassFeature(["all"])] };
  const out = normalizeRawSpec(raw) as typeof raw;
  const f = out.features[0] as { details: { faces: string[] } };
  assert.deepEqual(f.details.faces, ["all"]);
});

test("normalizeRawSpec: grass_block ['top','side'] left alone", () => {
  const raw = { ...baseSpec, features: [grassFeature(["top", "side"])] };
  const out = normalizeRawSpec(raw) as typeof raw;
  const f = out.features[0] as { details: { faces: string[] } };
  assert.deepEqual(f.details.faces, ["top", "side"]);
});

test("normalizeRawSpec: non-grass_block retexture_block is left alone", () => {
  const raw = {
    ...baseSpec,
    features: [
      {
        type: "retexture_block",
        id: "x",
        name: "x",
        description: "",
        details: {
          vanillaTarget: "minecraft:stone",
          textureStyle: "stone",
          textureColor: "#aabbcc",
          faces: ["bottom"], // would be invalid; normalizer must NOT touch this
        },
      },
    ],
  };
  const out = normalizeRawSpec(raw) as typeof raw;
  const f = out.features[0] as { details: { faces: string[] } };
  assert.deepEqual(f.details.faces, ["bottom"]);
});

test("normalizeRawSpec: non-retexture features unchanged", () => {
  const raw = {
    ...baseSpec,
    features: [
      { type: "item", id: "gem", name: "Gem", description: "", details: {} },
    ],
  };
  const out = normalizeRawSpec(raw);
  assert.deepEqual(out, raw);
});

test("normalize -> schema: 'Make grass blocks dark purple' shape passes validation", () => {
  // Simulates a planner that incorrectly included "bottom".
  const raw = { ...baseSpec, features: [grassFeature(["top", "side", "bottom"])] };
  const normalized = normalizeRawSpec(raw);
  const result = ModSpecSchema.safeParse(normalized);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    assert.fail("expected normalized spec to pass schema validation:\n" + msg);
  }
});

test("schema: bad face for grass_block emits friendly error mentioning 'all' and dirt", () => {
  // Bypass the normalizer to test the schema error directly. "bottom" passes
  // the enum but fails grass_block's allowlist (top/side/all only).
  const raw = { ...baseSpec, features: [grassFeature(["bottom"])] };
  const result = ModSpecSchema.safeParse(raw);
  assert.equal(result.success, false);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join("\n");
    assert.match(msg, /grass_block supports top, side, or all/);
    assert.match(msg, /bottom face is dirt/);
  }
});

test("schema: invalid face for non-grass block uses the generic error message", () => {
  const raw = {
    ...baseSpec,
    features: [
      {
        type: "retexture_block",
        id: "x",
        name: "x",
        description: "",
        details: {
          vanillaTarget: "minecraft:stone",
          textureStyle: "stone",
          textureColor: "#aabbcc",
          faces: ["top"], // stone only allows "all"
        },
      },
    ],
  };
  const result = ModSpecSchema.safeParse(raw);
  assert.equal(result.success, false);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join("\n");
    assert.match(msg, /face "top" is not allowed for "minecraft:stone"/);
    // Should NOT use the grass-specific phrasing for stone.
    assert.doesNotMatch(msg, /grass_block supports top, side, or all/);
  }
});

test("schema: unknown vanillaTarget still rejected", () => {
  const raw = {
    ...baseSpec,
    features: [
      {
        type: "retexture_block",
        id: "x",
        name: "x",
        description: "",
        details: {
          vanillaTarget: "minecraft:dragon_egg", // not in allowlist
          textureStyle: "stone",
          textureColor: "#aabbcc",
        },
      },
    ],
  };
  const result = ModSpecSchema.safeParse(raw);
  assert.equal(result.success, false);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join("\n");
    assert.match(msg, /not in the retexture allowlist/);
  }
});
