import { useTranslation } from "react-i18next";
import { useQuota } from "@/hooks/useQuota";
import {
  cn,
  formatBytes,
  USAGE_WARNING_PERCENT,
  usagePercent,
} from "@/lib/utils";
import { FieldDescription, FieldTitle } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
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
          <Progress
            value={percent}
            aria-label={settingLabel("account-usage")}
            aria-valuetext={summary}
            indicatorClassName={cn(
              percent >= USAGE_WARNING_PERCENT && "bg-destructive",
            )}
          />
          <FieldDescription className="text-xs">{summary}</FieldDescription>
        </>
      )}
    </div>
  );
}
