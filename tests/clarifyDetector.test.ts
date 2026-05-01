import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAmbiguousVanillaRetexture } from "../src/agent/clarify.js";
import { ClarificationResponseSchema, type ClarificationQuestion } from "../src/schemas.js";

/** Narrow helper so tests can read .choices without union acrobatics. */
function choicesOf(q: ClarificationQuestion): string[] {
  if (q.type !== "choice") {
    throw new Error("expected choice question, got " + q.type);
  }
  return q.choices;
}

// =====================================================================
// Detector — fires on ambiguous "make a [color] [vanilla item/block]"
// =====================================================================

test("detector: 'make a red wooden sword' returns ambiguity clarification", () => {
  const r = detectAmbiguousVanillaRetexture("make a red wooden sword");
  assert.ok(r, "must return a clarification");
  assert.equal(r!.skip, false);
  assert.equal(r!.questions.length, 1);
  const q = r!.questions[0]!;
  assert.equal(q.id, "intent");
  assert.equal(q.type, "choice");
  if (q.type !== "choice") throw new Error("unreachable: detector only emits choice questions");
  assert.deepEqual(q.choices.includes("Edit vanilla Wooden Sword"), true);
  assert.ok(
    q.choices.some((c) => c.toLowerCase().startsWith("create new custom")),
    "must include a 'Create new custom …' choice",
  );
  assert.deepEqual(q.choices.includes("Other"), true);
  // Wording covers BOTH options.
  assert.match(q.question, /edit the existing vanilla Wooden Sword/i);
  assert.match(q.question, /create a new custom/i);
  // The response must validate against the canonical schema.
  const parsed = ClarificationResponseSchema.safeParse(r);
  assert.equal(parsed.success, true);
});

test("detector: 'make a black diamond sword' triggers clarification with diamond_sword target", () => {
  const r = detectAmbiguousVanillaRetexture("make a black diamond sword");
  assert.ok(r);
  assert.ok(
    choicesOf(r!.questions[0]!).includes("Edit vanilla Diamond Sword"),
    `expected Diamond Sword choice, got: ${JSON.stringify(choicesOf(r!.questions[0]!))}`,
  );
});

test("detector: 'make a purple diamond ore' triggers clarification with block target", () => {
  const r = detectAmbiguousVanillaRetexture("make a purple diamond ore");
  assert.ok(r);
  assert.ok(choicesOf(r!.questions[0]!).includes("Edit vanilla Diamond Ore"));
});

test("detector: 'make a blue oak plank' (singular) matches plural allowlist key 'oak_planks'", () => {
  const r = detectAmbiguousVanillaRetexture("make a blue oak plank");
  assert.ok(r);
  assert.ok(choicesOf(r!.questions[0]!).includes("Edit vanilla Oak Planks"));
});

test("detector: 'make a green apple' triggers clarification (food item)", () => {
  const r = detectAmbiguousVanillaRetexture("make a green apple");
  assert.ok(r);
  assert.ok(choicesOf(r!.questions[0]!).includes("Edit vanilla Apple"));
});

test("detector: 'make a wood sword red' tolerates 'wood' -> 'wooden' normalization", () => {
  const r = detectAmbiguousVanillaRetexture("make a wood sword red");
  assert.ok(r, "wood -> wooden normalization must hit the allowlist");
  assert.ok(choicesOf(r!.questions[0]!).includes("Edit vanilla Wooden Sword"));
});

test("detector: longest match wins ('wooden sword' beats no match for 'sword' alone)", () => {
  const r = detectAmbiguousVanillaRetexture("make a wooden sword red");
  assert.ok(r);
  // Prefer the 2-word target.
  assert.ok(choicesOf(r!.questions[0]!).includes("Edit vanilla Wooden Sword"));
});

// =====================================================================
// Detector returns null — no clarification needed
// =====================================================================

test("detector: 'retexture the wooden sword red' returns null (explicit retexture verb)", () => {
  assert.equal(
    detectAmbiguousVanillaRetexture("retexture the wooden sword red"),
    null,
  );
});

test("detector: 'recolor the diamond purple' returns null", () => {
  assert.equal(detectAmbiguousVanillaRetexture("recolor the diamond purple"), null);
});

test("detector: 'edit the existing wooden sword to be red' returns null", () => {
  assert.equal(
    detectAmbiguousVanillaRetexture("edit the existing wooden sword to be red"),
    null,
  );
});

test("detector: 'change the vanilla wooden sword to red' returns null", () => {
  assert.equal(
    detectAmbiguousVanillaRetexture("change the vanilla wooden sword to red"),
    null,
  );
});

test("detector: 'add a new red wooden sword weapon' returns null (creation intent)", () => {
  assert.equal(
    detectAmbiguousVanillaRetexture("add a new red wooden sword weapon"),
    null,
  );
});

test("detector: 'create a custom red wooden sword' returns null", () => {
  assert.equal(
    detectAmbiguousVanillaRetexture("create a custom red wooden sword"),
    null,
  );
});

test("detector: 'add a void crystal item' returns null (doesn't start with 'make')", () => {
  assert.equal(detectAmbiguousVanillaRetexture("add a void crystal item"), null);
});

test("detector: 'make me a glowing pickaxe' returns null ('make me' is creation phrasing)", () => {
  assert.equal(
    detectAmbiguousVanillaRetexture("make me a glowing pickaxe"),
    null,
  );
});

test("detector: 'make a sapphire block with a recipe' returns null (no vanilla target match)", () => {
  // sapphire_block isn't a vanilla allowlist key.
  assert.equal(
    detectAmbiguousVanillaRetexture("make a sapphire block with a recipe"),
    null,
  );
});

test("detector: 'make a custom hammer' returns null (no vanilla match + 'custom' creation)", () => {
  assert.equal(detectAmbiguousVanillaRetexture("make a custom hammer"), null);
});

// =====================================================================
// Codex review patch — grass_block is treated as clear retexture intent
// =====================================================================

test("detector: 'make grass blocks dark purple' returns null (clear retexture, no clarification)", () => {
  // Codex review: grass_block phrasing is unambiguous world-visuals editing,
  // not custom-item creation. Skip the clarification roundtrip.
  assert.equal(
    detectAmbiguousVanillaRetexture("make grass blocks dark purple"),
    null,
  );
});

test("detector: 'make grass block dark purple' (singular) also returns null", () => {
  assert.equal(
    detectAmbiguousVanillaRetexture("make grass block dark purple"),
    null,
  );
});

test("detector: 'make the grass blocks purple' returns null", () => {
  assert.equal(
    detectAmbiguousVanillaRetexture("make the grass blocks purple"),
    null,
  );
});

test("detector: 'make a red wooden sword' STILL asks (regression guard)", () => {
  const r = detectAmbiguousVanillaRetexture("make a red wooden sword");
  assert.ok(r, "wooden_sword case must keep asking — only grass_block is exempt");
  assert.equal(r!.skip, false);
  assert.ok(choicesOf(r!.questions[0]!).includes("Edit vanilla Wooden Sword"));
});

test("detector: 'make the wooden sword red' STILL asks", () => {
  const r = detectAmbiguousVanillaRetexture("make the wooden sword red");
  assert.ok(r);
  assert.ok(choicesOf(r!.questions[0]!).includes("Edit vanilla Wooden Sword"));
});

test("detector: 'make a black diamond sword' STILL asks", () => {
  const r = detectAmbiguousVanillaRetexture("make a black diamond sword");
  assert.ok(r);
  assert.ok(choicesOf(r!.questions[0]!).includes("Edit vanilla Diamond Sword"));
});

test("detector: empty / whitespace input returns null", () => {
  assert.equal(detectAmbiguousVanillaRetexture(""), null);
  assert.equal(detectAmbiguousVanillaRetexture("   "), null);
});
