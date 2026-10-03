import { MAX_PRESETS } from "@/lib/constants";
import type { ThemePreset } from "@/types/Theme";
import { t } from "@/i18n";

export type PresetResult = "ok" | "limit" | "too-large";

export const MAX_PRESET_BYTES = 2048;

export const presetErrorMessage = (result: Exclude<PresetResult, "ok">) =>
  result === "limit"
    ? t("settings.themes.limit", { count: MAX_PRESETS })
    : t("settings.themes.tooLarge", { size: MAX_PRESET_BYTES / 1024 });

const UUID_LENGTH = 36;

// size of the preset as stored, including the id it gets on save
export function presetBytes(preset: Omit<ThemePreset, "id">): number {
  const json = JSON.stringify({ id: "x".repeat(UUID_LENGTH), ...preset });
  return new TextEncoder().encode(json).length;
}

export const fitsPresetLimit = (preset: Omit<ThemePreset, "id">) =>
  presetBytes(preset) <= MAX_PRESET_BYTES;
