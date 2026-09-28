import { memo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Download, Trash2, Upload } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DARK_COLORS,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  LIGHT_COLORS,
  THEME_COLOR_VARS,
  useTheme,
  type Theme,
  type ThemeColorVar,
  type ThemeColors,
  type ThemePreset,
} from "@/components/ThemeProvider";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useDeferredSliderValue } from "@/hooks/useDeferredSliderValue";
import { cssColorToHex } from "@/lib/utils";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ResetToDefault from "../ResetToDefault";
import { sectionLabel, settingLabel } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
  { value: "custom", label: "Custom" },
];

const COLOR_LABELS: Record<ThemeColorVar, string> = {
  background: "Background",
  foreground: "Foreground",
  card: "Card",
  "card-foreground": "Card text",
  popover: "Popover",
  "popover-foreground": "Popover text",
  primary: "Primary",
  "primary-foreground": "Primary text",
  secondary: "Secondary",
  "secondary-foreground": "Secondary text",
  muted: "Muted",
  "muted-foreground": "Muted text",
  accent: "Accent",
  "accent-foreground": "Accent text",
  destructive: "Destructive",
  border: "Border",
  input: "Input",
  ring: "Ring",
  sidebar: "Sidebar background",
  "sidebar-foreground": "Sidebar text",
  "sidebar-primary": "Sidebar primary",
  "sidebar-primary-foreground": "Sidebar primary text",
  "sidebar-accent": "Sidebar accent",
  "sidebar-accent-foreground": "Sidebar accent text",
  "sidebar-border": "Sidebar border",
  "sidebar-ring": "Sidebar ring",
};

function isThemeColors(value: unknown): value is ThemeColors {
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value).every(
    ([key, val]) =>
      THEME_COLOR_VARS.includes(key as ThemeColorVar) &&
      typeof val === "string",
  );
}

function parsePresetFile(text: string): Omit<ThemePreset, "id"> | null {
  try {
    const data = JSON.parse(text);
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.name !== "string" ||
      typeof data.fontFamily !== "string" ||
      typeof data.fontSize !== "number" ||
      !isThemeColors(data.colors)
    ) {
      return null;
    }

    return {
      name: data.name,
      colors: data.colors,
      fontFamily: data.fontFamily,
      fontSize: data.fontSize,
    };
  } catch {
    return null;
  }
}

function downloadPreset(preset: ThemePreset) {
  const { name, colors, fontFamily, fontSize } = preset;
  const blob = new Blob(
    [JSON.stringify({ name, colors, fontFamily, fontSize }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.trim().replace(/[^a-z0-9-_]+/gi, "-") || "theme-preset"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const PresetsSection = memo(function PresetsSection({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const {
    presets,
    activePresetId,
    savePreset,
    applyPreset,
    deletePreset,
    importPreset,
  } = useTheme();
  const [presetName, setPresetName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const name = presetName.trim();
    if (!name) return;

    savePreset(name);
    setPresetName("");
    toast.success("Theme saved.");
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (file: File) => {
    const parsed = parsePresetFile(await file.text());
    if (!parsed) {
      toast.error("Invalid theme file.");
      return;
    }

    importPreset(parsed);
    toast.success(`Imported theme "${parsed.name}".`);
  };

  return (
    <Section
      id="presets"
      label={sectionLabel("presets")}
      sectionRefs={sectionRefs}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 gap-2">
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Theme name"
            className="max-w-[320px] flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!presetName.trim()}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>

        <Button type="button" variant="outline" onClick={handleImportClick}>
          <Upload /> Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleImportFile(file);
          }}
        />
      </div>

      {presets.length === 0 ? (
        <FieldDescription>No saved themes yet.</FieldDescription>
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map((preset) => {
            const isActive = preset.id === activePresetId;
            return (
              <div
                key={preset.id}
                className={`flex items-center justify-between gap-4 rounded-md border p-3 ${
                  isActive ? "border-primary bg-primary/5" : ""
                }`}
              >
                <span className="text-sm font-medium">{preset.name}</span>
                <div className="flex items-center gap-1">
                  {isActive ? (
                    <span className="px-2 text-xs text-muted-foreground">
                      Active
                    </span>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => applyPreset(preset.id)}
                        >
                          <Check />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Apply theme</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => downloadPreset(preset)}
                      >
                        <Download />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export as .json</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => deletePreset(preset.id)}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete theme</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
});

function currentColorValue(
  variable: ThemeColorVar,
  base: "light" | "dark",
  override?: string,
) {
  if (override) return cssColorToHex(override);

  const palette = base === "dark" ? DARK_COLORS : LIGHT_COLORS;
  return cssColorToHex(palette[variable]);
}

const ThemeModeField = memo(function ThemeModeField() {
  const { theme, setTheme } = useTheme();

  return (
    <Field orientation="responsive">
      <div className="flex flex-auto items-center gap-1.5">
        <FieldTitle>{settingLabel("theme-mode")}</FieldTitle>
        {theme !== DEFAULT_THEME && (
          <ResetToDefault onClick={() => setTheme(DEFAULT_THEME)} />
        )}
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        value={theme}
        onValueChange={(value) => value && setTheme(value as Theme)}
      >
        {THEME_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
});

const FontFamilyField = memo(function FontFamilyField() {
  const { fontFamily, setFontFamily } = useTheme();
  const field = useDebouncedSetting(fontFamily, setFontFamily);

  return (
    <div className="flex flex-col gap-1.5">
      <Field orientation="responsive">
        <div className="flex flex-auto items-center gap-1.5">
          <FieldTitle>{settingLabel("font-family")}</FieldTitle>
          {fontFamily !== DEFAULT_FONT_FAMILY && (
            <ResetToDefault
              onClick={() => {
                field.cancel();
                setFontFamily(DEFAULT_FONT_FAMILY);
              }}
            />
          )}
        </div>
        <Input
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.flush}
          placeholder="System default"
          className="w-[220px]"
        />
      </Field>
    </div>
  );
});

const FontSizeField = memo(function FontSizeField() {
  const { fontSize, setFontSize } = useTheme();
  const fontSizeSlider = useDeferredSliderValue(fontSize, setFontSize);

  return (
    <Field>
      <FieldContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <FieldTitle>{settingLabel("font-size")}</FieldTitle>
            {fontSize !== DEFAULT_FONT_SIZE && (
              <ResetToDefault onClick={() => setFontSize(DEFAULT_FONT_SIZE)} />
            )}
          </div>
          <span className="text-muted-foreground text-sm">
            {fontSizeSlider.value}px
          </span>
        </div>
      </FieldContent>
      <Slider
        className="mt-1"
        min={12}
        max={20}
        step={1}
        value={[fontSizeSlider.value]}
        onValueChange={fontSizeSlider.onValueChange}
        onValueCommit={fontSizeSlider.onValueCommit}
      />
    </Field>
  );
});

const ColorsSection = memo(function ColorsSection({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { theme, resolvedBase, colors, setColor, resetColors } = useTheme();

  return (
    <Section
      id="colors"
      label={sectionLabel("colors")}
      sectionRefs={sectionRefs}
      action={
        theme === "custom" && (
          <button
            type="button"
            onClick={resetColors}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Reset
          </button>
        )
      }
    >
      {THEME_COLOR_VARS.map((variable) => (
        <Field key={variable} orientation="responsive">
          <FieldTitle>{COLOR_LABELS[variable]}</FieldTitle>
          <ColorPicker
            value={currentColorValue(variable, resolvedBase, colors[variable])}
            onChange={(value) => setColor(variable, value)}
          />
        </Field>
      ))}
    </Section>
  );
});

export default function AppearancePage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">Appearance</h2>

      <Section
        id="theme"
        label={sectionLabel("theme")}
        sectionRefs={sectionRefs}
      >
        <ThemeModeField />
      </Section>

      <Separator />

      <Section id="font" label={sectionLabel("font")} sectionRefs={sectionRefs}>
        <FontFamilyField />
        <FontSizeField />
      </Section>

      <Separator />

      <ColorsSection sectionRefs={sectionRefs} />

      <Separator />

      <PresetsSection sectionRefs={sectionRefs} />
    </FieldGroup>
  );
}
