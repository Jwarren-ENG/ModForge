import { Buffer } from "node:buffer";
import { parseHex } from "./colors.js";
import { encodePng } from "./png.js";
import { paint, type FaceMode, type TextureStyle } from "./styles.js";
import type { Silhouette } from "./silhouettes.js";

export interface TextureRequest {
  primaryColorHex: string;
  secondaryColorHex?: string;
  style: TextureStyle;
  glowing?: boolean;
  faceMode?: FaceMode;
  /** Salt for per-face noise variation. */
  salt?: number;
  /**
   * Override the item silhouette. Only used when faceMode is "item". If
   * absent, the silhouette is derived from `style`.
   */
  silhouette?: Silhouette;
}

export function generateTexturePng(req: TextureRequest): Buffer {
  const primary = parseHex(req.primaryColorHex);
  const secondary = req.secondaryColorHex
    ? parseHex(req.secondaryColorHex)
    : undefined;
  const rgba = paint(req.style, {
    primary,
    secondary,
    glowing: req.glowing,
    faceMode: req.faceMode,
    salt: req.salt,
    silhouette: req.silhouette,
  });
  return encodePng(16, 16, rgba);
}

export type { TextureStyle, FaceMode } from "./styles.js";
export type { Silhouette } from "./silhouettes.js";
