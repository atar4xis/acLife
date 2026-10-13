import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { EVENT_COLOR_FALLBACK } from "@/context/CalendarSettingsContext";
import { useTheme } from "@/components/ThemeProvider";
import { useSetting } from "@/hooks/useSetting";
import { useDragReorder } from "@/hooks/useDragReorder";
import { DARK_COLORS, LIGHT_COLORS } from "@/lib/themeColors";
import { cn, cssColorToHex } from "@/lib/utils";
import {
  generateThemeColorPresets,
  MAX_COLOR_PRESETS,
} from "@/lib/colorPresets";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ResetToDefault from "./ResetToDefault";
import { settingLabelByKey, settingLabelId } from "./settingsData";
import SettingsLabel from "./SettingsLabel";
import SyncToggle from "./SyncToggle";
import { useTranslation } from "react-i18next";

export default function ColorPresetsSettings({
  presetsKey,
  autoKey,
}: {
  presetsKey: "eventColorPresets" | "journalColorPresets";
  autoKey: "addColorsAutomatically" | "journalAddColorsAutomatically";
}) {
  const { t } = useTranslation();
  const presets = useSetting(presetsKey);
  const auto = useSetting(autoKey);
  const { resolvedBase, colors } = useTheme();
  const [newColor, setNewColor] = useState(EVENT_COLOR_FALLBACK);

  const isDefaultPresets =
    presets.value.length === presets.defaultValue.length &&
    presets.value.every(
      (color, i) =>
        color.toLowerCase() === presets.defaultValue[i].toLowerCase(),
    );

  const generateFromTheme = () => {
    const basePalette = resolvedBase === "dark" ? DARK_COLORS : LIGHT_COLORS;
    const brandColors = (["primary", "accent", "secondary"] as const).map(
      (variable) => cssColorToHex(colors[variable] ?? basePalette[variable]),
    );
    presets.set(generateThemeColorPresets(brandColors, resolvedBase));
    toast.success(t("settings.calendar.colorsGenerated"));
  };

  const isDuplicate = presets.value.some(
    (presetColor) => presetColor.toLowerCase() === newColor.toLowerCase(),
  );
  const isLimitReached = presets.value.length >= MAX_COLOR_PRESETS;

  const addColor = () => {
    if (isDuplicate || isLimitReached) return;
    presets.set([...presets.value, newColor]);
  };

  const removeColor = (index: number) => {
    presets.set(presets.value.filter((_, i) => i !== index));
  };

  const {
    order: orderedColorPresets,
    dragIndex,
    onPointerDown,
    onKeyDown,
    setItemRef,
  } = useDragReorder(presets.value, presets.set);

  return (
    <>
      <FieldGroup className="mb-2 gap-4">
        <Field orientation="responsive" className="min-h-9">
          <FieldContent>
            <div className="flex items-center gap-1.5">
              <FieldTitle>{settingLabelByKey(presetsKey)}</FieldTitle>
              <SyncToggle settingKey={presetsKey} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5 text-muted-foreground hover:text-foreground"
                    aria-label={t("settings.calendar.generate")}
                    onClick={generateFromTheme}
                  >
                    <Sparkles className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("settings.calendar.generate")}
                </TooltipContent>
              </Tooltip>
              {!isDefaultPresets && (
                <ResetToDefault
                  onClick={() => presets.set(presets.defaultValue)}
                />
              )}
            </div>
            <FieldDescription>
              {t("settings.calendar.colorsHelp")}
            </FieldDescription>
          </FieldContent>

          <div className="flex items-center gap-2">
            <ColorPicker
              aria-label={t("settings.calendar.newColor")}
              value={newColor}
              onChange={setNewColor}
            />
            {isDuplicate || isLimitReached ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* eslint-disable-next-line */}
                  <span tabIndex={0}>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("settings.calendar.addColor")}
                      disabled
                    >
                      <Plus />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {isLimitReached
                    ? t("settings.calendar.colorLimit", {
                        count: MAX_COLOR_PRESETS,
                      })
                    : t("settings.calendar.alreadyAdded")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("settings.calendar.addColor")}
                onClick={addColor}
              >
                <Plus />
              </Button>
            )}
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          {orderedColorPresets.map((presetColor, index) => (
            <Tooltip key={presetColor}>
              <TooltipTrigger asChild>
                <button
                  ref={setItemRef(index)}
                  type="button"
                  aria-label={t("settings.calendar.remove", {
                    name: presetColor,
                  })}
                  aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
                  onPointerDown={onPointerDown(index, () => removeColor(index))}
                  onKeyDown={(e) => {
                    onKeyDown(index)(e);
                    if (["Enter", " ", "Delete", "Backspace"].includes(e.key)) {
                      e.preventDefault();
                      removeColor(index);
                    }
                  }}
                  className={cn(
                    "size-8 cursor-pointer rounded border opacity-90 hover:opacity-100",
                    dragIndex === index && "opacity-40",
                  )}
                  style={{ background: presetColor, touchAction: "none" }}
                />
              </TooltipTrigger>
              <TooltipContent>{presetColor}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </FieldGroup>

      <Field orientation="responsive" className="min-h-9">
        <SettingsLabel settingKey={autoKey} />
        <Switch
          aria-labelledby={settingLabelId(autoKey)}
          checked={auto.value}
          onCheckedChange={auto.set}
        />
      </Field>
    </>
  );
}
