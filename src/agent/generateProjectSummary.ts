import type { ModSpec, RepairOutcome } from "../types.js";

export function generateProjectSummary(
  spec: ModSpec,
  outcome: RepairOutcome,
  projectPath: string,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("==================== ModForge AI ====================");
  lines.push(`Mod:         ${spec.modName} (${spec.modId})`);
  lines.push(`Target:      Minecraft ${spec.mcVersion} / Fabric`);
  lines.push(`Project:     ${projectPath}`);
  lines.push(
    `Build:       ${outcome.success ? "SUCCESS" : "FAILED"} (final: ${outcome.finalReason}, ${outcome.buildAttempts} build(s), ${outcome.repairAttempts} repair(s))`,
  );
  if (outcome.success && outcome.jarPath) {
    lines.push(`Artifact:    ${outcome.jarPath}`);
  }

  if (outcome.history.length > 0) {
    lines.push("");
    lines.push("Repair history:");
    for (const h of outcome.history) {
      const dur = `${(h.buildDurationMs / 1000).toFixed(1)}s`;
      lines.push(
        `  - build #${h.attempt}: ${h.buildReason} (${dur})${h.diagnosis ? ` — ${h.diagnosis}` : ""}`,
      );
      if (h.filesChanged.length > 0) {
        lines.push(`      files changed: ${h.filesChanged.join(", ")}`);
      }
      if (h.stopReason) {
        lines.push(`      stop: ${h.stopReason}`);
      }
    }
  }

  lines.push("");
  lines.push("Features:");
  if (spec.features.length === 0) lines.push("  (none)");
  for (const f of spec.features) {
    lines.push(`  - [${f.type}] ${f.name} — ${f.description}`);
  }
  if (spec.assumptions.length) {
    lines.push("");
    lines.push("Assumptions:");
    for (const a of spec.assumptions) lines.push(`  - ${a}`);
  }
  if (spec.limitations.length) {
    lines.push("");
    lines.push("Limitations:");
    for (const l of spec.limitations) lines.push(`  - ${l}`);
  }
  lines.push("");
  if (outcome.success) {
    lines.push("Install: drop the jar into your Minecraft mods/ folder alongside Fabric API.");
  } else {
    lines.push("Build failed. See logs above. Re-run with a refined idea or fix manually in:");
    lines.push(`  ${projectPath}`);
  }
  lines.push("=====================================================");
  return lines.join("\n");
}
