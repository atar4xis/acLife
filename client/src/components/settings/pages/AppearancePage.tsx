import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  GripVertical,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import {
  DARK_COLORS,
  LIGHT_COLORS,
  THEME_COLOR_VARS,
  type ThemeColorVar,
} from "@/lib/themeColors";
import type { Theme, ThemeColors, ThemePreset } from "@/types/Theme";
import { useDragReorder } from "@/hooks/useDragReorder";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BUILT_IN_THEMES, BUILT_IN_THEME_ID_PREFIX } from "../builtInThemes";
import { sectionLabel, settingLabel, settingLabelId } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import SettingsLabel from "../SettingsLabel";
import SyncToggle from "../SyncToggle";
import SettingsSelect from "../SettingsSelect";

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
  sidebar: "Background",
  "sidebar-foreground": "Text",
  "sidebar-primary": "Primary",
  "sidebar-primary-foreground": "Primary text",
  "sidebar-accent": "Accent",
  "sidebar-accent-foreground": "Accent text",
  "sidebar-border": "Border",
  "sidebar-ring": "Ring",
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
      (data.base !== undefined &&
        data.base !== "light" &&
        data.base !== "dark") ||
      typeof data.fontFamily !== "string" ||
      typeof data.fontSize !== "number" ||
      !isThemeColors(data.colors)
    ) {
      return null;
    }

    return {
      name: data.name,
      base: data.base,
      colors: data.colors,
      fontFamily: data.fontFamily,
      fontSize: data.fontSize,
    };
  } catch {
    return null;
  }
}

function downloadPreset(preset: ThemePreset) {
  const { name, base, colors, fontFamily, fontSize } = preset;
  const blob = new Blob(
    [JSON.stringify({ name, base, colors, fontFamily, fontSize }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.trim().replace(/[^a-z0-9-_]+/gi, "-") || "theme-preset"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const THEMES_PER_PAGE = 5;

function stripes(colors: ThemeColors) {
  const unique = [...new Set(Object.values(colors))];
  const step = 100 / unique.length;
  const stops = unique.map(
    (c, i) => `${c} ${i * step}%, ${c} ${(i + 1) * step}%`,
  );
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const PresetsList = memo(function PresetsList() {
  const {
    presets,
    activePresetId,
    savePreset,
    applyPreset,
    deletePreset,
    renamePreset,
    reorderPresets,
    importPreset,
  } = useTheme();
  const [presetName, setPresetName] = useState("");
  const [page, setPage] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const skipRenameCommit = useRef(false);
  // the click after a drag lands on the row, not the handle, so block it
  const suppressApply = useRef(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pageCount = Math.max(1, Math.ceil(presets.length / THEMES_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * THEMES_PER_PAGE;
  const pagePresets = useMemo(
    () => presets.slice(pageStart, pageStart + THEMES_PER_PAGE),
    [presets, pageStart],
  );

  // reordering is scoped to the visible page
  const {
    order: orderedPagePresets,
    dragIndex,
    onPointerDown,
    onKeyDown,
    setItemRef,
  } = useDragReorder(pagePresets, (next) =>
    reorderPresets([
      ...presets.slice(0, pageStart),
      ...next,
      ...presets.slice(pageStart + THEMES_PER_PAGE),
    ]),
  );

  const commitRename = () => {
    const name = renameDraft.trim();
    if (renamingId && name) {
      if (presets.some((p) => p.id !== renamingId && p.name === name)) {
        toast.error("A theme with that name already exists.");
      } else {
        renamePreset(renamingId, name);
      }
    }
    setRenamingId(null);
  };

  const nameExists = presets.some((p) => p.name === presetName.trim());

  const handleSave = () => {
    const name = presetName.trim();
    if (!name) return;

    savePreset(name);
    setPresetName("");
    toast.success(nameExists ? "Theme updated." : "Theme saved.");
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFiles = async (files: File[]) => {
    for (const file of files) {
      const parsed = parsePresetFile(await file.text());
      if (!parsed) {
        toast.error(`Invalid theme file: ${file.name}`);
        continue;
      }

      importPreset(parsed);
      toast.success(`Imported theme "${parsed.name}".`);
    }
  };

  return (
    <div className="flex flex-col gap-4" id="presets-list">
      <div className="flex items-center gap-1.5">
        <FieldTitle>{settingLabel("presets-list")}</FieldTitle>
        <SyncToggle settingKey="presets" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 gap-2">
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Theme name"
            aria-label="Theme name"
            className="max-w-[320px] flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!presetName.trim()}
            onClick={handleSave}
          >
            {nameExists ? "Overwrite" : "Save"}
          </Button>
        </div>

        <Button type="button" variant="outline" onClick={handleImportClick}>
          <Upload /> Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Import theme file"
          accept="application/json"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) handleImportFiles(files);
          }}
        />
      </div>

      {presets.length === 0 ? (
        <FieldDescription>No saved themes yet.</FieldDescription>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {orderedPagePresets.map((item, index) => {
              const isActive = item.id === activePresetId;
              return (
                <div
                  key={item.id}
                  ref={setItemRef(index)}
                  role={isActive ? undefined : "button"}
                  tabIndex={isActive ? undefined : 0}
                  onClick={
                    isActive
                      ? undefined
                      : () => !suppressApply.current && applyPreset(item)
                  }
                  onKeyDown={
                    isActive
                      ? undefined
                      : (e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            applyPreset(item);
                          }
                        }
                  }
                  className={`group relative flex items-center justify-between gap-3 overflow-hidden rounded-md border border-muted p-2 transition-opacity ${
                    dragIndex === index ? "opacity-40" : ""
                  } ${
                    isActive
                      ? "border-primary bg-primary/5"
                      : "cursor-pointer hover:bg-accent"
                  }`}
                >
                  {previewEnabled && !isActive && item.colors && (
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-75"
                      style={{ background: stripes(item.colors) }}
                    />
                  )}
                  <div
                    className="relative flex min-w-0 items-center gap-1.5 rounded bg-background/80 pr-1.5"
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      style={{ touchAction: "none" }}
                      aria-label="Reorder theme"
                      aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
                      onKeyDown={onKeyDown(index)}
                      className="text-muted-foreground cursor-grab px-1 py-1 active:cursor-grabbing"
                      onPointerDown={(e) => {
                        suppressApply.current = true;
                        window.addEventListener(
                          "pointerup",
                          () =>
                            setTimeout(() => (suppressApply.current = false)),
                          { once: true },
                        );
                        onPointerDown(index)(e);
                      }}
                    >
                      <GripVertical className="size-4" />
                    </button>
                    {renamingId === item.id ? (
                      <Input
                        autoFocus
                        aria-label="Rename theme"
                        value={renameDraft}
                        className="h-6 w-[200px] px-1.5 py-0 text-sm"
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => {
                          if (skipRenameCommit.current) {
                            skipRenameCommit.current = false;
                            return;
                          }
                          commitRename();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") {
                            skipRenameCommit.current = true;
                            setRenamingId(null);
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="truncate text-sm font-medium"
                        onDoubleClick={() => {
                          setRenameDraft(item.name);
                          setRenamingId(item.id);
                        }}
                      >
                        {item.name}
                      </span>
                    )}
                  </div>
                  <div
                    className="relative flex items-center gap-0.5 rounded bg-background/80"
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isActive && (
                      <span className="px-2 text-xs text-muted-foreground">
                        Active
                      </span>
                    )}
                    <IconAction
                      label="Rename theme"
                      onClick={() => {
                        setRenameDraft(item.name);
                        setRenamingId(item.id);
                      }}
                    >
                      <Pencil />
                    </IconAction>
                    <IconAction
                      label="Export as .json"
                      onClick={() => downloadPreset(item)}
                    >
                      <Download />
                    </IconAction>
                    <IconAction
                      label="Delete theme"
                      onClick={() => deletePreset(item.id)}
                    >
                      <Trash2 />
                    </IconAction>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="gap-2 font-normal">
              <Checkbox
                checked={previewEnabled}
                onCheckedChange={(c) => setPreviewEnabled(!!c)}
              />
              Preview
            </Label>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Previous page"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-muted-foreground text-sm">
                  {currentPage + 1} / {pageCount}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Next page"
                  disabled={currentPage === pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

const CUSTOM_THEMES = [...BUILT_IN_THEMES]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((theme) => ({
    ...theme,
    id: `${BUILT_IN_THEME_ID_PREFIX}${theme.slug}`,
  }));

const CUSTOM_THEME_GROUPS = [
  { label: "Dark", themes: CUSTOM_THEMES.filter((t) => t.category === "dark") },
  {
    label: "Light",
    themes: CUSTOM_THEMES.filter((t) => t.category === "light"),
  },
];

const customThemeCache = new Map<string, Omit<ThemePreset, "id">>();

const CustomThemeField = memo(function CustomThemeField() {
  const { activePresetId, applyPreset } = useTheme();
  const value = CUSTOM_THEMES.find((t) => t.id === activePresetId)?.id ?? "";

  const handleChange = async (id: string) => {
    const theme = CUSTOM_THEMES.find((t) => t.id === id);
    if (!theme) return;

    try {
      let parsed = customThemeCache.get(id);
      if (!parsed) {
        const res = await fetch(
          `${import.meta.env.BASE_URL}themes/${theme.slug}.json`,
        );
        parsed = (res.ok && parsePresetFile(await res.text())) || undefined;
        if (!parsed) throw new Error("invalid theme");

        customThemeCache.set(id, parsed);
      }

      applyPreset({ ...parsed, id });
    } catch {
      toast.error(`Failed to load theme "${theme.name}".`);
    }
  };

  return (
    <Field orientation="responsive">
      <FieldTitle id="custom-theme-label">
        {settingLabel("custom-theme")}
      </FieldTitle>
      <SettingsSelect
        labelledBy="custom-theme-label"
        value={value}
        onValueChange={handleChange}
        placeholder="None"
      >
        {CUSTOM_THEME_GROUPS.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel className="text-sm">{group.label} themes</SelectLabel>
            {group.themes.map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SettingsSelect>
    </Field>
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
      <SettingsLabel settingKey="theme" />
      <ToggleGroup
        aria-labelledby={settingLabelId("theme")}
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
        <SettingsLabel settingKey="fontFamily" onReset={field.cancel} />
        <Input
          aria-labelledby={settingLabelId("fontFamily")}
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
          <SettingsLabel settingKey="fontSize" />
          <span className="text-muted-foreground text-sm">
            {fontSizeSlider.value}px
          </span>
        </div>
      </FieldContent>
      <Slider
        aria-labelledby={settingLabelId("fontSize")}
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

const GENERAL_COLOR_VARS = THEME_COLOR_VARS.filter(
  (variable) => !variable.startsWith("sidebar"),
);
const SIDEBAR_COLOR_VARS = THEME_COLOR_VARS.filter((variable) =>
  variable.startsWith("sidebar"),
);

function ColorGridItem({ variable }: { variable: ThemeColorVar }) {
  const { resolvedBase, colors, setColor } = useTheme();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <ColorPicker
        aria-label={COLOR_LABELS[variable]}
        className="size-8 shrink-0 p-0"
        value={currentColorValue(variable, resolvedBase, colors[variable])}
        onChange={(value) => {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setColor(variable, value), 200);
        }}
      />
      <FieldTitle className="truncate">{COLOR_LABELS[variable]}</FieldTitle>
    </div>
  );
}

function ColorGrid({ variables }: { variables: ThemeColorVar[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-3">
      {variables.map((variable) => (
        <ColorGridItem key={variable} variable={variable} />
      ))}
    </div>
  );
}

const ColorsSection = memo(function ColorsSection({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { theme, resetColors } = useTheme();

  return (
    <Section
      id="colors"
      label={sectionLabel("colors")}
      sectionRefs={sectionRefs}
      action={
        <div className="flex items-center gap-2">
          <SyncToggle settingKey="colors" />
          {theme === "custom" && (
            <button
              type="button"
              onClick={resetColors}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Reset
            </button>
          )}
        </div>
      }
    >
      <ColorGrid variables={GENERAL_COLOR_VARS} />
      <div className="text-muted-foreground text-sm font-medium">Sidebar</div>
      <ColorGrid variables={SIDEBAR_COLOR_VARS} />
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
        <CustomThemeField />
      </Section>

      <Separator />
      <PresetsList />

      <Separator />

      <Section id="font" label={sectionLabel("font")} sectionRefs={sectionRefs}>
        <FontFamilyField />
        <FontSizeField />
      </Section>

      <Separator />

      <ColorsSection sectionRefs={sectionRefs} />
    </FieldGroup>
  );
}
