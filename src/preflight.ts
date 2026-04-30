import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

const REQUIRED_JDK_MAJOR = 17;
// Fabric Loom 1.6 (our pinned stack) requires Gradle 8.x — Gradle 9 broke
// internal APIs Loom 1.6 relies on. Bumping this range requires also bumping
// `loomVersion` in src/config.ts.
const GRADLE_MIN_MAJOR = 8;
const GRADLE_MAX_MAJOR_EXCLUSIVE = 9;
const GRADLE_RECOMMENDED = "8.8 or 8.10.2";

export interface PreflightResult {
  ok: boolean;
  java: { found: boolean; version?: number; raw?: string };
  gradle: { found: boolean; version?: string; major?: number; raw?: string };
  problems: string[];
  hints: string[];
}

export async function runPreflight(): Promise<PreflightResult> {
  const problems: string[] = [];
  const hints: string[] = [];

  const java = await checkJava();
  if (!java.found) {
    problems.push("JDK is not installed or not on PATH.");
    hints.push(
      `Install JDK ${REQUIRED_JDK_MAJOR}+ (Temurin recommended): https://adoptium.net/temurin/releases/?version=${REQUIRED_JDK_MAJOR}`,
    );
    hints.push(`On macOS:  brew install --cask temurin@${REQUIRED_JDK_MAJOR}`);
  } else if (java.version !== undefined && java.version < REQUIRED_JDK_MAJOR) {
    problems.push(
      `JDK ${java.version} found, but JDK ${REQUIRED_JDK_MAJOR} or newer is required.`,
    );
    hints.push(
      `Install JDK ${REQUIRED_JDK_MAJOR}+: https://adoptium.net/temurin/releases/?version=${REQUIRED_JDK_MAJOR}`,
    );
    hints.push(
      `On macOS, set JAVA_HOME to a 17 JDK:  export JAVA_HOME=$(/usr/libexec/java_home -v ${REQUIRED_JDK_MAJOR})`,
    );
  }

  const gradle = await checkGradle();
  if (!gradle.found) {
    problems.push("Gradle is not installed or not on PATH.");
    hints.push(
      `Install Gradle ${GRADLE_RECOMMENDED} (Gradle 9+ is NOT supported by Loom 1.6): https://gradle.org/install/`,
    );
    hints.push("On macOS:  brew install gradle@8 && brew link --force --overwrite gradle@8");
  } else if (gradle.major !== undefined && gradle.major >= GRADLE_MAX_MAJOR_EXCLUSIVE) {
    problems.push(
      `Gradle ${gradle.version} found. Fabric Loom 1.6 is not compatible with Gradle 9+. Please install Gradle ${GRADLE_RECOMMENDED}.`,
    );
    hints.push("On macOS:  brew uninstall gradle && brew install gradle@8 && brew link --force --overwrite gradle@8");
    hints.push(
      "Manual: download https://services.gradle.org/distributions/gradle-8.8-bin.zip, unzip to /opt/gradle-8.8, then add /opt/gradle-8.8/bin to your PATH.",
    );
  } else if (gradle.major !== undefined && gradle.major < GRADLE_MIN_MAJOR) {
    problems.push(
      `Gradle ${gradle.version} found, but Gradle ${GRADLE_MIN_MAJOR}.x is required (Loom 1.6 needs it).`,
    );
    hints.push(
      `Install Gradle ${GRADLE_RECOMMENDED} (do NOT use Gradle 9+): https://gradle.org/install/`,
    );
    hints.push("On macOS:  brew install gradle@8 && brew link --force --overwrite gradle@8");
  }

  return { ok: problems.length === 0, java, gradle, problems, hints };
}

async function checkJava(): Promise<PreflightResult["java"]> {
  try {
    const { stderr } = await pexec("java", ["-version"]);
    const raw = stderr.trim();
    const version = parseJavaMajor(raw);
    return { found: true, version, raw };
  } catch {
    return { found: false };
  }
}

function parseJavaMajor(raw: string): number | undefined {
  const m = raw.match(/version\s+"([^"]+)"/);
  if (!m) return undefined;
  const v = m[1]!;
  if (v.startsWith("1.")) return Number(v.split(".")[1]);
  const major = v.split(".")[0];
  const n = Number(major);
  return Number.isFinite(n) ? n : undefined;
}

async function checkGradle(): Promise<PreflightResult["gradle"]> {
  try {
    const { stdout } = await pexec("gradle", ["--version"]);
    const raw = stdout.trim();
    const m = raw.match(/Gradle\s+(\d+(?:\.\d+)*)/);
    const version = m?.[1];
    const major = version ? Number(version.split(".")[0]) : undefined;
    return { found: true, version, major, raw };
  } catch {
    return { found: false };
  }
}

export function formatPreflight(r: PreflightResult): string {
  const lines: string[] = [];
  lines.push("Preflight check:");
  lines.push(
    `  Java:   ${r.java.found ? `found (v${r.java.version ?? "?"})` : "NOT FOUND"} — required ${REQUIRED_JDK_MAJOR}+`,
  );
  lines.push(
    `  Gradle: ${r.gradle.found ? `found (${r.gradle.version ?? "?"})` : "NOT FOUND"} — required ${GRADLE_MIN_MAJOR}.x (Gradle 9+ NOT supported by Loom 1.6)`,
  );
  if (!r.ok) {
    lines.push("");
    lines.push("Problems:");
    for (const p of r.problems) lines.push(`  - ${p}`);
    lines.push("");
    lines.push("Setup hints:");
    for (const h of r.hints) lines.push(`  - ${h}`);
  }
  return lines.join("\n");
}
