import { ask, extractJson } from "../anthropic.js";
import {
  ClarificationResponseSchema,
  parseOrThrow,
  type ClarificationResponse,
} from "../schemas.js";
import { vanillaBlockKeys, vanillaItemKeys } from "../textures/vanillaTargets.js";

const SYSTEM = `You are ModForge AI's clarifier. Given a user's mod idea, decide whether short clarification questions are needed before we plan and generate the mod.

Return ONLY a JSON object inside <json>...</json>. No prose outside the tags. Shape:

{
  "skip": boolean,
  "questions": [
    {
      "id": "snake_case_id",
      "type": "choice" | "free_text",
      "question": "short question text (≤ 200 chars, ideally one sentence)",
      // for type="choice":
      "choices": ["short label 1", "short label 2", "...", "Other"],
      "allowOther": true,
      // for type="free_text":
      "placeholder": "optional placeholder hint"
    }
  ],
  "summary": "Got it. I'll {q_id}."
}

Rules:
- If the idea is clear and unambiguous (the planner can produce a confident spec), set skip: true and leave questions empty.
- Otherwise, ask 1-3 short questions. NEVER more than 3.
- Choice questions must have:
  • specific, concrete labels TAILORED to the user's idea (NOT generic placeholders)
  • each label ≤ 6 words
  • 2-5 specific choices PLUS "Other" as the last entry (since allowOther defaults to true)
- Use type "free_text" only when fixed choices would be too limiting (e.g. "What should this mod do differently from vanilla Minecraft?").
- Question ids are snake_case and unique within the response.
- The "summary" is a short sentence starting with "Got it." and uses {question_id} placeholders that the UI will substitute with the user's selected answer.
- Distinguish "edit existing vanilla item/block" intent from "add a new custom item" intent when relevant — that ambiguity is exactly the kind of thing to ask about.
- A prompt like "make a [color] [vanilla item]" (e.g. "make a red wooden sword", "make a black diamond sword", "make a purple diamond ore", "make a green apple") IS ambiguous and you SHOULD ask which option the user means. (A separate deterministic detector intercepts the most common phrasings before this LLM runs, but always handle the case here too.)
- These prompts are ALREADY clear and you should set skip: true (DO NOT ASK):
  • "Retexture the wooden sword red" / "Recolor the diamond purple"
  • "Edit the existing wooden sword to be red" / "Change the vanilla wooden sword to red"
  • "Retexture diamonds to look like black crystals"
  • "Add a new red wooden sword weapon" / "Create a custom red wooden sword"
  • "Add a void crystal item" / "Add a sapphire block with a crafting recipe"
  • "Make grass blocks dark purple" (grass_block is allowlisted; this reads as a direct vanilla retexture in our system)

Examples (study the shape AND the specificity of choices):

Idea: "Make wooden sword red"
{
  "skip": false,
  "questions": [
    {
      "id": "intent",
      "type": "choice",
      "question": "Do you want to recolor the existing vanilla Wooden Sword, or add a new custom red wooden sword?",
      "choices": ["Edit vanilla Wooden Sword", "Create new custom red wooden sword", "Other"],
      "allowOther": true
    }
  ],
  "summary": "Got it. I'll {intent}."
}

Idea: "Add a shadow weapon"
{
  "skip": false,
  "questions": [
    {
      "id": "weapon_type",
      "type": "choice",
      "question": "What kind of shadow weapon should it be?",
      "choices": ["Shadow sword", "Void axe", "Dark crystal hammer", "Ranged shadow bow", "Other"],
      "allowOther": true
    }
  ],
  "summary": "Got it. I'll create a {weapon_type}."
}

Idea: "Add a crystal block"
{
  "skip": false,
  "questions": [
    {
      "id": "look",
      "type": "choice",
      "question": "What should the crystal block look like?",
      "choices": ["Blue glowing crystal", "Dark purple void crystal", "Red metallic crystal", "Clear glassy crystal", "Other"],
      "allowOther": true
    }
  ],
  "summary": "Got it. I'll add a crystal block styled as {look}."
}

Idea: "Add a sapphire block with a crafting recipe"
{
  "skip": true,
  "questions": [],
  "summary": ""
}

Idea: "Retexture diamonds to look like black crystals"
{
  "skip": true,
  "questions": [],
  "summary": ""
}

Idea: "Add a mod that makes Minecraft more interesting"
{
  "skip": false,
  "questions": [
    {
      "id": "focus",
      "type": "free_text",
      "question": "What specifically should this mod add or change?",
      "placeholder": "e.g. add a glowing crystal item, retexture diamonds, or make grass blocks dark purple"
    }
  ],
  "summary": "Got it. I'll work on: {focus}."
}

Now process the user's idea below.`;

/**
 * Ask Claude whether the idea needs clarification. Before calling the LLM,
 * we run a deterministic ambiguity detector that intercepts the most common
 * failure mode ("make a [color] [vanilla item]" — could be retexture or
 * custom-item). If the detector fires, we return a hand-built clarification
 * without spending an LLM call.
 */
export async function generateClarification(
  idea: string,
): Promise<ClarificationResponse> {
  const det = detectAmbiguousVanillaRetexture(idea);
  if (det) return det;

  const text = await ask({
    system: SYSTEM,
    user: `User idea:\n"""\n${idea}\n"""\n\nReturn the JSON now inside <json>...</json>.`,
    maxTokens: 1500,
    temperature: 0,
  });
  const raw = extractJson(text);
  return parseOrThrow(ClarificationResponseSchema, raw, "Clarification");
}

// =====================================================================
// Deterministic ambiguity detector
// =====================================================================

/**
 * If the idea is ambiguous between "edit existing vanilla X" and "add a new
 * custom X" — i.e. it starts with "make ..." + names a vanilla allowlist
 * target without explicit retexture/creation keywords — return a hand-built
 * clarification. Otherwise return null and let the LLM decide.
 *
 * Examples that fire the detector:
 *   "make a red wooden sword"        -> ask
 *   "make a black diamond sword"     -> ask
 *   "make a purple diamond ore"      -> ask
 *   "make grass blocks dark purple"  -> ask
 *
 * Examples that DON'T fire (return null, LLM handles):
 *   "retexture the wooden sword red"            (explicit retexture verb)
 *   "edit the existing wooden sword to be red"  (explicit edit-vanilla)
 *   "change the vanilla wooden sword to red"
 *   "add a new red wooden sword weapon"         (explicit creation)
 *   "create a custom red wooden sword"
 *   "make a sapphire block with a recipe"       (no vanilla target match)
 *   "add a void crystal item"                   (doesn't start with "make")
 */
/**
 * Vanilla targets where "make X <color>" phrasing is unambiguous (the user
 * is clearly recoloring world visuals, not creating a new custom item with
 * the same name). The detector skips these so they flow straight to the
 * retexture path without an extra clarification roundtrip.
 *
 * Currently grass_block only — adding more here is fine if the same logic
 * applies, but keep the bar high: the rule of thumb is "would a sane reader
 * interpret 'make a red <X>' as a custom item?". For grass_block, no.
 */
const CLEAR_RETEXTURE_TARGETS: ReadonlySet<string> = new Set([
  "minecraft:grass_block",
]);

export function detectAmbiguousVanillaRetexture(
  idea: string,
): ClarificationResponse | null {
  const p = idea.trim().toLowerCase();
  if (p.length === 0) return null;

  // Must start with "make" — but not "make me" (creation phrasing).
  if (!/^make\b/.test(p)) return null;
  if (/^make\s+me\b/.test(p)) return null;

  // Reject explicit retexture intent.
  if (/\b(?:retexture|recolor)\b/.test(p)) return null;
  if (/\bedit\s+(?:the\s+)?(?:vanilla|existing)\b/.test(p)) return null;
  if (/\bchange\s+(?:the\s+)?(?:vanilla|existing)\b/.test(p)) return null;
  if (/\bthe\s+existing\s+vanilla\b/.test(p)) return null;

  // Reject explicit creation intent.
  if (/\b(?:add|create|build)\s+(?:a\s+|an\s+)?new\b/.test(p)) return null;
  if (/\b(?:add|create|build)\s+(?:a\s+|an\s+)?custom\b/.test(p)) return null;
  if (/\bnew\s+custom\b/.test(p)) return null;
  if (/\bcreate\s+a\s+custom\b/.test(p)) return null;

  // Find a vanilla target named in the prompt.
  const target = findVanillaTargetInPrompt(p);
  if (!target) return null;

  // Exempt list: targets where "make X <color>" phrasing is already clear
  // vanilla-retexture intent (no plausible "create new custom" interpretation).
  // These prompts should flow straight to retexture_block via the existing
  // RETEXTURE INTENT planner rule, without an extra clarification roundtrip.
  if (CLEAR_RETEXTURE_TARGETS.has(target.id)) return null;

  const targetName = humanizeId(target.id.replace(/^minecraft:/, ""));
  const descriptor = extractMakeDescriptor(idea); // preserves the user's casing
  const editLabel = `Edit vanilla ${targetName}`;
  const createLabel = `Create new custom ${descriptor}`;

  return {
    skip: false,
    questions: [
      {
        id: "intent",
        type: "choice",
        question: `Do you want to edit the existing vanilla ${targetName}, or create a new custom ${descriptor}?`,
        choices: [editLabel, createLabel, "Other"],
        allowOther: true,
      },
    ],
    summary: "Got it. I'll {intent}.",
  };
}

/**
 * Word-boundary scan of the prompt for any allowlisted vanilla target.
 * Returns the longest match (e.g. "wooden sword" beats "sword" alone).
 * Tolerates trailing plural "s" so "grass blocks" matches "grass_block".
 * Tolerates "wood" -> "wooden" and "gold" -> "golden" since users phrase
 * those casually.
 */
function findVanillaTargetInPrompt(
  prompt: string,
): { id: string; kind: "item" | "block" } | null {
  // Light normalization: collapse common short forms to vanilla canonical.
  const p = prompt
    .replace(/\bwood\b/g, "wooden")
    .replace(/\bgold(?!en)\b/g, "golden");

  type Cand = { id: string; words: string[]; kind: "item" | "block" };
  const cands: Cand[] = [];
  for (const k of vanillaItemKeys()) {
    cands.push({ id: k, words: k.replace(/^minecraft:/, "").split("_"), kind: "item" });
  }
  for (const k of vanillaBlockKeys()) {
    cands.push({ id: k, words: k.replace(/^minecraft:/, "").split("_"), kind: "block" });
  }
  // Longest first — "wooden_sword" wins over a hypothetical 1-word match.
  cands.sort((a, b) => b.words.length - a.words.length);

  for (const c of cands) {
    // Tolerate singular ↔ plural on the last word of the allowlist key.
    // "oak_planks" → singular "oak plank" matches, "oak planks" matches.
    // "wooden_sword" → "wooden sword" matches, "wooden swords" matches.
    const lastIdx = c.words.length - 1;
    const last = c.words[lastIdx]!;
    const lastSingular = last.endsWith("s") ? last.slice(0, -1) : last;
    const lastPattern = `${lastSingular}s?`;
    const head = c.words.slice(0, lastIdx);
    const reSrc = head.length > 0
      ? `\\b${head.join("\\s+")}\\s+${lastPattern}\\b`
      : `\\b${lastPattern}\\b`;
    const re = new RegExp(reSrc, "i");
    if (re.test(p)) return { id: c.id, kind: c.kind };
  }
  return null;
}

function humanizeId(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Extract the descriptive noun phrase after "make"/"make a"/"make an"/
 * "make the". Preserves the user's original casing.
 */
function extractMakeDescriptor(idea: string): string {
  const trimmed = idea.trim();
  const m =
    trimmed.match(/^make\s+(?:a|an|the|some)\s+(.+)$/i) ||
    trimmed.match(/^make\s+(.+)$/i);
  if (!m) return trimmed;
  return m[1]!.trim();
}

/**
 * Combine a user's original idea + their answers into the final prompt that
 * gets passed to `runGeneration`. Pure function — exported for testability.
 *
 * The output is plain text the planner can read; nothing in here ever
 * becomes a file path. The original prompt stays first; clarifications are
 * appended below as bullet lines tagged with the question key.
 */
export function buildClarifiedIdea(
  originalIdea: string,
  questions: ClarificationResponse["questions"],
  answers: Record<string, string>,
): string {
  const parts: string[] = [originalIdea.trim()];
  const lines: string[] = [];
  for (const q of questions) {
    const a = (answers[q.id] ?? "").trim();
    if (a.length === 0) continue;
    lines.push(`- ${q.id}: ${a}`);
  }
  if (lines.length > 0) {
    parts.push("\nClarifications:");
    parts.push(...lines);
  }
  return parts.join("\n");
}

/**
 * Substitute {question_id} placeholders in the summary template with the
 * user's answer text. Pure function.
 */
export function renderSummary(
  template: string,
  answers: Record<string, string>,
): string {
  if (!template) return "";
  return template.replace(/\{([a-z][a-z0-9_]*)\}/g, (_m, id: string) => {
    return answers[id] ?? `{${id}}`;
  });
}
