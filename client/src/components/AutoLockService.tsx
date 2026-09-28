import { useEffect, useRef } from "react";
import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";

const AUTO_LOCK_DURATIONS_MS: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "10m": 10 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "45m": 45 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

const ACTIVITY_EVENTS = [
  "mousedown",
  "mousemove",
  "keydown",
  "touchstart",
  "scroll",
] as const;

export default function AutoLockService() {
  const storage = useStorage();
  const { user, masterKey, setMasterKey, setBucketKey } = useUser();
  const autoLock = storage.get("autoLock");
  const unlockMethod = storage.get("unlockMethod");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active =
    user?.type === "online" &&
    masterKey !== null &&
    autoLock !== "disabled" &&
    unlockMethod !== "stay-unlocked";

  useEffect(() => {
    if (!active) return;

    const lock = () => {
      setMasterKey(null);
      setBucketKey(null);
    };

    if (autoLock === "focus") {
      const onBlur = () => lock();
      const onVisibilityChange = () => {
        if (document.hidden) lock();
      };

      window.addEventListener("blur", onBlur);
      document.addEventListener("visibilitychange", onVisibilityChange);

      return () => {
        window.removeEventListener("blur", onBlur);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      };
    }

    const duration = AUTO_LOCK_DURATIONS_MS[autoLock];
    if (!duration) return;

    const resetTimer = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(lock, duration);
    };

    resetTimer();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, resetTimer);
      }
    };
  }, [active, autoLock, setMasterKey, setBucketKey]);

  return null;
}
