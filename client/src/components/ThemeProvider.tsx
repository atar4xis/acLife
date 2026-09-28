import { createContext, useContext, useEffect, useRef, useState } from "react";
import { readJSON } from "@/lib/utils";

export type Theme = "dark" | "light" | "system" | "custom";

// css custom properties that make up the app's color palette, without the leading "--"
// eslint-disable-next-line
export const THEME_COLOR_VARS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

export type ThemeColorVar = (typeof THEME_COLOR_VARS)[number];

export type ThemeColors = Partial<Record<ThemeColorVar, string>>;

// mirrors the :root / .dark palettes in index.css
// eslint-disable-next-line
export const LIGHT_COLORS: Record<ThemeColorVar, string> = {
  background: "oklch(0.975 0 0)",
  foreground: "oklch(0.145 0 0)",
  card: "oklch(1 0 0)",
  "card-foreground": "oklch(0.145 0 0)",
  popover: "oklch(1 0 0)",
  "popover-foreground": "oklch(0.145 0 0)",
  primary: "oklch(0.205 0 0)",
  "primary-foreground": "oklch(0.985 0 0)",
  secondary: "oklch(0.97 0 0)",
  "secondary-foreground": "oklch(0.205 0 0)",
  muted: "oklch(0.97 0 0)",
  "muted-foreground": "oklch(0.556 0 0)",
  accent: "oklch(0.97 0 0)",
  "accent-foreground": "oklch(0.205 0 0)",
  destructive: "oklch(0.577 0.245 27.325)",
  border: "oklch(0.922 0 0)",
  input: "oklch(0.812 0 0)",
  ring: "oklch(0.708 0 0)",
  sidebar: "oklch(0.985 0 0)",
  "sidebar-foreground": "oklch(0.145 0 0)",
  "sidebar-primary": "oklch(0.205 0 0)",
  "sidebar-primary-foreground": "oklch(0.985 0 0)",
  "sidebar-accent": "oklch(0.97 0 0)",
  "sidebar-accent-foreground": "oklch(0.205 0 0)",
  "sidebar-border": "oklch(0.922 0 0)",
  "sidebar-ring": "oklch(0.708 0 0)",
};

// eslint-disable-next-line
export const DARK_COLORS: Record<ThemeColorVar, string> = {
  background: "oklch(0.145 0 0)",
  foreground: "oklch(0.985 0 0)",
  card: "oklch(0.205 0 0)",
  "card-foreground": "oklch(0.985 0 0)",
  popover: "oklch(0.205 0 0)",
  "popover-foreground": "oklch(0.985 0 0)",
  primary: "oklch(0.922 0 0)",
  "primary-foreground": "oklch(0.205 0 0)",
  secondary: "oklch(0.269 0 0)",
  "secondary-foreground": "oklch(0.985 0 0)",
  muted: "oklch(0.269 0 0)",
  "muted-foreground": "oklch(0.708 0 0)",
  accent: "oklch(0.269 0 0)",
  "accent-foreground": "oklch(0.985 0 0)",
  destructive: "oklch(0.704 0.191 22.216)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  ring: "oklch(0.556 0 0)",
  sidebar: "oklch(0.205 0 0)",
  "sidebar-foreground": "oklch(0.985 0 0)",
  "sidebar-primary": "oklch(0.488 0.243 264.376)",
  "sidebar-primary-foreground": "oklch(0.985 0 0)",
  "sidebar-accent": "oklch(0.269 0 0)",
  "sidebar-accent-foreground": "oklch(0.985 0 0)",
  "sidebar-border": "oklch(1 0 0 / 10%)",
  "sidebar-ring": "oklch(0.556 0 0)",
};

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

export type ThemePreset = {
  id: string;
  name: string;
  colors: ThemeColors;
  fontFamily: string;
  fontSize: number;
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
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  importPreset: (preset: Omit<ThemePreset, "id">) => void;
};

export const DEFAULT_THEME: Theme = "system";
export const DEFAULT_FONT_FAMILY = "";
export const DEFAULT_FONT_SIZE = 16;

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  resolvedBase: "light",
  colors: {},
  setColor: () => null,
  resetColors: () => null,
  fontFamily: "",
  setFontFamily: () => null,
  fontSize: DEFAULT_FONT_SIZE,
  setFontSize: () => null,
  presets: [],
  activePresetId: null,
  savePreset: () => null,
  applyPreset: () => null,
  deletePreset: () => null,
  importPreset: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme,
  );
  const [colors, setColors] = useState<ThemeColors>(() =>
    readJSON(`${storageKey}-colors`, {}),
  );
  const [fontFamily, setFontFamilyState] = useState<string>(
    () => localStorage.getItem(`${storageKey}-font-family`) ?? "",
  );
  const [fontSize, setFontSizeState] = useState<number>(
    () =>
      Number(localStorage.getItem(`${storageKey}-font-size`)) ||
      DEFAULT_FONT_SIZE,
  );
  const [presets, setPresets] = useState<ThemePreset[]>(() =>
    readJSON(`${storageKey}-presets`, []),
  );
  const [activePresetId, setActivePresetId] = useState<string | null>(() =>
    localStorage.getItem(`${storageKey}-active-preset`),
  );
  const [resolvedBase, setResolvedBase] = useState<"light" | "dark">("light");
  const lastBaseRef = useRef<"light" | "dark">(
    localStorage.getItem(`${storageKey}-last-base`) === "dark"
      ? "dark"
      : "light",
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    let base: "light" | "dark";
    if (theme === "custom") {
      // custom keeps whatever base was active before switching to it
      base = lastBaseRef.current;
    } else {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      base = theme === "light" || theme === "dark" ? theme : systemTheme;
      lastBaseRef.current = base;
      localStorage.setItem(`${storageKey}-last-base`, base);
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
  }, [theme, colors, storageKey]);

  useEffect(() => {
    document.body.style.fontFamily = fontFamily || "";
  }, [fontFamily]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  const clearActivePreset = () => {
    localStorage.removeItem(`${storageKey}-active-preset`);
    setActivePresetId(null);
  };

  const value: ThemeProviderState = {
    theme,
    setTheme: (next) => {
      localStorage.setItem(storageKey, next);
      setThemeState(next);
      clearActivePreset();

      // discard overrides so they don't resurface if custom is picked again
      if (next !== "custom") {
        localStorage.removeItem(`${storageKey}-colors`);
        setColors({});
      }
    },
    resolvedBase,
    colors,
    setColor: (variable, colorValue) => {
      const next = { ...colors, [variable]: colorValue };
      localStorage.setItem(`${storageKey}-colors`, JSON.stringify(next));
      localStorage.setItem(storageKey, "custom");
      setColors(next);
      setThemeState("custom");
      clearActivePreset();
    },
    resetColors: () => {
      localStorage.removeItem(`${storageKey}-colors`);
      setColors({});
      clearActivePreset();
    },
    fontFamily,
    setFontFamily: (next) => {
      localStorage.setItem(`${storageKey}-font-family`, next);
      setFontFamilyState(next);
      clearActivePreset();
    },
    fontSize,
    setFontSize: (next) => {
      localStorage.setItem(`${storageKey}-font-size`, String(next));
      setFontSizeState(next);
      clearActivePreset();
    },
    presets,
    activePresetId,
    savePreset: (name) => {
      const basePalette = resolvedBase === "dark" ? DARK_COLORS : LIGHT_COLORS;
      const preset: ThemePreset = {
        id: crypto.randomUUID(),
        name,
        colors: { ...basePalette, ...colors },
        fontFamily,
        fontSize,
      };
      const next = [...presets, preset];
      localStorage.setItem(`${storageKey}-presets`, JSON.stringify(next));
      setPresets(next);
    },
    applyPreset: (id) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;

      localStorage.setItem(
        `${storageKey}-colors`,
        JSON.stringify(preset.colors),
      );
      localStorage.setItem(storageKey, "custom");
      localStorage.setItem(`${storageKey}-font-family`, preset.fontFamily);
      localStorage.setItem(`${storageKey}-font-size`, String(preset.fontSize));
      setColors(preset.colors);
      setThemeState("custom");
      setFontFamilyState(preset.fontFamily);
      setFontSizeState(preset.fontSize);
      localStorage.setItem(`${storageKey}-active-preset`, id);
      setActivePresetId(id);
    },
    deletePreset: (id) => {
      const next = presets.filter((p) => p.id !== id);
      localStorage.setItem(`${storageKey}-presets`, JSON.stringify(next));
      setPresets(next);
      if (activePresetId === id) clearActivePreset();
    },
    importPreset: (preset) => {
      const next = [...presets, { ...preset, id: crypto.randomUUID() }];
      localStorage.setItem(`${storageKey}-presets`, JSON.stringify(next));
      setPresets(next);
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
