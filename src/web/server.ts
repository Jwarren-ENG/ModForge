import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseIntInRange(
  raw: string | undefined,
  fallback: number,
  name: string,
  lo: number,
  hi: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid ${name}="${raw}". Must be a positive integer.`);
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < lo || n > hi) {
    throw new Error(`Invalid ${name}="${raw}". Must be in [${lo}, ${hi}].`);
  }
  return n;
}

const HOST = "127.0.0.1"; // local-only by design
const PORT = parseIntInRange(
  process.env.MODFORGE_WEB_PORT,
  5173,
  "MODFORGE_WEB_PORT",
  1024,
  65535,
);
const MAX_ACTIVE_JOBS = parseIntInRange(
  process.env.MODFORGE_MAX_ACTIVE_JOBS,
  1,
  "MODFORGE_MAX_ACTIVE_JOBS",
  1,
  16,
);

const clientDir = path.resolve(__dirname, "client");
if (!fs.existsSync(clientDir)) {
  // The web server is intended to be run via `npm run web` (tsx) — that path
  // resolves to src/web/client. The compiled dist build does NOT copy the
  // static client (no .ts files there), so running `node dist/web/server.js`
  // would fail to find the UI. Refuse to start with a clear hint.
  console.error(
    `[modforge web] Client directory not found: ${clientDir}\n` +
      `The web server must be run from source via 'npm run web' or 'npm run dev:web'.\n` +
      `Compiled (dist) execution is not currently supported because the static\n` +
      `client is not copied to dist by 'npm run build'.`,
  );
  process.exit(1);
}

const app = createApp({ maxActiveJobs: MAX_ACTIVE_JOBS, clientDir });
app.listen(PORT, HOST, () => {
  console.log(`ModForge AI web UI running at http://${HOST}:${PORT}`);
  console.log(`  serving client from: ${clientDir}`);
  console.log(`  max active jobs:     ${MAX_ACTIVE_JOBS}`);
});
