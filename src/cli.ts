#!/usr/bin/env node
import prompts from "prompts";
import { config } from "./config.js";
import { formatPreflight } from "./preflight.js";
import {
  runGeneration,
  type GenerationEvent,
} from "./core/runGeneration.js";

async function main(): Promise<void> {
  const argIdea = process.argv.slice(2).join(" ").trim();

  printBanner();

  // Get the idea up front so the user isn't surprised by an interactive
  // prompt after preflight output scrolls by.
  let idea = argIdea;
  if (!idea) {
    const res = await prompts({
      type: "text",
      name: "idea",
      message: "Describe your Minecraft Fabric mod idea:",
      validate: (v: string) => (v.trim().length > 0 ? true : "Required"),
    });
    if (!res.idea) {
      console.error("Aborted.");
      process.exit(1);
    }
    idea = String(res.idea).trim();
  }

  const result = await runGeneration({ idea }, makeRenderer());

  if (!result.ok && !result.outcome) {
    // Preflight or pre-build error.
    process.exit(1);
  }
  process.exit(result.ok ? 0 : 2);
}

function makeRenderer(): (e: GenerationEvent) => void {
  return (e) => {
    switch (e.type) {
      case "preflight":
        console.log(formatPreflight(e.result));
        console.log("");
        return;
      case "phase":
        console.log(`\n[${ts()}] ${e.message}...`);
        return;
      case "spec":
        console.log(`  -> ${e.spec.modName} (${e.spec.modId})`);
        console.log(`  -> ${e.spec.features.length} feature(s)`);
        return;
      case "workspace":
        console.log(`  -> ${e.projectPath}`);
        return;
      case "scaffold:done":
        return;
      case "codegen:done":
        console.log(
          `  -> wrote ${e.written.length} file(s) (source: ${e.source === "templates" ? "deterministic templates" : "AI fallback"})`,
        );
        if (e.uncoveredReasons && e.uncoveredReasons.length > 0) {
          console.log("  uncovered features (forced AI fallback):");
          for (const r of e.uncoveredReasons) console.log(`    - ${r}`);
        }
        return;
      case "build:start":
        // The phase line already announced "Running gradle build" for attempt 1;
        // only announce explicitly for retries.
        if (e.attempt > 1) console.log(`\n[${ts()}] build attempt ${e.attempt}...`);
        return;
      case "build:chunk":
        process.stdout.write(e.chunk);
        return;
      case "build:result": {
        const r = e.result;
        const tag =
          r.reason === "success"
            ? "OK"
            : r.reason === "build-failed"
              ? `FAIL (exit ${r.exitCode})`
              : r.reason === "timeout"
                ? "TIMEOUT"
                : "SPAWN-FAILED";
        console.log(
          `\n[build ${e.attempt}] ${tag} in ${(r.durationMs / 1000).toFixed(1)}s${
            r.stdoutTruncated || r.stderrTruncated ? " (logs truncated)" : ""
          }`,
        );
        return;
      }
      case "repair:start":
        console.log(`\n[${ts()}] repair attempt ${e.attempt}...`);
        return;
      case "repair:done":
        if (e.diagnosis) console.log(`  diagnosis: ${e.diagnosis}`);
        console.log(
          `  files changed: ${e.filesChanged.length > 0 ? e.filesChanged.join(", ") : "(none)"}`,
        );
        return;
      case "stop":
        console.log(`\n[stop] ${e.reason}`);
        return;
      case "done":
        console.log(e.summary);
        return;
      case "error":
        console.error(`\nError: ${e.error}`);
        return;
    }
  };
}

function ts(): string {
  return new Date().toLocaleTimeString();
}

function printBanner(): void {
  console.log("ModForge AI — Minecraft Fabric mod generator");
  console.log(`Model: ${config.model}   MC: ${config.fabric.mcVersion}   Workspace: ${config.workspaceDir}`);
  console.log(`Max repairs: ${config.maxRepairs}`);
  console.log("");
}

main().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
