import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_MAX_REPAIRS = 3;

export const config = {
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.MODFORGE_MODEL ?? "claude-sonnet-4-6",
  maxRepairs: parsePositiveInt(
    process.env.MODFORGE_MAX_REPAIRS,
    DEFAULT_MAX_REPAIRS,
    "MODFORGE_MAX_REPAIRS",
  ),
  workspaceDir:
    process.env.MODFORGE_WORKSPACE_DIR && process.env.MODFORGE_WORKSPACE_DIR.length > 0
      ? path.resolve(process.env.MODFORGE_WORKSPACE_DIR)
      : path.join(repoRoot, "generated-projects"),
  // Pinned, well-supported Fabric target for the MVP.
  fabric: {
    mcVersion: "1.20.1",
    yarnMappings: "1.20.1+build.10",
    loaderVersion: "0.15.11",
    fabricApiVersion: "0.92.2+1.20.1",
    loomVersion: "1.6-SNAPSHOT",
    javaVersion: 17,
  },
};

export function assertApiKey(): void {
  if (!config.apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.",
    );
  }
}

/**
 * Strict positive-integer parser. Rejects NaN, negatives, decimals, scientific
 * notation, and trailing junk. Empty / undefined falls back to `fallback`.
 */
function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid ${name}="${raw}". Must be a positive integer (digits only).`,
    );
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${name}="${raw}". Must be >= 1.`);
  }
  return n;
}
