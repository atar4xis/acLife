import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { usePushService } from "@/hooks/usePushService";
import { useSyncSettings } from "@/hooks/useSyncSettings";
import {
  syncByDefault,
  syncGroups,
  type SyncableKey,
} from "@/lib/settingsSync";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  sectionLabel,
  settingLabel,
  settingLabelByKey,
  settingLabelId,
} from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import ResetToDefault from "../ResetToDefault";
import SettingsLabel from "../SettingsLabel";
import SettingsSelect from "../SettingsSelect";

function SyncGroup({
  label,
  keys,
  disabled,
}: {
  label: string;
  keys: SyncableKey[];
  disabled: boolean;
}) {
  const { isSynced, setSynced, resetSynced } = useSyncSettings();
  const [open, setOpen] = useState(false);
  const syncedCount = keys.filter(isSynced).length;
  const modified = keys.some((key) => isSynced(key) !== syncByDefault[key]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-auto items-center gap-1.5">
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium">
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            {label}
          </CollapsibleTrigger>
          {modified && <ResetToDefault onClick={() => resetSynced(keys)} />}
        </div>
        <Switch
          aria-label={`Sync ${label.toLowerCase()} settings`}
          checked={syncedCount === keys.length}
          disabled={disabled}
          onCheckedChange={(checked) => setSynced(keys, checked)}
        />
      </div>
      <CollapsibleContent className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-3 pt-3 pl-5.5">
        {keys.map((key) => (
          <div key={key} className="flex min-w-0 items-center gap-2">
            <Switch
              size="sm"
              aria-label={`Sync ${settingLabelByKey(key).toLowerCase()}`}
              checked={isSynced(key)}
              disabled={disabled}
              onCheckedChange={(checked) => setSynced([key], checked)}
            />
            <FieldTitle className="truncate">
              {settingLabelByKey(key)}
            </FieldTitle>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function SyncPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { resyncIntervalMinutes, setSetting } = useCalendarSettings((s) => ({
    resyncIntervalMinutes: s.resyncIntervalMinutes,
    setSetting: s.setSetting,
  }));
  const { supported, enabled, enable, disable } = usePushService();
  const { enabled: syncEnabled, setEnabled: setSyncEnabled } =
    useSyncSettings();
  const [loading, setLoading] = useState(false);

  const onToggle = (checked: boolean) => {
    setLoading(true);
    toast.promise(checked ? enable() : disable(), {
      loading: checked
        ? "Enabling push service..."
        : "Disabling push service...",
      success: () => {
        setLoading(false);
        return checked ? "Push service enabled." : "Push service disabled.";
      },
      error: (d) => {
        setLoading(false);
        return d;
      },
    });
  };

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">Sync</h2>

      <Section
        id="settings-sync"
        label={sectionLabel("settings-sync")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>{settingLabel("sync-settings-enabled")}</FieldTitle>
            <FieldDescription>
              Choose what to sync below, or use the cloud icon next to a
              setting.
            </FieldDescription>
          </FieldContent>
          <Switch
            aria-label="Sync settings"
            checked={syncEnabled}
            onCheckedChange={setSyncEnabled}
          />
        </Field>

        <div className="flex flex-col gap-4">
          {syncGroups.map((group) => (
            <SyncGroup
              key={group.id}
              label={group.label}
              keys={group.keys}
              disabled={!syncEnabled}
            />
          ))}
        </div>
      </Section>

      <Separator />

      <Section
        id="push-service"
        label={sectionLabel("push-service")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <FieldTitle>{settingLabel("sync-push-status")}</FieldTitle>
          <Switch
            aria-label={settingLabel("sync-push-status")}
            checked={enabled}
            disabled={!supported || loading}
            onCheckedChange={onToggle}
          />
        </Field>

        {!supported && (
          <FieldDescription>
            Push service is not available in this browser.
          </FieldDescription>
        )}
      </Section>

      <Separator />

      <Section
        id="resync"
        label={sectionLabel("resync")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <SettingsLabel settingKey="resyncIntervalMinutes" />
          <SettingsSelect
            labelledBy={settingLabelId("resyncIntervalMinutes")}
            value={String(resyncIntervalMinutes)}
            onValueChange={(value) =>
              setSetting("resyncIntervalMinutes", Number(value))
            }
          >
            <SelectItem value="1">1 minute</SelectItem>
            <SelectItem value="3">3 minutes</SelectItem>
            <SelectItem value="5">5 minutes</SelectItem>
            <SelectItem value="10">10 minutes</SelectItem>
          </SettingsSelect>
        </Field>

        <FieldDescription>
          {enabled && (
            <>
              If the push service is on, changes made on other devices sync
              right away, no matter this interval.
            </>
          )}
        </FieldDescription>
      </Section>
    </FieldGroup>
  );
}
