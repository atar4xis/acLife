type ThemeCategory = "dark" | "light";

const category = (category: ThemeCategory) => (slug: string, name: string) => ({
  slug,
  name,
  category,
});

const dark = category("dark");
const light = category("light");

// theme json files live in public/themes/<slug>.json and load when applied
export const BUILT_IN_THEMES = [
  light("catppuccin-latte", "Catppuccin Latte"),
  dark("catppuccin-frappe", "Catppuccin Frappé"),
  dark("catppuccin-macchiato", "Catppuccin Macchiato"),
  dark("catppuccin-mocha", "Catppuccin Mocha"),
  dark("dracula", "Dracula"),
  dark("tokyo-night", "Tokyo Night"),
  dark("nord", "Nord"),
  dark("gruvbox", "Gruvbox"),
  dark("solarized", "Solarized"),
  dark("one-dark", "One"),
  dark("rose-pine", "Rosé Pine"),
  dark("everforest", "Everforest"),
  dark("ayu", "Ayu"),
  dark("night-owl", "Night Owl"),
  dark("kanagawa", "Kanagawa"),
  dark("synthwave-84", "SynthWave '84"),
  light("dracula-light", "Dracula"),
  light("tokyo-night-day", "Tokyo Night"),
  light("gruvbox-light", "Gruvbox"),
  light("solarized-light", "Solarized"),
  light("one-light", "One"),
  light("rose-pine-dawn", "Rosé Pine"),
  light("everforest-light", "Everforest"),
  light("ayu-light", "Ayu"),
  light("night-owl-light", "Night Owl"),
  light("kanagawa-lotus", "Kanagawa"),
];

export const BUILT_IN_THEME_ID_PREFIX = "builtin:";
