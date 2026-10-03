import { Cloud, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUser } from "@/context/UserContext";
import { useSyncSettings } from "@/hooks/useSyncSettings";
import { cn } from "@/lib/utils";
import type { SyncableKey } from "@/lib/settingsSync";
import { useTranslation } from "react-i18next";

export default function SyncToggle({
  settingKey,
  keys = [settingKey as SyncableKey],
  label,
}: {
  settingKey?: SyncableKey;
  keys?: SyncableKey[];
  label?: string;
}) {
  const { t } = useTranslation();
  const { user } = useUser();
  const { enabled, overrides, isSynced, setSynced } = useSyncSettings();

  if (user?.type !== "online") return null;

  const synced = enabled && keys.some(isSynced);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={synced}
          aria-label={label ?? t("settings.sync.toggle")}
          disabled={!enabled}
          className={cn(
            "size-5 text-muted-foreground hover:text-foreground",
            // highlight choices that differ from the default
            keys.some((key) => key in overrides) &&
              "text-primary hover:text-primary",
          )}
          onClick={() => setSynced(keys, !synced)}
        >
          {synced ? (
            <Cloud className="size-3.5" />
          ) : (
            <CloudOff className="size-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {synced ? t("settings.sync.synced") : t("settings.sync.deviceOnly")}
        {!enabled && ` ${t("settings.sync.off")}`}
      </TooltipContent>
    </Tooltip>
  );
}
