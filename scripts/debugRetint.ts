#!/usr/bin/env tsx
/**
 * Side-by-side retint preview. For each (vanilla source, target color) pair,
 * writes the original and the retinted PNG into ./debug-textures/retint/ so
 * you can eyeball whether the recolor preserved shape, shading, and contrast.
 *
 * Reads sources from $MODFORGE_VANILLA_ASSETS_DIR (i.e. the directory
 * `npm run vanilla:extract` populates). Output directory is gitignored.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retintPng } from "../src/textures/retint.js";

const outDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "debug-textures",
  "retint",
);

interface Sample {
  label: string;
  source: string; // path under MODFORGE_VANILLA_ASSETS_DIR
  primary: string;
  secondary?: string;
  oreMode?: boolean;
}

const samples: Sample[] = [
  { label: "wooden_sword_red", source: "assets/minecraft/textures/item/wooden_sword.png", primary: "#cc1133" },
  { label: "diamond_sword_black", source: "assets/minecraft/textures/item/diamond_sword.png", primary: "#000000" },
  { label: "diamond_sword_black_with_charcoal_secondary", source: "assets/minecraft/textures/item/diamond_sword.png", primary: "#1a1a1a", secondary: "#2a2a2a" },
  { label: "diamond_purple", source: "assets/minecraft/textures/item/diamond.png", primary: "#5a008a" },
  { label: "diamond_ore_purple", source: "assets/minecraft/textures/block/diamond_ore.png", primary: "#5a008a", oreMode: true },
  { label: "diamond_ore_purple_no_ore_mode", source: "assets/minecraft/textures/block/diamond_ore.png", primary: "#5a008a" },
  { label: "iron_ore_green", source: "assets/minecraft/textures/block/iron_ore.png", primary: "#2db547", oreMode: true },
  { label: "grass_block_top_dark_purple", source: "assets/minecraft/textures/block/grass_block_top.png", primary: "#3a0050" },
  { label: "grass_block_side_dark_purple", source: "assets/minecraft/textures/block/grass_block_side.png", primary: "#3a0050" },
];

async function main(): Promise<void> {
  const root = process.env.MODFORGE_VANILLA_ASSETS_DIR;
  if (!root) {
    console.error(
      "Set MODFORGE_VANILLA_ASSETS_DIR to your extracted vanilla assets dir first.",
    );
    console.error("  npm run vanilla:extract");
    console.error('  export MODFORGE_VANILLA_ASSETS_DIR="$(pwd)/vanilla-assets-1.20.1"');
    process.exit(1);
  }
  await fs.mkdir(outDir, { recursive: true });

  let ok = 0, miss = 0;
  for (const s of samples) {
    const srcPath = path.join(root, s.source);
    let buf: Buffer;
    try {
      buf = await fs.readFile(srcPath);
    } catch {
      console.warn(`skip (missing source): ${s.label} <- ${srcPath}`);
      miss++;
      continue;
    }
    await fs.writeFile(path.join(outDir, `${s.label}__source.png`), buf);
    const tinted = retintPng(buf, {
      primaryColorHex: s.primary,
      secondaryColorHex: s.secondary,
      oreMode: s.oreMode ?? false,
    });
    await fs.writeFile(path.join(outDir, `${s.label}__retint.png`), tinted);
    console.log(`✓ ${s.label}`);
    ok++;
  }
  console.log(`\n${ok} retinted into ${outDir}${miss ? ` (${miss} sources missing)` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
