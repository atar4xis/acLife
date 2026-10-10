import JournalPane from "@/components/journal/JournalPane";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useJournal } from "@/context/JournalContext";
import { focusTab } from "@/lib/journal/focus";
import { panesOf } from "@/lib/journal/layout";
import type { LayoutNode } from "@/types/Journal";
import { useEffect, useEffectEvent, useRef } from "react";
import { useTranslation } from "react-i18next";

const RESIZE_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

function LayoutView({ node }: { node: LayoutNode }) {
  const { t } = useTranslation();
  const { splitSizes, setSplitSizes } = useJournal();
  const latest = useRef<number[]>([]);
  if (node.kind === "pane") return <JournalPane pane={node} />;

  const key = node.children.map((child) => child.id).join();
  return (
    <ResizablePanelGroup
      key={key}
      direction={node.direction === "row" ? "horizontal" : "vertical"}
      onLayout={(sizes) => {
        latest.current = sizes;
      }}
    >
      {node.children.flatMap((child, index) => [
        index > 0 && (
          <ResizableHandle
            key={`handle-${child.id}`}
            aria-label={t("journal.resize")}
            onKeyUp={(e) => {
              if (RESIZE_KEYS.has(e.key)) setSplitSizes(key, latest.current);
            }}
            onDragging={(dragging) => {
              if (!dragging) setSplitSizes(key, latest.current);
            }}
          />
        ),
        <ResizablePanel
          key={child.id}
          id={child.id}
          order={index}
          minSize={10}
          defaultSize={splitSizes[key]?.[index]}
          className="min-w-0"
        >
          <LayoutView node={child} />
        </ResizablePanel>,
      ])}
    </ResizablePanelGroup>
  );
}

export default function JournalLayout() {
  const { workspace } = useJournal();
  const cyclePane = useEffectEvent((e: KeyboardEvent) => {
    const panes = panesOf(workspace.layout);
    if (e.key !== "F6" || e.defaultPrevented || panes.length < 2) return;

    const from = panes.findIndex((pane) => pane.id === workspace.focused);
    const next =
      panes[(from + (e.shiftKey ? -1 : 1) + panes.length) % panes.length];
    if (next.active) focusTab(next.active);
    e.preventDefault();
  });

  useEffect(() => {
    window.addEventListener("keydown", cyclePane);
    return () => window.removeEventListener("keydown", cyclePane);
  }, []);

  return (
    <div dir="ltr" className="min-h-0 flex-1">
      <LayoutView node={workspace.layout} />
    </div>
  );
}
