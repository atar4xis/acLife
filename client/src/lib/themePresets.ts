import { MAX_PRESETS } from "@/lib/constants";
import type { ThemePreset } from "@/types/Theme";

export type PresetResult = "ok" | "limit" | "too-large";

export const MAX_PRESET_BYTES = 2048;

export const PRESET_ERROR_MESSAGES: Record<
  Exclude<PresetResult, "ok">,
  string
> = {
  limit: `You can save up to ${MAX_PRESETS} themes.`,
  "too-large": `A theme can be at most ${MAX_PRESET_BYTES / 1024} KB.`,
};

const UUID_LENGTH = 36;

// size of the preset as stored, including the id it gets on save
export function presetBytes(preset: Omit<ThemePreset, "id">): number {
  const json = JSON.stringify({ id: "x".repeat(UUID_LENGTH), ...preset });
  return new TextEncoder().encode(json).length;
}

export const fitsPresetLimit = (preset: Omit<ThemePreset, "id">) =>
  presetBytes(preset) <= MAX_PRESET_BYTES;
