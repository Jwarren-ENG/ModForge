import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export async function createProjectWorkspace(modId: string): Promise<string> {
  await fs.mkdir(config.workspaceDir, { recursive: true });
  const safe = sanitize(modId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(config.workspaceDir, `${safe}-${stamp}`);
  await fs.mkdir(dir);
  return dir;
}

function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "") || "mod";
}
