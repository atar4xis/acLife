import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import {
  checkNativeUpdate,
  installNativeUpdate,
  isTauri,
} from "@/lib/nativeUpdater";
import {
  compareVersions,
  fetchChangelog,
  fetchReleases,
  type ChangelogEntry,
  type Release,
} from "@/lib/updates";
import { t } from "@/i18n";
import type { WithChildren } from "@/types/Props";

const LAST_CHECKED_KEY = "acl-update-last-checked";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterState {
  status: UpdateStatus;
  latest: Release | null;
  canInstall: boolean;
  changelog: ChangelogEntry[];
  lastChecked: number | null;
}

interface UpdaterValue extends UpdaterState {
  check: () => Promise<void>;
  install: () => Promise<void>;
}

const UpdaterContext = createContext<UpdaterValue | undefined>(undefined);

export function UpdaterProvider({ children }: WithChildren) {
  const settings = useCalendarSettings((s) => ({
    autoCheck: s.autoCheckUpdates,
    autoInstall: s.autoInstallUpdates,
    channel: s.updateChannel,
  }));
  const [state, setState] = useState<UpdaterState>({
    status: "idle",
    latest: null,
    canInstall: false,
    changelog: [],
    lastChecked: Number(localStorage.getItem(LAST_CHECKED_KEY)) || null,
  });
  const installing = useRef(false);

  const check = useCallback(async () => {
    if (installing.current) return;
    setState((s) => ({ ...s, status: "checking" }));
    try {
      const releases = await fetchReleases(settings.channel);
      const changelog = await fetchChangelog(releases);
      const latest = releases[0] ?? null;
      const available =
        !!latest && compareVersions(latest.version, __APP_VERSION__) > 0;
      const canInstall =
        available && isTauri && (await checkNativeUpdate(latest.tag));
      const lastChecked = Date.now();
      localStorage.setItem(LAST_CHECKED_KEY, String(lastChecked));
      setState({
        status: available ? "available" : "upToDate",
        latest,
        canInstall,
        changelog,
        lastChecked,
      });
    } catch {
      setState((s) => ({ ...s, status: "error" }));
    }
  }, [settings.channel]);

  const install = useCallback(async () => {
    installing.current = true;
    setState((s) => ({ ...s, status: "downloading" }));
    try {
      await installNativeUpdate();
      setState((s) => ({ ...s, status: "ready" }));
    } catch {
      installing.current = false;
      setState((s) => ({ ...s, status: "error" }));
      toast.error(t("settings.updates.installFailed"));
    }
  }, []);

  useEffect(() => {
    if (!settings.autoCheck) return;
    void check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [settings.autoCheck, check]);

  useEffect(() => {
    if (
      state.status === "available" &&
      state.canInstall &&
      settings.autoInstall
    )
      void install();
  }, [state.status, state.canInstall, settings.autoInstall, install]);

  const value = useMemo(
    () => ({ ...state, check, install }),
    [state, check, install],
  );

  return (
    <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>
  );
}

// eslint-disable-next-line
export function useUpdater() {
  const value = useContext(UpdaterContext);
  if (!value) throw new Error("useUpdater must be used within UpdaterProvider");
  return value;
}
