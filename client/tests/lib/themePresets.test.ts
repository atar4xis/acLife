import { describe, expect, it } from "vitest";
import {
  MAX_PRESET_BYTES,
  fitsPresetLimit,
  presetBytes,
} from "@/lib/themePresets";
import { DARK_COLORS } from "@/lib/themeColors";

const preset = {
  name: "Theme",
  colors: DARK_COLORS,
  fontFamily: "",
  fontSize: 16,
};

describe("theme preset size limit", () => {
  it("fits a full palette", () => {
    expect(fitsPresetLimit(preset)).toBe(true);
  });

  it("counts the id the preset gets when stored", () => {
    const bare = new TextEncoder().encode(JSON.stringify(preset)).length;
    expect(presetBytes(preset)).toBeGreaterThan(bare + 36);
  });

  it("counts bytes, not characters", () => {
    const ascii = presetBytes({ ...preset, name: "a".repeat(100) });
    const wide = presetBytes({ ...preset, name: "é".repeat(100) });
    expect(wide - ascii).toBe(100);
  });

  it("rejects a preset over the limit", () => {
    const name = "a".repeat(MAX_PRESET_BYTES);
    expect(fitsPresetLimit({ ...preset, name })).toBe(false);
  });
});
