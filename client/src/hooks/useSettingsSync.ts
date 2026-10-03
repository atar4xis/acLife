import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useApi } from "@/context/ApiContext";
import {
  useSettingsSelector,
  useSettingsStore,
} from "@/context/SettingsStoreContext";
import { useUser } from "@/context/UserContext";
import { decrypt, encrypt } from "@/lib/crypt";
import type { SettingsStore } from "@/lib/settingsStore";
import {
  collectSynced,
  hasNewerEntries,
  mergePayloads,
  newerRemote,
  parseSyncPayload,
  type SyncPayload,
} from "@/lib/settingsSync";
import { arrayBufferToBase64, uint8ArrayFromBase64 } from "@/lib/utils";
import { CLIENT_ID } from "@/lib/clientId";
import { isSubscriptionMissing } from "@/lib/subscription";
import type { APIResponse } from "@/types/API";
import type { PushEvent } from "@/types/Push";
import { t } from "@/i18n";

interface RemoteSettings {
  data: string | null;
  version: number;
}

const MAX_ATTEMPTS = 3;
const UPLOAD_DEBOUNCE_MS = 2000;

const syncedStamps = (store: SettingsStore) => {
  const { updatedAt, syncEnabled, syncOverrides } = store.getMeta();
  const synced = collectSynced(store.getSnapshot(), updatedAt, {
    enabled: syncEnabled,
    overrides: syncOverrides,
  });
  return JSON.stringify(
    Object.entries(synced).map(([key, entry]) => [key, entry?.updatedAt]),
  );
};

const readRemote = async (
  cipherText: string,
  masterKey: CryptoKey,
): Promise<SyncPayload> => {
  let reason: unknown = "payload is not an object";
  try {
    const plain = await decrypt(uint8ArrayFromBase64(cipherText), masterKey);
    const parsed = parseSyncPayload(
      JSON.parse(new TextDecoder().decode(plain)),
    );
    if (parsed) return parsed;
  } catch (error) {
    reason = error;
  }

  console.warn("Replacing unreadable synced settings.", reason);
  return {};
};

export function useSettingsSync() {
  const { user, masterKey } = useUser();
  const { get, post, serverMeta } = useApi();
  const store = useSettingsStore();
  const resyncIntervalMinutes = useSettingsSelector(
    ({ settings }) => settings.resyncIntervalMinutes,
  );
  const applying = useRef(false);
  const running = useRef(false);
  const rerun = useRef(false);
  const epoch = useRef(0);
  const latestSync = useRef<() => Promise<void>>(() => Promise.resolve());

  const sync = useCallback(async (): Promise<void> => {
    if (!masterKey) return;
    if (running.current) {
      rerun.current = true;
      return;
    }
    running.current = true;

    const startEpoch = epoch.current;
    const cancelled = () => epoch.current !== startEpoch;
    let current: RemoteSettings | null = null;

    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (!store.getMeta().syncEnabled) return;

        if (!current) {
          const res = await get<RemoteSettings>("user/settings");
          if (!res.success || !res.data || cancelled()) return;
          current = res.data;
        }
        const { data: cipherText, version } = current;
        current = null;

        const remote = cipherText
          ? await readRemote(cipherText, masterKey)
          : {};

        if (cancelled()) return;

        const meta = store.getMeta();
        const state = {
          enabled: meta.syncEnabled,
          overrides: meta.syncOverrides,
        };
        if (!state.enabled) return;

        const { patch, stamps } = newerRemote(remote, meta.updatedAt, state);
        applying.current = true;
        store.applyRemote(patch, stamps);
        applying.current = false;

        const local = collectSynced(
          store.getSnapshot(),
          store.getMeta().updatedAt,
          state,
        );
        if (!hasNewerEntries(local, remote)) return;

        const merged = mergePayloads(remote, local);

        const cipher = await encrypt(
          new TextEncoder().encode(JSON.stringify(merged)),
          masterKey,
        );
        if (cancelled()) return;

        const saved: APIResponse<RemoteSettings> = await post(
          `user/settings?c=${CLIENT_ID}`,
          { data: arrayBufferToBase64(cipher), baseVersion: version },
        );
        if (saved.success) return;

        if (!saved.data) {
          console.error("Failed to upload settings.", saved.message);
          toast.error(t("settings.syncFailed"));
          return;
        }

        // a version conflict replies with the current settings to re-merge
        current = saved.data;
      }

      console.error(`Failed to sync settings after ${MAX_ATTEMPTS} attempts.`);
      toast.error(t("settings.syncFailed"));
    } catch (error) {
      console.error("Failed to sync settings.", error);
    } finally {
      applying.current = false;
      running.current = false;
      if (rerun.current) {
        rerun.current = false;
        void latestSync.current();
      }
    }
  }, [masterKey, get, post, store]);

  useEffect(() => {
    latestSync.current = sync;
  }, [sync]);

  const active =
    !!user &&
    user.type !== "offline" &&
    !!masterKey &&
    !!serverMeta &&
    !isSubscriptionMissing(user, serverMeta);

  // initial sync, periodic resync, and on push message
  useEffect(() => {
    if (!active) return;

    const cancelEpoch = epoch;
    void sync();
    const interval = setInterval(
      () => void sync(),
      resyncIntervalMinutes * 60000,
    );
    const message = (ev: MessageEvent) => {
      const data = ev.data as PushEvent;
      if (data.type === "settings" && data.originClientId != CLIENT_ID) {
        void sync();
      }
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", message);
    }

    return () => {
      cancelEpoch.current++;
      clearInterval(interval);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", message);
      }
    };
  }, [active, sync, resyncIntervalMinutes]);

  // upload shortly after a local change
  useEffect(() => {
    if (!active) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let lastStamps = syncedStamps(store);
    const unsubscribe = store.subscribe(() => {
      const stamps = syncedStamps(store);
      const changed = stamps !== lastStamps;
      lastStamps = stamps;
      if (applying.current || !changed) return;

      clearTimeout(timeout);
      timeout = setTimeout(() => void sync(), UPLOAD_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [active, sync, store]);
}
