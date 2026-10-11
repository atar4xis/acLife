import { MAX_JOURNAL_NAME_LENGTH } from "@/lib/journal/item";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export default function RenameInput({
  name,
  onDone,
}: {
  name: string;
  onDone: (name?: string) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="min-w-0 flex-1 bg-transparent outline-none"
      aria-label={t("journal.rename")}
      defaultValue={name}
      maxLength={MAX_JOURNAL_NAME_LENGTH}
      onBlur={(e) => onDone(cancelled.current ? undefined : e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancelled.current = true;
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}
