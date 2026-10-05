import { createContext, useContext, useEffect, useState } from "react";
import {
  useSettingsSelector,
  useSettingsStore,
} from "@/context/SettingsStoreContext";
import { defaultThemeSettings } from "@/lib/settingsDefaults";
import {
  DARK_COLORS,
  LIGHT_COLORS,
  THEME_COLOR_VARS,
  type ThemeColorVar,
} from "@/lib/themeColors";
import { MAX_PRESETS } from "@/lib/constants";
import { fitsPresetLimit, type PresetResult } from "@/lib/themePresets";
import type { Theme, ThemeColors, ThemePreset } from "@/types/Theme";

type ThemeProviderProps = {
  children: React.ReactNode;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedBase: "light" | "dark";
  colors: ThemeColors;
  setColor: (variable: ThemeColorVar, value: string) => void;
  resetColors: () => void;
  fontFamily: string;
  setFontFamily: (fontFamily: string) => void;
  fontSize: number;
  setFontSize: (fontSize: number) => void;
  customCss: string;
  setCustomCss: (customCss: string) => void;
  presets: ThemePreset[];
  activePresetId: string | null;
  savePreset: (name: string) => PresetResult;
  applyPreset: (preset: ThemePreset) => void;
  deletePreset: (id: string) => void;
  renamePreset: (id: string, name: string) => PresetResult;
  reorderPresets: (presets: ThemePreset[]) => void;
  importPreset: (preset: Omit<ThemePreset, "id">) => PresetResult;
};

const initialState: ThemeProviderState = {
  theme: defaultThemeSettings.theme,
  setTheme: () => null,
  resolvedBase: "light",
  colors: {},
  setColor: () => null,
  resetColors: () => null,
  fontFamily: defaultThemeSettings.fontFamily,
  setFontFamily: () => null,
  fontSize: defaultThemeSettings.fontSize,
  setFontSize: () => null,
  customCss: defaultThemeSettings.customCss,
  setCustomCss: () => null,
  presets: [],
  activePresetId: null,
  savePreset: () => "ok",
  applyPreset: () => null,
  deletePreset: () => null,
  renamePreset: () => "ok",
  reorderPresets: () => null,
  importPreset: () => "ok",
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children }: ThemeProviderProps) {
  const store = useSettingsStore();
  const settings = useSettingsSelector(({ settings }) => ({
    theme: settings.theme,
    colors: settings.colors,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    customCss: settings.customCss,
    presets: settings.presets,
    activePresetId: settings.activePresetId,
  }));
  const [resolvedBase, setResolvedBase] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    let base: "light" | "dark";
    if (settings.theme === "custom") {
      // custom keeps whatever base was active before switching to it
      base = store.getSnapshot().lastBase;
    } else {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      base =
        settings.theme === "light" || settings.theme === "dark"
          ? settings.theme
          : systemTheme;
      store.setSetting("lastBase", base);
    }

    root.classList.add(base);
    setResolvedBase(base);

    for (const key of THEME_COLOR_VARS) {
      const value =
        settings.theme === "custom" ? settings.colors[key] : undefined;
      if (value) {
        root.style.setProperty(`--${key}`, value);
      } else {
        root.style.removeProperty(`--${key}`);
      }
    }
  }, [settings.theme, settings.colors, store]);

  useEffect(() => {
    document.body.style.fontFamily = settings.fontFamily || "";
  }, [settings.fontFamily]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${settings.fontSize}px`;
  }, [settings.fontSize]);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = settings.customCss;
    document.head.append(style);
    return () => style.remove();
  }, [settings.customCss]);

  const writePresets = (next: ThemePreset[]) =>
    store.setSetting("presets", next);

  const value: ThemeProviderState = {
    theme: settings.theme,
    setTheme: (next) => {
      store.setSettings({
        theme: next,
        activePresetId: null,
        // discard overrides so they don't resurface if custom is picked again
        ...(next !== "custom" && { colors: {} }),
      });
    },
    resolvedBase,
    colors: settings.colors,
    setColor: (variable, colorValue) => {
      store.setSettings({
        colors: { ...settings.colors, [variable]: colorValue },
        theme: "custom",
        activePresetId: null,
      });
    },
    resetColors: () => {
      store.setSettings({ colors: {}, activePresetId: null });
    },
    fontFamily: settings.fontFamily,
    setFontFamily: (next) => {
      store.setSettings({ fontFamily: next, activePresetId: null });
    },
    fontSize: settings.fontSize,
    setFontSize: (next) => {
      store.setSettings({ fontSize: next, activePresetId: null });
    },
    customCss: settings.customCss,
    setCustomCss: (next) => {
      store.setSettings({ customCss: next });
    },
    presets: settings.presets,
    activePresetId: settings.activePresetId,
    savePreset: (name) => {
      const basePalette = resolvedBase === "dark" ? DARK_COLORS : LIGHT_COLORS;
      const preset: ThemePreset = {
        id: crypto.randomUUID(),
        name,
        base: resolvedBase,
        colors: { ...basePalette, ...settings.colors },
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
      };
      if (!fitsPresetLimit(preset)) return "too-large";

      const current = store.getSnapshot().presets;
      const existing = current.find((p) => p.name === name);
      if (!existing && current.length >= MAX_PRESETS) return "limit";

      writePresets(
        existing
          ? current.map((p) =>
              p === existing ? { ...preset, id: existing.id } : p,
            )
          : [...current, preset],
      );
      return "ok";
    },
    applyPreset: (preset) => {
      store.setSettings({
        ...(preset.base && { lastBase: preset.base }),
        colors: preset.colors,
        theme: "custom",
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
        activePresetId: preset.id,
      });
    },
    deletePreset: (id) => {
      const { presets: current, activePresetId: active } = store.getSnapshot();
      store.setSettings({
        presets: current.filter((p) => p.id !== id),
        ...(active === id && { activePresetId: null }),
      });
    },
    renamePreset: (id, name) => {
      const current = store.getSnapshot().presets;
      const target = current.find((p) => p.id === id);
      if (!target) return "ok";
      if (!fitsPresetLimit({ ...target, name })) return "too-large";

      writePresets(current.map((p) => (p === target ? { ...p, name } : p)));
      return "ok";
    },
    reorderPresets: writePresets,
    importPreset: (preset) => {
      const current = store.getSnapshot().presets;
      if (current.length >= MAX_PRESETS) return "limit";

      const taken = new Set(current.map((p) => p.name));
      let name = preset.name;
      for (let n = 2; taken.has(name); n++) name = `${preset.name} ${n}`;
      if (!fitsPresetLimit({ ...preset, name })) return "too-large";

      writePresets([...current, { ...preset, name, id: crypto.randomUUID() }]);
      return "ok";
    },
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

// eslint-disable-next-line
export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
