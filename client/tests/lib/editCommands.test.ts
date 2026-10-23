import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, expect, test, vi } from "vitest";
import {
  copySelection,
  cutSelection,
  pasteClipboard,
} from "@/lib/journal/editCommands";

const makeView = (doc: string, anchor: number, head: number) => {
  const view = {
    state: EditorState.create({ doc, selection: { anchor, head } }),
    dispatch: (...specs: TransactionSpec[]) => {
      view.state = view.state.update(...specs).state;
    },
  };
  return view as unknown as EditorView;
};

const stubClipboard = (clipboard: Partial<Clipboard>) =>
  vi.stubGlobal("navigator", { clipboard });

afterEach(() => vi.unstubAllGlobals());

test("cut removes the selection once it is on the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubClipboard({ writeText });
  const view = makeView("hello world", 0, 5);

  cutSelection(view);
  await vi.waitFor(() => expect(view.state.doc.toString()).toBe(" world"));
  expect(writeText).toHaveBeenCalledWith("hello");
});

test("cut keeps the text when the clipboard write fails", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  stubClipboard({ writeText });
  const view = makeView("hello world", 0, 5);

  cutSelection(view);
  await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe("hello world");
});

test("copy leaves the document alone and survives a failed write", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  stubClipboard({ writeText });
  const view = makeView("hello world", 6, 11);

  copySelection(view);
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("world"));
  expect(view.state.doc.toString()).toBe("hello world");
});

test("paste replaces the selection with the clipboard text", async () => {
  stubClipboard({ readText: vi.fn().mockResolvedValue("there") });
  const view = makeView("hello world", 6, 11);

  pasteClipboard(view);
  await vi.waitFor(() => expect(view.state.doc.toString()).toBe("hello there"));
});

test("paste does nothing when the clipboard cannot be read", async () => {
  const readText = vi.fn().mockRejectedValue(new Error("denied"));
  stubClipboard({ readText });
  const view = makeView("hello", 0, 5);

  pasteClipboard(view);
  await vi.waitFor(() => expect(readText).toHaveBeenCalled());
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe("hello");
});
