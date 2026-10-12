import { memo } from "react";
import { useJournal } from "@/context/JournalContext";
import { useJournalSettings } from "@/context/JournalSettingsContext";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { colorChanged, folderTargets, noteName } from "@/lib/journal/item";
import { defaultJournalSettings } from "@/lib/settingsDefaults";
import { ColorPicker } from "@/components/ui/color-picker";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
import { IconPicker } from "@/components/ui/icon-picker";
import { Input } from "@/components/ui/input";
import { SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import ResetToDefault from "../ResetToDefault";
import { sectionLabel, settingLabel, settingLabelId } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import SettingsLabel from "../SettingsLabel";
import SettingsSelect from "../SettingsSelect";
import SettingsSwitch from "../SettingsSwitch";
import SyncToggle from "../SyncToggle";
import { useTranslation } from "react-i18next";

const NoteNameField = memo(function NoteNameField() {
  useTranslation();

  const { journalNoteName, setSetting } = useJournalSettings();
  const field = useDebouncedSetting(journalNoteName, (value) =>
    setSetting("journalNoteName", value),
  );

  return (
    <Field orientation="responsive" className="min-h-9">
      <div className="flex flex-auto flex-col">
        <SettingsLabel settingKey="journalNoteName" onReset={field.cancel} />
        <span className="text-muted-foreground truncate text-xs">
          {noteName(field.value)}
        </span>
      </div>
      <Input
        aria-labelledby={settingLabelId("journalNoteName")}
        value={field.value}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.flush}
        className="@md/field-group:w-55!"
      />
    </Field>
  );
});

function NoteFolderField() {
  const { t } = useTranslation();
  const { items, sort } = useJournal();
  const { journalNoteFolder, setSetting } = useJournalSettings();
  const targets = folderTargets(items, sort);

  if (targets.length === 1) return null;

  const selected = targets.some(
    (target) => target.folder?.id === journalNoteFolder,
  )
    ? journalNoteFolder
    : "root";

  return (
    <Field orientation="responsive" className="min-h-9">
      <SettingsLabel settingKey="journalNoteFolder" />
      <SettingsSelect
        labelledBy={settingLabelId("journalNoteFolder")}
        value={selected}
        onValueChange={(id) =>
          setSetting("journalNoteFolder", id === "root" ? "" : id)
        }
      >
        {targets.map(({ folder: f, depth }) => (
          <SelectItem
            key={f?.id ?? "root"}
            value={f?.id ?? "root"}
            style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
          >
            {f?.name ?? t("journal.root")}
          </SelectItem>
        ))}
      </SettingsSelect>
    </Field>
  );
}

function ColorField({
  enabledKey,
  colorKey,
  itemId,
}: {
  enabledKey: "journalForegroundEnabled" | "journalBackgroundEnabled";
  colorKey: "journalForeground" | "journalBackground";
  itemId: string;
}) {
  const settings = useJournalSettings();
  const field = useDebouncedSetting(
    settings[colorKey],
    (value) => settings.setSetting(colorKey, value),
    150,
  );
  const changed = colorChanged(
    settings[enabledKey],
    settings[colorKey],
    defaultJournalSettings[enabledKey],
    defaultJournalSettings[colorKey],
  );

  return (
    <Field orientation="responsive" className="min-h-9">
      <div className="flex flex-auto items-center gap-1.5">
        <FieldTitle id={settingLabelId(enabledKey)}>
          {settingLabel(itemId)}
        </FieldTitle>
        <SyncToggle keys={[enabledKey, colorKey]} />
        {changed && (
          <ResetToDefault
            onClick={() => {
              field.cancel();
              settings.setSettings({
                [enabledKey]: defaultJournalSettings[enabledKey],
                [colorKey]: defaultJournalSettings[colorKey],
              });
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        {settings[enabledKey] && (
          <ColorPicker
            aria-label={settingLabel(itemId)}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.flush}
          />
        )}
        <Switch
          aria-labelledby={settingLabelId(enabledKey)}
          checked={settings[enabledKey]}
          onCheckedChange={(checked) =>
            settings.setSetting(enabledKey, checked)
          }
        />
      </div>
    </Field>
  );
}

export default function JournalPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { t } = useTranslation();
  const settings = useJournalSettings((s) => ({
    noteIcon: s.journalNoteIcon,
    folderIcon: s.journalFolderIcon,
    setSetting: s.setSetting,
  }));

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">
        {t("settings.categories.journal")}
      </h2>

      <Section
        id="journal-editor"
        label={sectionLabel("journal-editor")}
        sectionRefs={sectionRefs}
      >
        <SettingsSwitch settingKey="journalShowTitle" className="min-h-9" />
        <SettingsSwitch settingKey="journalLineNumbers" className="min-h-9" />
        <SettingsSwitch settingKey="journalStatusBar" className="min-h-9" />
      </Section>

      <Separator />

      <Section
        id="note-defaults"
        label={sectionLabel("note-defaults")}
        sectionRefs={sectionRefs}
      >
        <NoteNameField />
        <NoteFolderField />

        <Field orientation="responsive" className="min-h-9">
          <SettingsLabel settingKey="journalNoteIcon" />
          <div className="flex">
            <IconPicker
              aria-labelledby={settingLabelId("journalNoteIcon")}
              value={settings.noteIcon}
              onChange={(icon) => settings.setSetting("journalNoteIcon", icon)}
            />
          </div>
        </Field>

        <Field orientation="responsive" className="min-h-9">
          <SettingsLabel settingKey="journalFolderIcon" />
          <div className="flex">
            <IconPicker
              aria-labelledby={settingLabelId("journalFolderIcon")}
              value={settings.folderIcon}
              onChange={(icon) =>
                settings.setSetting("journalFolderIcon", icon)
              }
            />
          </div>
        </Field>

        <ColorField
          enabledKey="journalForegroundEnabled"
          colorKey="journalForeground"
          itemId="journal-foreground"
        />
        <ColorField
          enabledKey="journalBackgroundEnabled"
          colorKey="journalBackground"
          itemId="journal-background"
        />
        <SettingsSwitch settingKey="journalColorIcons" className="min-h-9" />
      </Section>
    </FieldGroup>
  );
}
