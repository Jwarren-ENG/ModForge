import fs from "node:fs/promises";
import path from "node:path";

/**
 * Finds the primary built jar in build/libs (excluding -sources and -dev jars).
 */
export async function packageSuccessfulBuild(
  projectPath: string,
): Promise<string | undefined> {
  const libs = path.join(projectPath, "build", "libs");
  let entries: string[];
  try {
    entries = await fs.readdir(libs);
  } catch {
    return undefined;
  }
  const jars = entries.filter((f) => f.endsWith(".jar"));
  if (jars.length === 0) return undefined;
  const primary =
    jars.find((j) => !/-sources\.jar$|-dev\.jar$/.test(j)) ?? jars[0]!;
  return path.join(libs, primary);
}
