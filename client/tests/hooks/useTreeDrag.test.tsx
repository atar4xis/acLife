import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalItem } from "../../src/types/Journal";

const sidebar = vi.hoisted(() => ({
  isMobile: true,
  setOpenMobile: vi.fn(),
}));

vi.mock("../../src/components/ui/sidebar.tsx", () => ({
  useSidebar: () => sidebar,
}));
const journal = vi.hoisted(() => ({
  drag: null as { id: string } | null,
  itemsById: new Map<string, JournalItem>(),
  items: [] as JournalItem[],
  startDrag: vi.fn(),
  endDrag: vi.fn(),
  moveItem: vi.fn(),
}));

vi.mock("../../src/context/JournalContext.tsx", () => ({
  useJournal: () => journal,
}));

import { useTreeDrag } from "../../src/hooks/journal/useTreeDrag";

class FakeDragEvent extends Event {
  clientX = 0;
  clientY = 0;
}

const item: JournalItem = {
  id: "a",
  parentId: null,
  type: "note",
  name: "A",
  content: "",
  createdAt: 0,
  updatedAt: 0,
};

const noSelection = new Set<string>();

function Row() {
  const { dragProps } = useTreeDrag(noSelection);
  return <button {...dragProps(item)}>row</button>;
}

const dragOver = (element: Element) => {
  document.elementFromPoint = vi.fn(() => element);
  fireEvent.pointerDown(screen.getByText("row"), {
    pointerType: "touch",
    clientX: 5,
    clientY: 5,
  });
  act(() => vi.advanceTimersByTime(400));
  fireEvent.pointerMove(window, { pointerType: "touch", clientX: 10, clientY: 10 });
};

const folder: JournalItem = { ...item, id: "f", type: "folder", name: "F" };
const noteA: JournalItem = { ...item, id: "n1", parentId: "x" };
const noteB: JournalItem = { ...item, id: "n2", parentId: "x" };

function Tree({ selectedIds }: { selectedIds: ReadonlySet<string> }) {
  const { dragProps, rootProps } = useTreeDrag(selectedIds);
  return (
    <div data-testid="root" {...rootProps}>
      <button {...dragProps(folder)}>folder</button>
    </div>
  );
}

describe("useTreeDrag drops", () => {
  beforeEach(() => {
    journal.drag = null;
    journal.itemsById = new Map();
    journal.items = [];
    journal.moveItem.mockReset();
    sidebar.isMobile = false;
  });

  it("ignores drags that did not start from a row", () => {
    const onError = vi.fn();
    window.addEventListener("error", onError);
    render(<Tree selectedIds={noSelection} />);

    const notPrevented = fireEvent.dragOver(screen.getByTestId("root"));
    window.removeEventListener("error", onError);

    expect(onError).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it("moves the whole selection when a selected row is dragged", () => {
    journal.items = [folder, noteA, noteB];
    journal.itemsById = new Map(journal.items.map((found) => [found.id, found]));
    journal.drag = { id: "n1" };
    render(<Tree selectedIds={new Set(["n1", "n2"])} />);

    fireEvent.drop(screen.getByText("folder"));

    expect(journal.moveItem.mock.calls).toEqual([
      ["n1", "f"],
      ["n2", "f"],
    ]);
  });

  it("moves only the dragged row when it is not selected", () => {
    journal.items = [folder, noteA, noteB];
    journal.itemsById = new Map(journal.items.map((found) => [found.id, found]));
    journal.drag = { id: "n1" };
    render(<Tree selectedIds={new Set(["n2"])} />);

    fireEvent.drop(screen.getByText("folder"));

    expect(journal.moveItem.mock.calls).toEqual([["n1", "f"]]);
  });
});

describe("useTreeDrag touch drag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("DragEvent", FakeDragEvent);
    vi.stubGlobal("DataTransfer", class {});
    sidebar.isMobile = true;
    sidebar.setOpenMobile.mockReset();
  });
  afterEach(() => {
    fireEvent.pointerUp(window);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const overlay = () => {
    const element = document.createElement("div");
    element.dataset.slot = "sheet-overlay";
    return element;
  };

  it("closes the mobile sheet when dragged over its overlay", () => {
    render(<Row />);
    dragOver(overlay());

    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false);
  });

  it("keeps the sheet open over anything else", () => {
    render(<Row />);
    dragOver(document.createElement("div"));

    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
  });

  it("ignores the overlay when the sidebar is not a sheet", () => {
    sidebar.isMobile = false;
    render(<Row />);
    dragOver(overlay());

    expect(sidebar.setOpenMobile).not.toHaveBeenCalled();
  });
});
