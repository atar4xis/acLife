import { useState } from "react";
import ResetToDefault from "@/components/settings/ResetToDefault";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldTitle } from "@/components/ui/field";
import { IconPicker } from "@/components/ui/icon-picker";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useJournalActions } from "@/context/JournalContext";
import { useJournalSettings } from "@/context/JournalSettingsContext";
import {
  itemIconName,
  colorChanged,
  itemStyle,
  MAX_JOURNAL_NAME_LENGTH,
} from "@/lib/journal/item";
import { addColorPreset } from "@/lib/colorPresets";
import { defaultJournalSettings } from "@/lib/settingsDefaults";
import type { JournalItem } from "@/types/Journal";
import { useTranslation } from "react-i18next";

function Row({
  label,
  changed,
  onReset,
  children,
}: {
  label: string;
  changed?: boolean;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <FieldTitle>
        {label}
        {changed && onReset && <ResetToDefault onClick={onReset} />}
      </FieldTitle>
      {children}
    </div>
  );
}

export default function CustomizeDialog({
  item,
  onClose,
}: {
  item: JournalItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { customizeItem } = useJournalActions();

  const settings = useJournalSettings();
  const isFolder = item.type === "folder";
  const defaults = {
    icon: isFolder ? settings.journalFolderIcon : settings.journalNoteIcon,
    useForeground: settings.journalForegroundEnabled,
    foreground: settings.journalForeground,
    useBackground: settings.journalBackgroundEnabled,
    background: settings.journalBackground,
    colorIcon: settings.journalColorIcons,
  };

  const [name, setName] = useState(item.name);
  const [icon, setIcon] = useState(itemIconName(item, false));
  const [useForeground, setUseForeground] = useState(!!item.color);
  const [foreground, setForeground] = useState(
    item.color ?? defaultJournalSettings.journalForeground,
  );
  const [useBackground, setUseBackground] = useState(!!item.background);
  const [background, setBackground] = useState(
    item.background ?? defaultJournalSettings.journalBackground,
  );
  const [colorIcon, setColorIcon] = useState(item.colorIcon ?? true);

  const iconLabel = t(
    isFolder
      ? "settings.items.journal-folder-icons"
      : "settings.items.journal-note-icon",
  );

  const save = () => {
    const style = itemStyle(item.type, {
      ...defaultJournalSettings,
      journalNoteIcon: icon,
      journalFolderIcon: icon,
      journalForegroundEnabled: useForeground,
      journalForeground: foreground,
      journalBackgroundEnabled: useBackground,
      journalBackground: background,
      journalColorIcons: colorIcon,
    });
    const nextName = name.trim() || item.name;
    const changed =
      nextName !== item.name ||
      style.icon !== item.icon ||
      style.color !== item.color ||
      style.background !== item.background ||
      style.colorIcon !== item.colorIcon;

    if (changed) customizeItem(item.id, nextName, style);

    if (settings.journalAddColorsAutomatically) {
      const presets = [style.color, style.background].reduce(
        (acc, color) => (color ? addColorPreset(acc, color) : acc),
        settings.journalColorPresets,
      );
      if (presets !== settings.journalColorPresets) {
        settings.setSetting("journalColorPresets", presets);
      }
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("journal.customize")}</DialogTitle>
          </DialogHeader>

          <Row label={t("settings.items.journal-note-name")}>
            <Input
              aria-label={t("settings.items.journal-note-name")}
              value={name}
              maxLength={MAX_JOURNAL_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              className="w-55"
            />
          </Row>

          <Row
            label={iconLabel}
            changed={icon !== defaults.icon}
            onReset={() => setIcon(defaults.icon)}
          >
            <IconPicker
              aria-label={iconLabel}
              value={icon}
              onChange={setIcon}
            />
          </Row>

          <Row
            label={t("settings.items.journal-foreground")}
            changed={colorChanged(
              useForeground,
              foreground,
              defaults.useForeground,
              defaults.foreground,
            )}
            onReset={() => {
              setUseForeground(defaults.useForeground);
              setForeground(defaults.foreground);
            }}
          >
            <div className="flex items-center gap-2">
              {useForeground && (
                <ColorPicker
                  aria-label={t("settings.items.journal-foreground")}
                  presetColors={settings.journalColorPresets}
                  value={foreground}
                  onChange={setForeground}
                />
              )}
              <Switch
                aria-label={t("settings.items.journal-foreground")}
                checked={useForeground}
                onCheckedChange={setUseForeground}
              />
            </div>
          </Row>

          <Row
            label={t("settings.items.journal-background")}
            changed={colorChanged(
              useBackground,
              background,
              defaults.useBackground,
              defaults.background,
            )}
            onReset={() => {
              setUseBackground(defaults.useBackground);
              setBackground(defaults.background);
            }}
          >
            <div className="flex items-center gap-2">
              {useBackground && (
                <ColorPicker
                  aria-label={t("settings.items.journal-background")}
                  presetColors={settings.journalColorPresets}
                  value={background}
                  onChange={setBackground}
                />
              )}
              <Switch
                aria-label={t("settings.items.journal-background")}
                checked={useBackground}
                onCheckedChange={setUseBackground}
              />
            </div>
          </Row>

          <Row
            label={t("settings.items.journal-color-icons")}
            changed={colorIcon !== defaults.colorIcon}
            onReset={() => setColorIcon(defaults.colorIcon)}
          >
            <Switch
              aria-label={t("settings.items.journal-color-icons")}
              checked={colorIcon}
              onCheckedChange={setColorIcon}
            />
          </Row>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
