import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTexturePng } from "../src/textures/index.js";
import type { Silhouette } from "../src/textures/silhouettes.js";

const outDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "debug-textures",
  "weapons",
);
fs.mkdirSync(outDir, { recursive: true });

const samples: Array<{ name: string; sil: Silhouette; primary: string; secondary?: string }> = [
  { name: "katana", sil: "katana", primary: "#c8c8c8", secondary: "#5b3a1f" },
  { name: "sword", sil: "sword", primary: "#a0a0c0", secondary: "#5b3a1f" },
  { name: "dagger", sil: "dagger", primary: "#d0d0d0", secondary: "#3a1f0f" },
  { name: "hammer", sil: "hammer", primary: "#b87333", secondary: "#5b3a1f" },
  { name: "axe", sil: "axe", primary: "#9b9b9b", secondary: "#5b3a1f" },
  { name: "pickaxe", sil: "pickaxe", primary: "#8a6a52", secondary: "#5b3a1f" },
  { name: "shovel", sil: "shovel", primary: "#9b9b9b", secondary: "#5b3a1f" },
  { name: "hoe", sil: "hoe", primary: "#9b9b9b", secondary: "#5b3a1f" },
];
for (const s of samples) {
  const png = generateTexturePng({
    primaryColorHex: s.primary,
    secondaryColorHex: s.secondary,
    style: "metal",
    faceMode: "item",
    silhouette: s.sil,
  });
  fs.writeFileSync(path.join(outDir, `${s.name}.png`), png);
  console.log(`✓ ${s.name}.png`);
}
console.log(`Wrote samples to ${outDir}`);
