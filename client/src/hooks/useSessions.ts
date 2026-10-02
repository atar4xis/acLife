import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/context/ApiContext";
import type { Session } from "@/types/Session";

export function useSessions() {
  const { get } = useApi();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const res = await get<Session[]>("user/sessions");
    setRefreshing(false);

    if (res.success && res.data) {
      setSessions(res.data);
    } else {
      toast.error(res.message || "Failed to load sessions.");
    }
  }, [get]);

  useEffect(() => {
    load();
  }, [load]);

  return { sessions, setSessions, refreshing, load };
}
