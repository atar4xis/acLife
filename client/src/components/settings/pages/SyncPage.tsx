import { useState } from "react";
import { toast } from "sonner";
import {
  defaultCalendarSettings,
  useCalendarSettings,
} from "@/context/CalendarSettingsContext";
import { usePushService } from "@/hooks/usePushService";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import ResetToDefault from "../ResetToDefault";
import { sectionLabel, settingLabel } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";

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
        id="push-service"
        label={sectionLabel("push-service")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <FieldTitle>{settingLabel("sync-push-status")}</FieldTitle>
          <Switch
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
          <div className="flex flex-auto items-center gap-1.5">
            <FieldTitle>{settingLabel("sync-resync-interval")}</FieldTitle>
            {resyncIntervalMinutes !==
              defaultCalendarSettings.resyncIntervalMinutes && (
              <ResetToDefault
                onClick={() =>
                  setSetting(
                    "resyncIntervalMinutes",
                    defaultCalendarSettings.resyncIntervalMinutes,
                  )
                }
              />
            )}
          </div>
          <Select
            value={String(resyncIntervalMinutes)}
            onValueChange={(value) =>
              setSetting("resyncIntervalMinutes", Number(value))
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 minute</SelectItem>
              <SelectItem value="3">3 minutes</SelectItem>
              <SelectItem value="5">5 minutes</SelectItem>
              <SelectItem value="10">10 minutes</SelectItem>
            </SelectContent>
          </Select>
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
