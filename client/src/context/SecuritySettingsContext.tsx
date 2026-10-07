import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useUser } from "@/context/UserContext";
import { useStorage } from "@/context/StorageContext";
import {
  exportKeyPair,
  protectUnlockKeys,
  wrapKeyPairWithPin,
} from "@/lib/crypt";
import { isTauri } from "@/lib/nativeUpdater";
import { unlockAccount } from "@/lib/unlockAccount";
import type { WithChildren } from "@/types/Props";
import type { AutoLockOption, UnlockMethod } from "@/types/Storage";
import {
  PinSetupDialog,
  StayUnlockedDialog,
} from "@/components/settings/UnlockMethodDialogs";
import { t } from "@/i18n";

interface SecuritySettingsValue {
  unlockMethod: UnlockMethod;
  autoLock: AutoLockOption;
  setUnlockMethod: (method: UnlockMethod) => void;
  setAutoLock: (value: AutoLockOption) => void;
}

const SecuritySettingsContext = createContext<
  SecuritySettingsValue | undefined
>(undefined);

export function SecuritySettingsProvider({ children }: WithChildren) {
  const { user, masterKey, bucketKey } = useUser();
  const storage = useStorage();

  const unlockMethod = storage.get("unlockMethod");
  const autoLock = storage.get("autoLock");
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [stayUnlockedDialogOpen, setStayUnlockedDialogOpen] = useState(false);

  const commit = async (
    method: UnlockMethod,
    opts?: { pin?: string; currentPassword?: string },
  ) => {
    if (!masterKey || !bucketKey) {
      toast.error(t("security.mustDecrypt"));
      return;
    }
    if (!user || user.type !== "online") return;

    try {
      if (method === "stay-unlocked" || method === "pin") {
        if (!opts?.currentPassword) return;

        const pinMethod = method === "pin";
        const keys = await unlockAccount(
          opts.currentPassword,
          user,
          pinMethod || isTauri,
        );

        if (!pinMethod) {
          storage.set("unlockKeys", await protectUnlockKeys(keys));
          storage.set("pinWrappedKeys", null);
        } else {
          if (!opts.pin) return;
          const exported = await exportKeyPair(keys.masterKey, keys.bucketKey);
          const wrapped = await wrapKeyPairWithPin(
            opts.pin,
            exported.masterKeyB64,
            exported.bucketKeyB64,
          );
          storage.set("pinWrappedKeys", wrapped);
          storage.set("unlockKeys", null);
        }
      } else {
        storage.set("unlockKeys", null);
        storage.set("pinWrappedKeys", null);
      }

      storage.set("unlockMethod", method);
      setPinDialogOpen(false);
      setStayUnlockedDialogOpen(false);
      toast.success(t("security.updated"));
    } catch (err) {
      console.error("Failed to update unlock method:", err);
      throw err;
    }
  };

  const setUnlockMethod = (method: UnlockMethod) => {
    if (method === "pin") {
      setPinDialogOpen(true);
      return;
    }
    if (method === "stay-unlocked") {
      setStayUnlockedDialogOpen(true);
      return;
    }

    commit(method).catch(() => {
      toast.error(t("security.updateFailed"));
    });
  };

  const setAutoLock = (value: AutoLockOption) => storage.set("autoLock", value);

  useEffect(() => {
    if (unlockMethod === "stay-unlocked" && autoLock !== "disabled") {
      storage.set("autoLock", "disabled");
    }
    // eslint-disable-next-line
  }, [unlockMethod]);

  const value = useMemo(
    () => ({ unlockMethod, autoLock, setUnlockMethod, setAutoLock }),
    // handlers only close over stable storage and user state
    // eslint-disable-next-line
    [unlockMethod, autoLock, user, masterKey, bucketKey],
  );

  return (
    <SecuritySettingsContext.Provider value={value}>
      {children}

      <PinSetupDialog
        open={pinDialogOpen}
        onCancel={() => setPinDialogOpen(false)}
        onConfirm={(pin, currentPassword) =>
          commit("pin", { pin, currentPassword })
        }
      />
      <StayUnlockedDialog
        open={stayUnlockedDialogOpen}
        onCancel={() => setStayUnlockedDialogOpen(false)}
        onConfirm={(currentPassword) =>
          commit("stay-unlocked", { currentPassword })
        }
      />
    </SecuritySettingsContext.Provider>
  );
}

// eslint-disable-next-line
export function useSecuritySettings() {
  const context = useContext(SecuritySettingsContext);

  if (!context)
    throw new Error(
      "useSecuritySettings must be used within a SecuritySettingsProvider",
    );

  return context;
}
