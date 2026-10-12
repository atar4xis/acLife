import { useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";

export type Cursor = { line: number; column: number };

export type StatusBarHandle = { setCursor: (cursor: Cursor) => void };

export default function StatusBar({
  content,
  initialCursor,
  showCursor,
  ref,
}: {
  content: string;
  initialCursor: Cursor;
  showCursor: boolean;
  ref: Ref<StatusBarHandle>;
}) {
  const { t, i18n } = useTranslation();
  const [cursor, setCursor] = useState(initialCursor);
  const words = useMemo(() => content.match(/\S+/g)?.length ?? 0, [content]);
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  useImperativeHandle(
    ref,
    () => ({
      setCursor: (next) =>
        setCursor((prev) =>
          prev.line === next.line && prev.column === next.column ? prev : next,
        ),
    }),
    [],
  );

  return (
    <div className="text-muted-foreground flex shrink-0 justify-end gap-4 border-t px-3 py-1 text-xs tabular-nums">
      {showCursor && (
        <>
          <span>{t("journal.line", { n: fmt(cursor.line) })}</span>
          <span>{t("journal.column", { n: fmt(cursor.column) })}</span>
        </>
      )}
      <span>{t("journal.wordCount", { n: fmt(words) })}</span>
      <span>{t("journal.charCount", { n: fmt(content.length) })}</span>
    </div>
  );
}
