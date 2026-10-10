import { useJournal } from "@/context/JournalContext";
import { canDrop, dropZone } from "@/lib/journal/layout";
import type { DropZone, PaneNode } from "@/types/Journal";
import { memo, useState } from "react";

const PREVIEW: Record<DropZone, React.CSSProperties> = {
  center: { inset: 0 },
  left: { top: 0, bottom: 0, left: 0, width: "50%" },
  right: { top: 0, bottom: 0, right: 0, width: "50%" },
  top: { left: 0, right: 0, top: 0, height: "50%" },
  bottom: { left: 0, right: 0, bottom: 0, height: "50%" },
};

export default memo(function DropOverlay({ pane }: { pane: PaneNode }) {
  const journal = useJournal();
  const drag = journal.acceptedDrag;
  const [zone, setZone] = useState<DropZone | null>(null);

  if (!drag) return null;

  const zoneAt = (e: React.DragEvent) => {
    const next = dropZone(
      e.currentTarget.getBoundingClientRect(),
      e.clientX,
      e.clientY,
    );
    return canDrop(journal.workspace, drag, pane.id, next) ? next : null;
  };

  return (
    <div
      data-testid="drop-overlay"
      className="absolute inset-0 z-20"
      onDragOver={(e) => {
        const next = zoneAt(e);
        setZone(next);
        if (!next) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        e.preventDefault();
        const next = zoneAt(e);
        setZone(null);
        if (next) journal.dropOnPane(pane.id, next);
      }}
    >
      {zone && (
        <div
          className="border-primary bg-primary/20 pointer-events-none absolute border"
          style={PREVIEW[zone]}
        />
      )}
    </div>
  );
});
