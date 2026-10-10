import { useStorage } from "@/context/StorageContext";
import type { AppView } from "@/types/AppView";
import { useCallback, useState } from "react";

export const useAppView = () => {
  const { ready, get, set } = useStorage();
  const [chosen, setChosen] = useState<AppView | null>(null);
  const saved: AppView =
    ready && get("appView") === "journal" ? "journal" : "calendar";
  const view = chosen ?? saved;

  const changeView = useCallback(
    (next: AppView) => {
      setChosen(next);
      set("appView", next);
    },
    [set],
  );

  return { view, changeView };
};
