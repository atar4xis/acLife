import { highlightLines, type HighlightedLine } from "@/lib/journal/highlight";
import { memo, useMemo } from "react";

const Line = memo(
  function Line({ segments, last }: HighlightedLine & { last: boolean }) {
    return (
      <>
        {segments.map(({ text, className }, i) =>
          className ? (
            <span key={i} className={className}>
              {text}
            </span>
          ) : (
            text
          ),
        )}
        {!last && "\n"}
      </>
    );
  },
  (previous, next) =>
    previous.signature === next.signature && previous.last === next.last,
);

export default function HighlightedLines({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const lines = useMemo(() => highlightLines(code, language), [code, language]);

  return lines.map((line, i) => (
    <Line key={i} {...line} last={i === lines.length - 1} />
  ));
}
