import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Markdown from "react-markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { panesOf } from "../../src/lib/journal/layout.ts";
import {
  createNote,
  editorView,
  journal,
  renderLoadedJournal,
  resetJournal,
  treeItem,
} from "./helpers.tsx";

vi.mock("react-markdown", async (original) => {
  const module = await original<typeof import("react-markdown")>();
  return { ...module, default: vi.fn(module.default) };
});

const renders = vi.hoisted(() => ({ buttons: 0, treeNodes: 0 }));

vi.mock("../../src/components/ui/icon-button.tsx", async (original) => {
  const module =
    await original<typeof import("../../src/components/ui/icon-button.tsx")>();
  return {
    default: (props: Parameters<typeof module.default>[0]) => {
      renders.buttons++;
      return module.default(props);
    },
  };
});

vi.mock("../../src/components/journal/TreeNodes.tsx", async (original) => {
  const module =
    await original<typeof import("../../src/components/journal/TreeNodes.tsx")>();
  return {
    ...module,
    TreeNodes: (props: Parameters<typeof module.TreeNodes>[0]) => {
      renders.treeNodes++;
      return module.TreeNodes(props);
    },
  };
});

beforeEach(() => Object.assign(renders, { buttons: 0, treeNodes: 0 }));
afterEach(resetJournal);

const treeOrder = () =>
  screen.getAllByRole("treeitem").map((row) => row.textContent);

const type = (text: string) =>
  act(() => {
    editorView().dispatch({ changes: { from: 0, insert: text } });
  });

describe("typing", () => {
  it.each(["name-asc", "modified-desc"] as const)(
    "does not re-render the toolbar, tabs or tree when sorted by %s",
    async (sort) => {
      const user = userEvent.setup();
      await renderLoadedJournal();
      await createNote(user, "A");
      await createNote(user, "B");
      act(() => journal.setSort(sort));
      Object.assign(renders, { buttons: 0, treeNodes: 0 });

      type("x");
      type("y");

      expect(renders).toEqual({ buttons: 0, treeNodes: 0 });
    },
  );

  it("reorders the tree by modified time once typing pauses", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    await createNote(user, "A");
    await createNote(user, "B");
    act(() => journal.setSort("modified-desc"));
    await user.click(treeItem("A"));
    expect(treeOrder()).toEqual(["B", "A"]);

    type("x");
    expect(treeOrder()).toEqual(["B", "A"]);

    await waitFor(() => expect(treeOrder()).toEqual(["A", "B"]));
  });

  it("re-renders only the edited block of a reader open in another pane", async () => {
    await renderLoadedJournal();
    let id = "";
    act(() => {
      id = journal.addItem("note", null);
      journal.openNote(id);
      journal.setContent(id, "one\n\ntwo\n\nthree");
      journal.dropOnPane(journal.workspace.focused, "right", { id });
    });
    const [reader] = panesOf(journal.workspace.layout);
    act(() => journal.setReading(reader.id, true));
    vi.mocked(Markdown).mockClear();

    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    });

    expect(vi.mocked(Markdown)).toHaveBeenCalledTimes(1);
  });
});
