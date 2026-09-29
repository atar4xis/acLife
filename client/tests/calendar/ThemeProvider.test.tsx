import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  ThemeProvider,
  useTheme,
} from "../../src/components/ThemeProvider.tsx";
import { DARK_COLORS, LIGHT_COLORS } from "../../src/lib/themeColors.ts";
import { readSettings } from "../settingsStorage.ts";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsStoreProvider>
    <ThemeProvider>{children}</ThemeProvider>
  </SettingsStoreProvider>
);

describe("useTheme", () => {
  it("falls back to safe no-op defaults when used outside a ThemeProvider", () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("system");
    expect(() => result.current.setTheme("dark")).not.toThrow();
  });

  it("defaults to system theme with no color overrides or presets", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("system");
    expect(result.current.colors).toEqual({});
    expect(result.current.presets).toEqual([]);
    expect(result.current.activePresetId).toBeNull();
    expect(result.current.fontSize).toBe(16);
  });

  it("setColor switches to custom theme and persists the override", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setColor("sidebar", "#123456");
    });

    expect(result.current.theme).toBe("custom");
    expect(result.current.colors.sidebar).toBe("#123456");
    expect(readSettings().colors).toEqual({ sidebar: "#123456" });
  });

  it("resetColors clears overrides without changing the theme mode", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setColor("sidebar-accent", "#abcdef");
    });
    act(() => {
      result.current.resetColors();
    });

    expect(result.current.colors).toEqual({});
    expect(result.current.theme).toBe("custom");
    expect(readSettings().colors).toEqual({});
  });

  it("setTheme discards color overrides when leaving custom", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setColor("primary", "#111111");
    });
    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(result.current.colors).toEqual({});
    expect(readSettings().colors).toEqual({});
  });

  it("setFontFamily and setFontSize persist to localStorage", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setFontFamily("Fira Code");
    });
    act(() => {
      result.current.setFontSize(18);
    });

    expect(result.current.fontFamily).toBe("Fira Code");
    expect(result.current.fontSize).toBe(18);
    expect(readSettings().fontFamily).toBe("Fira Code");
    expect(readSettings().fontSize).toBe(18);
  });

  it("savePreset snapshots the full resolved palette, not just overrides", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setColor("sidebar", "#ff00ff");
    });
    act(() => {
      result.current.setFontFamily("Inter");
    });
    act(() => {
      result.current.setFontSize(20);
    });
    act(() => {
      result.current.savePreset("My theme");
    });

    expect(result.current.presets).toHaveLength(1);
    const preset = result.current.presets[0];
    expect(preset.name).toBe("My theme");
    expect(preset.colors.sidebar).toBe("#ff00ff");
    // untouched vars fall back to the resolved base palette
    expect(preset.colors.background).toBe(LIGHT_COLORS.background);
    expect(preset.fontFamily).toBe("Inter");
    expect(preset.fontSize).toBe(20);
    expect(readSettings().presets).toHaveLength(1);
  });

  it("savePreset captures the dark palette when the dark base is active", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("dark");
    });
    act(() => {
      result.current.savePreset("Dark theme");
    });

    expect(result.current.presets[0].colors.background).toBe(
      DARK_COLORS.background,
    );
  });

  it("applyPreset restores colors and font settings and marks the preset active", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setColor("primary", "#010101");
      result.current.setFontSize(22);
    });
    act(() => {
      result.current.savePreset("Saved");
    });
    const presetId = result.current.presets[0].id;

    act(() => {
      result.current.setColor("primary", "#020202");
      result.current.setFontSize(14);
    });
    expect(result.current.activePresetId).toBeNull();

    act(() => {
      result.current.applyPreset(result.current.presets[0]);
    });

    expect(result.current.colors.primary).toBe("#010101");
    expect(result.current.fontSize).toBe(22);
    expect(result.current.theme).toBe("custom");
    expect(result.current.activePresetId).toBe(presetId);
  });

  it("clears the active preset when the user manually changes a color", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.savePreset("Saved");
    });
    const presetId = result.current.presets[0].id;

    act(() => {
      result.current.applyPreset(result.current.presets[0]);
    });
    expect(result.current.activePresetId).toBe(presetId);

    act(() => {
      result.current.setColor("accent", "#ababab");
    });
    expect(result.current.activePresetId).toBeNull();
  });

  it("clears the active preset when font settings change", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.savePreset("Saved");
    });

    act(() => {
      result.current.applyPreset(result.current.presets[0]);
    });
    act(() => {
      result.current.setFontFamily("Comic Sans MS");
    });

    expect(result.current.activePresetId).toBeNull();
  });

  it("deletePreset removes it from the list and clears active state if needed", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.savePreset("A");
    });
    act(() => {
      result.current.savePreset("B");
    });
    const [presetA, presetB] = result.current.presets;

    act(() => {
      result.current.applyPreset(presetA);
    });
    act(() => {
      result.current.deletePreset(presetA.id);
    });

    expect(result.current.presets.map((p) => p.id)).toEqual([presetB.id]);
    expect(result.current.activePresetId).toBeNull();
  });

  it("deletePreset leaves the active preset untouched if a different preset is removed", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.savePreset("A");
    });
    act(() => {
      result.current.savePreset("B");
    });
    const [presetA, presetB] = result.current.presets;

    act(() => {
      result.current.applyPreset(presetB);
    });
    act(() => {
      result.current.deletePreset(presetA.id);
    });

    expect(result.current.activePresetId).toBe(presetB.id);
  });

  it("importPreset adds an externally provided preset with a new id", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.importPreset({
        name: "Imported",
        colors: { background: "#000000" },
        fontFamily: "Menlo",
        fontSize: 15,
      });
    });

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0]).toMatchObject({
      name: "Imported",
      colors: { background: "#000000" },
      fontFamily: "Menlo",
      fontSize: 15,
    });
    expect(result.current.presets[0].id).toBeTruthy();
  });

  it("savePreset overwrites an existing preset with the same name", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setColor("primary", "#010101");
    });
    act(() => {
      result.current.savePreset("Same");
    });
    const originalId = result.current.presets[0].id;

    act(() => {
      result.current.setColor("primary", "#020202");
    });
    act(() => {
      result.current.savePreset("Same");
    });

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].id).toBe(originalId);
    expect(result.current.presets[0].colors.primary).toBe("#020202");
  });

  it("savePreset records the active base", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("dark");
    });
    act(() => {
      result.current.savePreset("Dark one");
    });

    expect(result.current.presets[0].base).toBe("dark");
  });

  it("importPreset appends a number to names that already exist", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    const incoming = {
      name: "catppuccin",
      colors: {},
      fontFamily: "",
      fontSize: 16,
    };

    act(() => {
      result.current.importPreset(incoming);
      result.current.importPreset(incoming);
      result.current.importPreset(incoming);
    });

    expect(result.current.presets.map((p) => p.name)).toEqual([
      "catppuccin",
      "catppuccin 2",
      "catppuccin 3",
    ]);
  });

  it("applyPreset switches to the base stored in the preset", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("light");
    });
    act(() => {
      result.current.applyPreset({
        id: "dark-preset",
        name: "Dark preset",
        base: "dark",
        colors: { background: "#000000" },
        fontFamily: "",
        fontSize: 16,
      });
    });

    expect(result.current.theme).toBe("custom");
    expect(result.current.resolvedBase).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applyPreset keeps the current base when the preset has none", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("dark");
    });
    act(() => {
      result.current.applyPreset({
        id: "no-base",
        name: "No base",
        colors: { background: "#ffffff" },
        fontFamily: "",
        fontSize: 16,
      });
    });

    expect(result.current.resolvedBase).toBe("dark");
  });

  it("renamePreset changes only the name", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.savePreset("Old");
    });
    const { id } = result.current.presets[0];

    act(() => {
      result.current.renamePreset(id, "New");
    });

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0]).toMatchObject({ id, name: "New" });
  });

  it("reorderPresets replaces the order and persists it", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.savePreset("A");
    });
    act(() => {
      result.current.savePreset("B");
    });
    const [a, b] = result.current.presets;

    act(() => {
      result.current.reorderPresets([b, a]);
    });

    expect(result.current.presets.map((p) => p.name)).toEqual(["B", "A"]);
    const stored = readSettings().presets;
    expect(stored.map((p: { name: string }) => p.name)).toEqual(["B", "A"]);
  });
});
