import type { ThemeColorVar } from "@/lib/themeColors";

export type Theme = "dark" | "light" | "system" | "custom";

export type ThemeColors = Partial<Record<ThemeColorVar, string>>;

export type ThemePreset = {
  id: string;
  name: string;
  base?: "light" | "dark";
  colors: ThemeColors;
  fontFamily: string;
  fontSize: number;
};
