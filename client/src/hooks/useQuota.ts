import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/context/ApiContext";
import type { Quota } from "@/types/Quota";
import { t } from "@/i18n";

export function useQuota() {
  const { get } = useApi();
  const [quota, setQuota] = useState<Quota | null>(null);

  useEffect(() => {
    get<Quota>("user/quota").then((res) => {
      if (res.success && res.data) {
        setQuota(res.data);
      } else {
        toast.error(res.message || t("settings.usage.loadFailed"));
      }
    });
  }, [get]);

  return quota;
}
