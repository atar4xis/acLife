import { describe, expect, it } from "vitest";
import {
  DARK_COLORS,
  LIGHT_COLORS,
  type ThemeColorVar,
} from "../../src/lib/themeColors.ts";
import { contrastRatio, resolve } from "./contrast.ts";

const TEXT = 4.5;
const UI = 3;

// [foreground, background, minimum ratio]
const PAIRS: [ThemeColorVar, ThemeColorVar, number][] = [
  ["foreground", "background", TEXT],
  ["card-foreground", "card", TEXT],
  ["popover-foreground", "popover", TEXT],
  ["primary-foreground", "primary", TEXT],
  ["secondary-foreground", "secondary", TEXT],
  ["muted-foreground", "background", TEXT],
  ["muted-foreground", "muted", TEXT],
  ["muted-foreground", "card", TEXT],
  ["muted-foreground", "sidebar", TEXT],
  ["accent-foreground", "accent", TEXT],
  ["destructive", "background", TEXT],
  ["destructive", "card", TEXT],
  ["sidebar-foreground", "sidebar", TEXT],
  ["sidebar-primary-foreground", "sidebar-primary", TEXT],
  ["sidebar-accent-foreground", "sidebar-accent", TEXT],
  ["primary", "background", UI],
  ["input", "background", UI],
  ["input", "card", UI],
  ["ring", "background", UI],
  ["ring", "card", UI],
  ["sidebar-ring", "sidebar", UI],
];

describe.each([
  ["light", LIGHT_COLORS],
  ["dark", DARK_COLORS],
])("%s palette WCAG AA contrast", (_theme, palette) => {
  it.each(PAIRS)("%s on %s >= %s:1", (fg, bg, min) => {
    const background = resolve(palette[bg]);
    const ratio = contrastRatio(resolve(palette[fg], background), background);

    expect(ratio).toBeGreaterThanOrEqual(min);
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    const white = resolve("oklch(1 0 0)");
    const black = resolve("oklch(0 0 0)");
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it("composites translucent colors over the backdrop", () => {
    const black = resolve("oklch(0 0 0)");
    const half = resolve("oklch(1 0 0 / 50%)", black);
    expect(contrastRatio(half, black)).toBeGreaterThan(3);
    expect(contrastRatio(half, black)).toBeLessThan(10);
  });
});
