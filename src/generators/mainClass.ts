import type { GeneratedFile, ModSpec } from "../types.js";
import type { FeatureContribution } from "./types.js";

/**
 * Compose the single ModInitializer .java file from merged feature contributions.
 * onInitialize body is grouped: items first, then blocks, then commands.
 */
export function renderMainClass(
  spec: ModSpec,
  merged: FeatureContribution,
): GeneratedFile {
  const imports = uniqueSorted(merged.imports);
  // The Fabric ModInitializer is always required.
  const allImports = uniqueSorted([
    "net.fabricmc.api.ModInitializer",
    ...imports,
  ]);

  const importBlock = allImports.map((i) => `import ${i};`).join("\n");
  const fields = merged.fieldDecls.join("\n");

  const onInitParts: string[] = [];
  if (merged.itemRegisters.length > 0) {
    onInitParts.push("        // Items");
    onInitParts.push(...merged.itemRegisters);
  }
  if (merged.blockRegisters.length > 0) {
    onInitParts.push("        // Blocks");
    onInitParts.push(...merged.blockRegisters);
  }
  if (merged.commandRegisters.length > 0) {
    onInitParts.push("        // Commands");
    onInitParts.push(
      "        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {",
    );
    for (const reg of merged.commandRegisters) {
      // Indent one extra level since we're inside the lambda body.
      onInitParts.push(reg.replace(/^/gm, "    ").replace(/^ {4}$/gm, ""));
    }
    onInitParts.push("        });");
  }
  const onInitBody = onInitParts.length > 0 ? onInitParts.join("\n") : "        // (no features)";

  const src = `package ${spec.packageName};

${importBlock}

public class ${spec.mainClass} implements ModInitializer {
    public static final String MOD_ID = "${spec.modId}";

${fields ? fields + "\n" : ""}    @Override
    public void onInitialize() {
${onInitBody}
    }
}
`;

  const javaPath = `src/main/java/${spec.packageName.replace(/\./g, "/")}/${spec.mainClass}.java`;
  return { path: javaPath, content: src };
}

function uniqueSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort();
}
