import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ masterKey: null }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ ready: true, get: () => null, set: vi.fn() }),
}));

vi.mock("../../src/components/ui/resizable.tsx", () => ({
  ResizablePanelGroup: ({
    children,
    onLayout,
  }: {
    children: ReactNode;
    onLayout: (sizes: number[]) => void;
  }) => (
    <div>
      <button onClick={() => onLayout([25, 75])}>layout</button>
      {children}
    </div>
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: ({
    onDragging,
    onKeyUp,
  }: {
    onDragging: (dragging: boolean) => void;
    onKeyUp: React.KeyboardEventHandler<HTMLButtonElement>;
  }) => (
    <>
      <button onClick={() => onDragging(true)}>grab</button>
      <button onClick={() => onDragging(false)}>release</button>
      <button onKeyUp={onKeyUp}>handle</button>
    </>
  ),
}));

import JournalLayout from "../../src/components/journal/JournalLayout.tsx";
import {
  JournalProvider,
  useJournal,
} from "../../src/context/JournalContext.tsx";

Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: [][Symbol.iterator],
  }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

let journal: ReturnType<typeof useJournal>;
const Probe = () => {
  journal = useJournal();
  return null;
};

describe("split sizes", () => {
  it("commits the sizes when a resize ends, not while dragging", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    render(
      <JournalProvider>
        <Probe />
        <JournalLayout />
      </JournalProvider>,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve)));

    act(() => {
      journal.openNote(journal.addItem("note", null), true);
      journal.openNote(journal.addItem("note", null), true);
    });
    const [first, second] =
      journal.workspace.layout.kind === "pane"
        ? journal.workspace.layout.tabs
        : [];
    act(() =>
      journal.startDrag({ id: second, fromPane: journal.workspace.focused }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    act(() => journal.dropOnPane(journal.workspace.focused, "right"));
    expect(first).toBeTruthy();
    expect(journal.workspace.layout.kind).toBe("split");

    fireEvent.click(screen.getByText("layout"));
    fireEvent.click(screen.getByText("grab"));
    expect(journal.splitSizes).toEqual({});

    fireEvent.click(screen.getByText("release"));
    expect(Object.values(journal.splitSizes)).toEqual([[25, 75]]);
  });

  it("commits the sizes when a keyboard resize ends, but not on other keys", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    render(
      <JournalProvider>
        <Probe />
        <JournalLayout />
      </JournalProvider>,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    act(() => {
      journal.openNote(journal.addItem("note", null), true);
      journal.openNote(journal.addItem("note", null), true);
    });
    const pane = journal.workspace.focused;
    const [, second] = (journal.workspace.layout as { tabs: string[] }).tabs;
    act(() =>
      journal.dropOnPane(pane, "right", { id: second, fromPane: pane }),
    );
    fireEvent.click(screen.getByText("layout"));

    fireEvent.keyUp(screen.getByText("handle"), { key: "Tab" });
    expect(journal.splitSizes).toEqual({});

    fireEvent.keyUp(screen.getByText("handle"), { key: "ArrowRight" });
    expect(Object.values(journal.splitSizes)).toEqual([[25, 75]]);
  });
});
