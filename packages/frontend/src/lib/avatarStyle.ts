// FNV-1a 32-bit hash (matches Avatar.astro / the prototype's hashStr).
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// C-04: brand-adjacent hue anchors (coral / amber / honey / teal / indigo / plum)
// instead of the full wheel, with unsigned shifts to avoid the signed-shift NaN.
const ANCHORS = [14, 28, 40, 186, 250, 332];

/**
 * Deterministic identicon gradient for a seed (e.g. an address). Same seed →
 * same gradient. Returns a CSS `radial-gradient(...)` string usable as a
 * `background` value, in the Nido warm palette.
 */
export function avatarBackground(seed: string): string {
  const h = hashStr(seed);
  const j = ((h >>> 11) % 16) - 8;
  const hue1 = (ANCHORS[h % ANCHORS.length] + j + 360) % 360;
  const hue2 = (ANCHORS[(h >>> 5) % ANCHORS.length] - j + 360) % 360;
  return `radial-gradient(circle at 32% 28%, hsl(${hue1} 58% 60%), hsl(${hue2} 60% 42%))`;
}
