import { useTranslation } from "react-i18next";
import { useQuota } from "@/hooks/useQuota";
import {
  cn,
  formatBytes,
  USAGE_WARNING_PERCENT,
  usagePercent,
} from "@/lib/utils";
import { FieldDescription, FieldTitle } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { settingLabel } from "../settingsData";

export default function UsageField() {
  const { t, i18n } = useTranslation();
  const quota = useQuota();

  const percent = quota ? usagePercent(quota.used, quota.limit) : 0;
  const summary = quota
    ? t("settings.usage.summary", {
        used: formatBytes(quota.used, i18n.language),
        limit: formatBytes(quota.limit, i18n.language),
      })
    : "";

  return (
    <div className="flex flex-col gap-1.5">
      <FieldTitle>{settingLabel("account-usage")}</FieldTitle>
      {quota === null ? (
        <Skeleton className="h-8 w-full" />
      ) : (
        <>
          <div
            role="progressbar"
            aria-label={settingLabel("account-usage")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-valuetext={summary}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full",
                percent >= USAGE_WARNING_PERCENT
                  ? "bg-destructive"
                  : "bg-primary",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <FieldDescription className="text-xs">{summary}</FieldDescription>
        </>
      )}
    </div>
  );
}
