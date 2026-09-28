import { clamp, hexToHsl, hslToHex } from "@/lib/utils";

// target hues for the 7 chromatic presets, in the order they're generated
// (matches the hues of defaultCalendarSettings.eventColorPresets)
const PRESET_HUES = [221, 268, 306, 359, 26, 58, 117];

// vibe used when the theme's brand colors are neutral (grays)
const FALLBACK_S = 82.4;
const FALLBACK_L = 53.2;
const FALLBACK_WHITE_L = 89.8;
const FALLBACK_BLACK_L = 7.8;

// dark UI backgrounds need lighter, punchier accents to read as vivid
const VIBE_RANGES: Record<
  "light" | "dark",
  { s: [number, number]; l: [number, number] }
> = {
  dark: { s: [50, 95], l: [45, 75] },
  light: { s: [50, 90], l: [35, 58] },
};

export function generateThemeColorPresets(
  brandHexColors: string[],
  base: "light" | "dark",
): string[] {
  // first brand color with real chroma drives the palette's vibe
  const source = brandHexColors.map(hexToHsl).find((hsl) => hsl.s > 8);

  if (!source) {
    return [
      ...PRESET_HUES.map((h) => hslToHex(h, FALLBACK_S, FALLBACK_L)),
      hslToHex(0, 0, FALLBACK_WHITE_L),
      hslToHex(0, 0, FALLBACK_BLACK_L),
    ];
  }

  const { s: sRange, l: lRange } = VIBE_RANGES[base];
  const s = clamp(source.s, sRange[0], sRange[1]);
  const l = clamp(source.l, lRange[0], lRange[1]);

  const hued = PRESET_HUES.map((h) => hslToHex(h, s, l));
  const white = hslToHex(source.h, s * 0.12, 90);
  const black = hslToHex(source.h, s * 0.12, 14);

  return [...hued, white, black];
}
