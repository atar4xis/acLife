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

export default function SyncToggle({
  settingKey,
}: {
  settingKey: SyncableKey;
}) {
  const { user } = useUser();
  const { enabled, overrides, isSynced, setSynced } = useSyncSettings();

  if (user?.type !== "online") return null;

  const synced = isSynced(settingKey);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={synced}
          aria-label="Sync this setting"
          className={cn(
            "size-5 text-muted-foreground hover:text-foreground",
            // highlight choices that differ from the default
            settingKey in overrides && "text-primary hover:text-primary",
            !enabled && "opacity-50",
          )}
          onClick={() => setSynced([settingKey], !synced)}
        >
          {synced ? (
            <Cloud className="size-3.5" />
          ) : (
            <CloudOff className="size-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {synced ? "Synced to all devices" : "This device only"}
        {!enabled && " (settings sync is off)"}
      </TooltipContent>
    </Tooltip>
  );
}
