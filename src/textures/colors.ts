export interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export const WHITE: Color = { r: 255, g: 255, b: 255 };
export const BLACK: Color = { r: 0, g: 0, b: 0 };
export const DIRT: Color = { r: 134, g: 96, b: 67 };

export function parseHex(hex: string): Color {
  const s = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`bad hex color: "${hex}" (expected #rrggbb)`);
  }
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/**
 * factor in [-1, 1]:
 *   negative -> darken toward black
 *   positive -> lighten toward white
 */
export function shade(c: Color, factor: number): Color {
  const f = Math.max(-1, Math.min(1, factor));
  if (f < 0) {
    const k = 1 + f;
    return { r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k), a: c.a };
  }
  return {
    r: Math.round(c.r + (255 - c.r) * f),
    g: Math.round(c.g + (255 - c.g) * f),
    b: Math.round(c.b + (255 - c.b) * f),
    a: c.a,
  };
}

export function mix(a: Color, b: Color, t: number): Color {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r * (1 - k) + b.r * k),
    g: Math.round(a.g * (1 - k) + b.g * k),
    b: Math.round(a.b * (1 - k) + b.b * k),
  };
}
