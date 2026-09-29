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
  presets: ThemePreset[];
  activePresetId: string | null;
  savePreset: (name: string) => void;
  applyPreset: (preset: ThemePreset) => void;
  deletePreset: (id: string) => void;
  renamePreset: (id: string, name: string) => void;
  reorderPresets: (presets: ThemePreset[]) => void;
  importPreset: (preset: Omit<ThemePreset, "id">) => void;
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
  presets: [],
  activePresetId: null,
  savePreset: () => null,
  applyPreset: () => null,
  deletePreset: () => null,
  renamePreset: () => null,
  reorderPresets: () => null,
  importPreset: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children }: ThemeProviderProps) {
  const store = useSettingsStore();
  const { theme, colors, fontFamily, fontSize, presets, activePresetId } =
    useSettingsSelector(({ settings }) => ({
      theme: settings.theme,
      colors: settings.colors,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      presets: settings.presets,
      activePresetId: settings.activePresetId,
    }));
  const [resolvedBase, setResolvedBase] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    let base: "light" | "dark";
    if (theme === "custom") {
      // custom keeps whatever base was active before switching to it
      base = store.getSnapshot().lastBase;
    } else {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      base = theme === "light" || theme === "dark" ? theme : systemTheme;
      store.setSetting("lastBase", base);
    }

    root.classList.add(base);
    setResolvedBase(base);

    for (const key of THEME_COLOR_VARS) {
      const value = theme === "custom" ? colors[key] : undefined;
      if (value) {
        root.style.setProperty(`--${key}`, value);
      } else {
        root.style.removeProperty(`--${key}`);
      }
    }
  }, [theme, colors, store]);

  useEffect(() => {
    document.body.style.fontFamily = fontFamily || "";
  }, [fontFamily]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  const writePresets = (next: ThemePreset[]) =>
    store.setSetting("presets", next);

  const value: ThemeProviderState = {
    theme,
    setTheme: (next) => {
      store.setSettings({
        theme: next,
        activePresetId: null,
        // discard overrides so they don't resurface if custom is picked again
        ...(next !== "custom" && { colors: {} }),
      });
    },
    resolvedBase,
    colors,
    setColor: (variable, colorValue) => {
      store.setSettings({
        colors: { ...colors, [variable]: colorValue },
        theme: "custom",
        activePresetId: null,
      });
    },
    resetColors: () => {
      store.setSettings({ colors: {}, activePresetId: null });
    },
    fontFamily,
    setFontFamily: (next) => {
      store.setSettings({ fontFamily: next, activePresetId: null });
    },
    fontSize,
    setFontSize: (next) => {
      store.setSettings({ fontSize: next, activePresetId: null });
    },
    presets,
    activePresetId,
    savePreset: (name) => {
      const basePalette = resolvedBase === "dark" ? DARK_COLORS : LIGHT_COLORS;
      const preset: ThemePreset = {
        id: crypto.randomUUID(),
        name,
        base: resolvedBase,
        colors: { ...basePalette, ...colors },
        fontFamily,
        fontSize,
      };
      const current = store.getSnapshot().presets;
      const existing = current.find((p) => p.name === name);
      writePresets(
        existing
          ? current.map((p) =>
              p === existing ? { ...preset, id: existing.id } : p,
            )
          : [...current, preset],
      );
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
      writePresets(
        store
          .getSnapshot()
          .presets.map((p) => (p.id === id ? { ...p, name } : p)),
      );
    },
    reorderPresets: writePresets,
    importPreset: (preset) => {
      const current = store.getSnapshot().presets;
      const taken = new Set(current.map((p) => p.name));
      let name = preset.name;
      for (let n = 2; taken.has(name); n++) name = `${preset.name} ${n}`;
      writePresets([...current, { ...preset, name, id: crypto.randomUUID() }]);
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
