import Anthropic from "@anthropic-ai/sdk";
import { assertApiKey, config } from "./config.js";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  assertApiKey();
  if (!client) client = new Anthropic({ apiKey: config.apiKey });
  return client;
}

export interface AskOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export async function ask({
  system,
  user,
  maxTokens = 8000,
  temperature = 0,
}: AskOptions): Promise<string> {
  const c = getClient();
  const res = await c.messages.create({
    model: config.model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: user }],
  });
  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content.");
  }
  return textBlock.text;
}

/**
 * Extract a JSON object from a Claude response. Looks first for a
 * <json>...</json> block, then falls back to the first balanced {...}.
 * Returns `unknown` — callers MUST validate with a zod schema before use.
 */
export function extractJson(text: string): unknown {
  const tagged = text.match(/<json>([\s\S]*?)<\/json>/i);
  const raw = tagged ? tagged[1]! : firstBalancedObject(text);
  if (!raw) throw new Error("No JSON object found in model response.");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from model response: ${(err as Error).message}\n--- raw ---\n${raw}`,
    );
  }
}

function firstBalancedObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
