import { EditorView } from "@codemirror/view";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNote, editorView, renderJournal, resetJournal } from "./helpers.tsx";
import * as scrollAnchor from "../../src/lib/journal/scrollAnchor.ts";

vi.mock("../../src/lib/journal/scrollAnchor.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof scrollAnchor>()),
  readerTopLine: vi.fn(() => 7.5),
  scrollReaderToLine: vi.fn(),
}));

const observers: { callback: (entries?: unknown[]) => void; disconnect: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(callback: (entries?: unknown[]) => void) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe() {}
      unobserve() {}
    },
  );
});

afterEach(resetJournal);

const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");

const start = async () => {
  const user = userEvent.setup();
  renderJournal();
  await createNote(user, "Doc");
  act(() => editorView().dispatch({ changes: { from: 0, insert: lines } }));
  return user;
};

const toggle = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole("button", { name }));

describe("keeping the position when switching modes", () => {
  it("scrolls the reader to the line at the top of the editor", async () => {
    const user = await start();
    const editor = editorView();
    vi.spyOn(editor, "documentTop", "get").mockReturnValue(0);
    vi.spyOn(editor, "lineBlockAtHeight").mockReturnValue({
      from: editor.state.doc.line(4).from,
      top: 0,
      height: 20,
    } as ReturnType<typeof editor.lineBlockAtHeight>);

    await toggle(user, "Reading mode");
    act(() => observers.at(-1)!.callback());

    await waitFor(() =>
      expect(scrollAnchor.scrollReaderToLine).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        4,
      ),
    );
  });

  it("scrolls the editor to the line at the top of the reader", async () => {
    const user = await start();
    await toggle(user, "Reading mode");
    const scroll = vi.spyOn(EditorView, "scrollIntoView");

    await toggle(user, "Edit mode");
    const editor = editorView();
    act(() => observers.at(-1)!.callback());

    expect(scrollAnchor.readerTopLine).toHaveBeenCalled();
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith(
        editor.state.doc.line(7).from,
        expect.objectContaining({ y: "start" }),
      ),
    );
  });

  it("keeps the position when the toggle is activated by a bare click", async () => {
    await start();
    const editor = editorView();
    vi.spyOn(editor, "documentTop", "get").mockReturnValue(0);
    vi.spyOn(editor, "lineBlockAtHeight").mockReturnValue({
      from: editor.state.doc.line(4).from,
      top: 0,
      height: 20,
    } as ReturnType<typeof editor.lineBlockAtHeight>);

    fireEvent.click(screen.getByRole("button", { name: "Reading mode" }));
    act(() => observers.at(-1)!.callback());

    await waitFor(() =>
      expect(scrollAnchor.scrollReaderToLine).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        4,
      ),
    );
  });

  it("stops following the position once the user scrolls", async () => {
    const user = await start();
    const scroller = editorView().dom.closest<HTMLElement>(".overflow-auto")!;
    await toggle(user, "Reading mode");
    const { disconnect } = observers.at(-1)!;
    expect(disconnect).not.toHaveBeenCalled();

    fireEvent.wheel(scroller);

    expect(disconnect).toHaveBeenCalled();
  });

  it("does not move the scroll position when the mode does not change", async () => {
    await start();
    const editor = editorView();
    vi.spyOn(editor, "documentTop", "get").mockReturnValue(0);
    vi.spyOn(editor, "lineBlockAtHeight").mockReturnValue({
      from: editor.state.doc.line(5).from,
      top: 0,
      height: 20,
    } as ReturnType<typeof editor.lineBlockAtHeight>);
    const scroll = vi.spyOn(EditorView, "scrollIntoView");

    act(() => observers.forEach((observer) => observer.callback([])));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    expect(scrollAnchor.scrollReaderToLine).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });
});
