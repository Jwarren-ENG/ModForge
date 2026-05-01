#!/usr/bin/env tsx
/**
 * Writes representative texture samples to ./debug-textures/ for visual
 * inspection. Run with `npm run textures:debug`. The output directory is
 * gitignored so it never contaminates the repo.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTexturePng, type TextureRequest } from "../src/textures/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, "..", "debug-textures");

interface Sample extends TextureRequest {
  name: string;
}

const samples: Sample[] = [
  // Items / retextures
  {
    name: "black_crystal_diamond",
    style: "crystal",
    primaryColorHex: "#101015",
    secondaryColorHex: "#3a3a4a",
    glowing: true,
    faceMode: "item",
    silhouette: "diamond",
  },
  {
    name: "void_crystal_item",
    style: "crystal",
    primaryColorHex: "#3a004f",
    secondaryColorHex: "#1a0026",
    glowing: true,
    faceMode: "item",
  },
  {
    name: "ruby_gem_item",
    style: "gem",
    primaryColorHex: "#aa1133",
    faceMode: "item",
  },
  {
    name: "copper_hammer_item",
    style: "metal",
    primaryColorHex: "#b86b3a",
    faceMode: "item",
  },
  {
    name: "generic_item",
    style: "plain",
    primaryColorHex: "#88aaff",
    faceMode: "item",
  },

  // Block faces
  {
    name: "bloodstone_block",
    style: "metal",
    primaryColorHex: "#5a0a14",
    faceMode: "all",
  },
  {
    name: "purple_grass_top",
    style: "grass",
    primaryColorHex: "#5a008a",
    faceMode: "top",
  },
  {
    name: "purple_grass_side",
    style: "grass",
    primaryColorHex: "#5a008a",
    faceMode: "side",
  },
  {
    name: "sapphire_block",
    style: "gem",
    primaryColorHex: "#1a3aaa",
    faceMode: "all",
  },
  {
    name: "dark_stone_block",
    style: "stone",
    primaryColorHex: "#4a4a55",
    faceMode: "all",
  },
];

async function main(): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  for (const s of samples) {
    const png = generateTexturePng(s);
    const file = path.join(outDir, `${s.name}.png`);
    await fs.writeFile(file, png);
    console.log(`wrote ${file} (${png.length} bytes)`);
  }
  console.log(`\nDone — open ${outDir}/ to inspect ${samples.length} sample texture(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
