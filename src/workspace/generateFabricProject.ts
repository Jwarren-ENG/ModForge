import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { ModSpec } from "../types.js";

/**
 * Writes the deterministic Fabric scaffold (build files, manifest, lang stub).
 * The Java sources and any per-feature JSONs are produced separately by the
 * AI codegen step.
 */
export async function generateFabricProject(
  spec: ModSpec,
  projectPath: string,
): Promise<void> {
  await write(projectPath, "settings.gradle", settingsGradle(spec));
  await write(projectPath, "build.gradle", buildGradle());
  await write(projectPath, "gradle.properties", gradleProperties(spec));

  const resourcesDir = "src/main/resources";
  await write(projectPath, `${resourcesDir}/fabric.mod.json`, fabricModJson(spec));
  await write(
    projectPath,
    `${resourcesDir}/assets/${spec.modId}/lang/en_us.json`,
    langStub(),
  );

  const javaSrc = `src/main/java/${spec.packageName.replace(/\./g, "/")}`;
  await fs.mkdir(path.join(projectPath, javaSrc), { recursive: true });

  await write(projectPath, ".gitignore", projectGitignore());
}

async function write(root: string, relPath: string, content: string): Promise<void> {
  const full = path.join(root, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

function settingsGradle(spec: ModSpec): string {
  return `pluginManagement {
    repositories {
        maven { url 'https://maven.fabricmc.net/' }
        mavenCentral()
        gradlePluginPortal()
    }
}

rootProject.name = '${spec.modId}'
`;
}

function buildGradle(): string {
  const f = config.fabric;
  return `plugins {
    id 'fabric-loom' version '${f.loomVersion}'
    id 'maven-publish'
}

version = project.mod_version
group = project.maven_group

base {
    archivesName = project.archives_base_name
}

repositories {
}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
    mappings "net.fabricmc:yarn:\${project.yarn_mappings}:v2"
    modImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
}

processResources {
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") {
        expand "version": project.version
    }
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = ${f.javaVersion}
}

java {
    withSourcesJar()
    sourceCompatibility = JavaVersion.VERSION_${f.javaVersion}
    targetCompatibility = JavaVersion.VERSION_${f.javaVersion}
}

jar {
    from("LICENSE") {
        rename { "\${it}_\${project.archivesBaseName}" }
    }
}
`;
}

function gradleProperties(spec: ModSpec): string {
  const f = config.fabric;
  return `# Gradle
org.gradle.jvmargs=-Xmx2G
org.gradle.parallel=true

# Minecraft / Fabric
minecraft_version=${f.mcVersion}
yarn_mappings=${f.yarnMappings}
loader_version=${f.loaderVersion}
fabric_version=${f.fabricApiVersion}

# Mod
mod_version=${spec.modVersion}
maven_group=${spec.packageName.split(".").slice(0, -1).join(".") || "com.modforge"}
archives_base_name=${spec.modId}
`;
}

function fabricModJson(spec: ModSpec): string {
  const entry = `${spec.packageName}.${spec.mainClass}`;
  const obj = {
    schemaVersion: 1,
    id: spec.modId,
    version: "${version}",
    name: spec.modName,
    description: spec.description,
    authors: ["ModForge AI"],
    license: "MIT",
    environment: "*",
    entrypoints: {
      main: [entry],
    },
    depends: {
      fabricloader: ">=0.15.0",
      minecraft: `~${config.fabric.mcVersion}`,
      java: `>=${config.fabric.javaVersion}`,
      "fabric-api": "*",
    },
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

function langStub(): string {
  return JSON.stringify({}, null, 2) + "\n";
}

function projectGitignore(): string {
  return `.gradle/
build/
out/
.idea/
*.iml
run/
`;
}
