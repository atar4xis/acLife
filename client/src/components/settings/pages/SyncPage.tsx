import { useRef, useState } from "react";
import { ChevronRight, Settings } from "lucide-react";
import { toast } from "sonner";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { usePushService } from "@/hooks/usePushService";
import { RESYNC_INTERVAL_OPTIONS } from "@/lib/settingsDefaults";
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
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import SyncToggle from "../SyncToggle";
import { useTranslation } from "react-i18next";

function SyncGroup({ label, keys }: { label: string; keys: SyncableKey[] }) {
  const { enabled, isSynced, resetSynced } = useSyncSettings();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const syncedCount = keys.filter(isSynced).length;
  const modified = keys.some((key) => isSynced(key) !== syncByDefault[key]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1.5">
        <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium">
          <ChevronRight className="size-4 text-muted-foreground rtl:-scale-x-100 transition-transform group-data-[state=open]:rotate-90" />
          {label}
        </CollapsibleTrigger>
        <SyncToggle
          keys={keys}
          label={t("settings.sync.groupToggle", {
            label: label.toLocaleLowerCase(),
          })}
        />
        <div className="ms-auto flex items-center gap-2">
          {enabled && syncedCount > 0 && syncedCount < keys.length && (
            <span className="text-xs text-muted-foreground">
              {t("settings.sync.counted", {
                synced: syncedCount,
                total: keys.length,
              })}
            </span>
          )}
          {modified && <ResetToDefault onClick={() => resetSynced(keys)} />}
        </div>
      </div>
      <CollapsibleContent className="flex flex-col pt-2 pb-1 ps-5.5">
        {keys.map((key) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 odd:bg-muted/50"
          >
            <FieldTitle>{settingLabelByKey(key)}</FieldTitle>
            <SyncToggle
              settingKey={key}
              label={t("settings.sync.itemToggle", {
                label: settingLabelByKey(key).toLocaleLowerCase(),
              })}
            />
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
  const { t } = useTranslation();
  const { resyncIntervalMinutes, setSetting } = useCalendarSettings((s) => ({
    resyncIntervalMinutes: s.resyncIntervalMinutes,
    setSetting: s.setSetting,
  }));
  const { supported, enabled, enable, disable } = usePushService();
  const { enabled: syncEnabled, setEnabled: setSyncEnabled } =
    useSyncSettings();
  const [loading, setLoading] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTipOpen, setManageTipOpen] = useState(false);
  const manageRef = useRef<HTMLButtonElement>(null);

  const onToggle = (checked: boolean) => {
    setLoading(true);
    toast.promise(checked ? enable() : disable(), {
      loading: checked
        ? t("settings.push.enabling")
        : t("settings.push.disabling"),
      success: () => {
        setLoading(false);
        return checked ? t("push.enabled") : t("settings.push.disabled");
      },
      error: (d) => {
        setLoading(false);
        return d;
      },
    });
  };

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">{t("settings.categories.sync")}</h2>

      <Section
        id="settings-sync"
        label={sectionLabel("settings-sync")}
        sectionRefs={sectionRefs}
      >
        <Dialog
          open={manageOpen}
          onOpenChange={(next) => {
            setManageOpen(next);
            setManageTipOpen(false);
          }}
        >
          <Field orientation="responsive">
            <div className="flex flex-auto items-center gap-1.5">
              <FieldTitle>{settingLabel("sync-settings-enabled")}</FieldTitle>
              <Tooltip open={manageTipOpen} onOpenChange={setManageTipOpen}>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button
                      ref={manageRef}
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("settings.sync.manage")}
                      className="size-5 text-muted-foreground hover:text-foreground"
                    >
                      <Settings className="size-3.5" />
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("settings.sync.manage")}</TooltipContent>
              </Tooltip>
            </div>
            <Switch
              aria-label={t("settings.items.sync-settings-enabled")}
              checked={syncEnabled}
              onCheckedChange={setSyncEnabled}
            />
          </Field>
          <DialogContent
            className="max-h-[80vh] overflow-y-auto"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              manageRef.current?.focus();
              setManageTipOpen(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("settings.sync.manage")}</DialogTitle>
              <DialogDescription>
                {t("settings.sync.manageHelp")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              {syncGroups.map((group) => (
                <SyncGroup
                  key={group.id}
                  label={t(group.label)}
                  keys={group.keys}
                />
              ))}
            </div>
          </DialogContent>
        </Dialog>
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
          <FieldDescription>{t("settings.push.unsupported")}</FieldDescription>
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
            {RESYNC_INTERVAL_OPTIONS.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {t("move.minutes", { count: minutes })}
              </SelectItem>
            ))}
          </SettingsSelect>
        </Field>

        <FieldDescription>{t("settings.push.resyncHelp")}</FieldDescription>
      </Section>
    </FieldGroup>
  );
}
