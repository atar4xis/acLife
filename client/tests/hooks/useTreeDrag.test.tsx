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
vi.mock("../../src/context/JournalContext.tsx", () => ({
  useJournal: () => ({
    drag: null,
    itemsById: new Map(),
    items: [],
    startDrag: vi.fn(),
    endDrag: vi.fn(),
    moveItem: vi.fn(),
  }),
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

function Row() {
  const { dragProps } = useTreeDrag();
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
