import { useEffect, useRef, useState } from "react";

// commits after a pause instead of on every keystroke, like useDeferredSliderValue
export function useDebouncedSetting<T>(
  value: T,
  onCommit: (value: T) => void,
  delay = 400,
) {
  const [draft, setDraft] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<T | null>(null);

  useEffect(() => {
    setDraft(null);
    draftRef.current = null;
  }, [value]);

  useEffect(() => {
    // commit a pending edit on unmount instead of dropping it silently
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        if (draftRef.current !== null) onCommit(draftRef.current);
      }
    };
    // eslint-disable-next-line
  }, []);

  const onChange = (next: T) => {
    draftRef.current = next;
    setDraft(next);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onCommit(next);
    }, delay);
  };

  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (draftRef.current !== null) onCommit(draftRef.current);
    }
  };

  // discards a pending commit, e.g. after a programmatic reset
  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    draftRef.current = null;
    setDraft(null);
  };

  return { value: draft ?? value, onChange, flush, cancel };
}
