import { useSidebar } from "@/components/ui/sidebar";
import { useJournal } from "@/context/JournalContext";
import { canMoveItem, topLevelItems } from "@/lib/journal/item";
import { touchDrag } from "@/lib/touchDrag";
import type { JournalItem } from "@/types/Journal";
import { useMemo, useState } from "react";

export const useTreeDrag = (selectedIds: ReadonlySet<string>) => {
  const journal = useJournal();
  const { isMobile, setOpenMobile } = useSidebar();
  const [dropTarget, setDropTarget] = useState<string | null>();

  const { dragProps, rootProps } = useMemo(() => {
    const dragged = journal.drag && journal.itemsById.get(journal.drag.id);
    const draggedOnly = dragged ? [dragged] : [];
    const dragsSelection = !!dragged && selectedIds.has(dragged.id);
    const moving = dragsSelection
      ? topLevelItems(journal.items, selectedIds)
      : draggedOnly;
    const movable = (parentId: string | null) =>
      moving.filter((item) => canMoveItem(journal.items, item, parentId));
    const canMoveTo = (parentId: string | null) =>
      !journal.drag?.fromPane && movable(parentId).length > 0;
    const moveDragged = (parentId: string | null) =>
      movable(parentId).forEach((item) => journal.moveItem(item.id, parentId));

    const endDrag = () => {
      journal.endDrag();
      setDropTarget(undefined);
    };

    const dragProps = (
      item: JournalItem,
    ): React.HTMLAttributes<HTMLElement> => {
      const parentId = item.type === "folder" ? item.id : item.parentId;
      return {
        draggable: true,
        onDragStart: (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            return;
          }

          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.name);
          journal.startDrag({ id: item.id });
        },
        onDragEnd: endDrag,
        onPointerDown: touchDrag({
          label: item.name,
          onStart: () => journal.startDrag({ id: item.id }),
          onEnd: endDrag,
          onOver: (target) => {
            if (isMobile && target.matches("[data-slot=sheet-overlay]"))
              setOpenMobile(false);
          },
        }),
        onDragOver: (e) => {
          if (!canMoveTo(parentId)) return;
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(parentId);
        },
        onDrop: (e) => {
          if (!canMoveTo(parentId)) return;
          e.preventDefault();
          e.stopPropagation();
          moveDragged(parentId);
          endDrag();
        },
      };
    };

    const rootProps: React.HTMLAttributes<HTMLElement> = {
      onDragOver: (e) => {
        if (!canMoveTo(null)) return;
        e.preventDefault();
        setDropTarget(null);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropTarget(undefined);
      },
      onDrop: (e) => {
        if (!canMoveTo(null)) return;
        e.preventDefault();
        moveDragged(null);
        endDrag();
      },
    };

    return { dragProps, rootProps };
  }, [journal, selectedIds, isMobile, setOpenMobile]);

  return { dropTarget, dragProps, rootProps };
};
