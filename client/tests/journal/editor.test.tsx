import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNote,
  dragAt,
  dragStart,
  editorView,
  editorViews,
  renderJournal,
  resetJournal,
  tabList,
} from "./helpers.tsx";
import JournalEditor from "../../src/components/journal/JournalEditor.tsx";
import { render } from "@testing-library/react";
import { openExternal } from "../../src/lib/nativeUpdater.ts";

afterEach(resetJournal);

describe("journal editor and reading mode", () => {
  it("ignores a stale echo of its own earlier edit", () => {
    const onChange = vi.fn();
    const props = { label: "Editor", placeholder: "", onChange };
    const view = render(<JournalEditor {...props} value="" />);
    const editor = editorView();

    act(() => editor.dispatch({ changes: { from: 0, insert: "ab" } }));
    act(() => editor.dispatch({ changes: { from: 2, insert: "c" } }));
    view.rerender(<JournalEditor {...props} value="ab" />);

    expect(editor.state.doc.toString()).toBe("abc");
    expect(onChange).toHaveBeenLastCalledWith("abc");

    view.rerender(<JournalEditor {...props} value="other" />);
    expect(editor.state.doc.toString()).toBe("other");
  });
  it("only treats hidden markup as atomic, not formatted text", () => {
    render(
      <JournalEditor
        label="Editor"
        placeholder=""
        value={"**bold** and `code` and [abc](u)"}
        onChange={vi.fn()}
      />,
    );
    const view = editorView();
    const atomic = view.state
      .facet(EditorView.atomicRanges)
      .map((get) => get(view));
    const covered = (pos: number) => {
      let hit = false;
      atomic.forEach((set) =>
        set.between(pos, pos, (from, to) => {
          if (pos > from && pos < to) hit = true;
        }),
      );
      return hit;
    };

    expect(covered(4)).toBe(false);
    expect(covered(17)).toBe(false);
    expect(covered(26)).toBe(false);
    expect(covered(1)).toBe(false);
  });

  it("opens only http links on ctrl click", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Links");
    const view = editorView();
    vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(1);

    const click = (text: string) => {
      act(() => {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
        });
      });
      fireEvent.click(view.contentDOM, { ctrlKey: true });
    };

    click("[a](foo)");
    click("[a](javascript:alert(1))");
    expect(openExternal).not.toHaveBeenCalled();

    click("[a](https://example.com)");
    expect(openExternal).toHaveBeenCalledWith("https://example.com");

    fireEvent.click(view.contentDOM);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
  it("indents with Tab until Escape releases it", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Tabs");
    const view = editorView();
    const press = (key: string, shiftKey = false) => {
      act(() => {
        view.contentDOM.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    };
    const tab = (shiftKey = false) => {
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        view.contentDOM.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };

    expect(tab()).toBe(true);
    expect(view.state.doc.toString()).not.toBe("");

    press("Escape");
    expect(tab()).toBe(false);
    expect(tab(true)).toBe(false);

    press("a");
    expect(tab()).toBe(true);
  });
  it("does not open unsafe or relative links in reading mode", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Read");
    act(() => {
      editorView().dispatch({
        changes: {
          from: 0,
          insert: "[rel](#x) [web](https://example.com) [mail](mailto:a@b.c)",
        },
      });
    });
    await user.click(screen.getByRole("button", { name: "Reading mode" }));

    await user.click(screen.getByRole("link", { name: "rel" }));
    await user.click(screen.getByRole("link", { name: "mail" }));
    expect(openExternal).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: "web" }));
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });
  it("keeps the last name while the title is empty until blur", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Named");
    const title = screen.getByRole("textbox", { name: "Title" });

    await user.clear(title);
    expect((title as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("Close Named")).toBeTruthy();

    act(() => title.blur());
    expect((title as HTMLInputElement).value).toBe("Untitled");
    expect(screen.getByLabelText("Close Untitled")).toBeTruthy();
  });
  it("survives a link title that spans lines", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Links");

    const text = '[a](http://x.com "one\ntwo")\n\nend';
    act(() => {
      editorView().dispatch({
        changes: { from: 0, insert: text },
        selection: { anchor: text.length },
      });
    });

    expect(editorView().state.doc.toString()).toBe(text);
    expect(editorView().contentDOM.textContent).toContain("two");
  });

  it("renders markdown live and shows the markup where the cursor is", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Doc");

    const view = editorView();
    act(() => {
      view.dispatch({
        changes: { from: 0, insert: "# Head\n\nsome **bold** text" },
        selection: { anchor: 24 },
      });
    });

    const content = view.contentDOM;
    expect(content.querySelector(".cm-h1")?.textContent).toBe("Head");
    expect(content.querySelector(".cm-strong")?.textContent).toBe("bold");
    expect(content.textContent).not.toContain("**");

    act(() => view.dispatch({ selection: { anchor: 5 } }));
    expect(content.querySelector(".cm-h1")?.textContent).toBe("# Head");
  });

  it("sizes headings from the shared heading scale", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Doc");

    act(() => {
      editorView().dispatch({
        changes: {
          from: 0,
          insert: "# One\n\n## Two\n\n### Three\n\n#### Four",
        },
        selection: { anchor: 0 },
      });
    });

    const rules = Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules).map((rule) => rule.cssText),
    );
    for (const level of [1, 2, 3, 4]) {
      expect(
        editorView().contentDOM.querySelector(`.cm-h${level}`),
      ).toBeTruthy();
      expect(rules.find((rule) => rule.includes(`.cm-h${level}`))).toContain(
        `font-size: var(--journal-h${level}-size)`,
      );
    }
  });

  it("styles fenced code as a block and keeps the fences while the cursor is inside", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Code");

    act(() => {
      editorView().dispatch({
        changes: { from: 0, insert: "```js\nconst a = 1;\nf(a);\n```\n\nend" },
        selection: { anchor: 33 },
      });
    });

    const content = editorView().contentDOM;
    expect(content.querySelectorAll(".cm-codeblock")).toHaveLength(4);
    expect(content.querySelectorAll(".cm-code-first")).toHaveLength(1);
    expect(content.querySelectorAll(".cm-code-last")).toHaveLength(1);
    expect(content.textContent).not.toContain("```");

    act(() => editorView().dispatch({ selection: { anchor: 8 } }));
    expect(content.textContent).toContain("```js");
  });

  it("styles quotes and hides the quote mark away from the cursor", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Quote");

    const text = "> quoted\n\nend";
    act(() => {
      editorView().dispatch({
        changes: { from: 0, insert: text },
        selection: { anchor: text.length },
      });
    });

    const content = editorView().contentDOM;
    expect(content.querySelector(".cm-quote")?.textContent).toBe("quoted");
    act(() => editorView().dispatch({ selection: { anchor: 3 } }));
    expect(content.querySelector(".cm-quote")?.textContent).toBe("> quoted");
  });

  it("shows bullets, rules and task checkboxes, and toggles a task by clicking it", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Tasks");

    const text = "- item\n\n---\n\n- [ ] todo\n\nend";
    act(() => {
      editorView().dispatch({
        changes: { from: 0, insert: text },
        selection: { anchor: text.length },
      });
    });

    const content = editorView().contentDOM;
    expect(content.querySelectorAll(".cm-bullet")).toHaveLength(2);
    expect(content.querySelector(".cm-rule")).toBeTruthy();
    const box = content.querySelector<HTMLInputElement>(".cm-task")!;
    expect(box.checked).toBe(false);

    fireEvent.click(box);

    expect(editorView().state.doc.toString()).toContain("- [x] todo");
    expect(content.querySelector<HTMLInputElement>(".cm-task")!.checked).toBe(
      true,
    );

    fireEvent.click(content.querySelector(".cm-task")!);
    expect(editorView().state.doc.toString()).toContain("- [ ] todo");
  });

  it("switches each split between reading and edit mode", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    renderJournal();
    await createNote(user, "Left");
    await createNote(user, "Right");
    await dragStart(within(tabList()).getByText("Right").closest("li")!);
    dragAt("dragOver", screen.getByTestId("drop-overlay"), 95, 50);
    dragAt("drop", screen.getByTestId("drop-overlay"), 95, 50);
    await waitFor(() =>
      expect(
        screen.getAllByRole("tablist", { name: "Open notes" }),
      ).toHaveLength(2),
    );

    act(() => {
      const view = editorViews()[1];
      view.dispatch({
        changes: { from: 0, insert: "# Read me\n\n```js\nconst a = 1;\n```" },
      });
    });
    const buttons = screen.getAllByRole("button", { name: "Reading mode" });
    expect(buttons).toHaveLength(2);

    await user.click(buttons[1]);
    expect(screen.getByRole("heading", { name: "Read me" })).toBeTruthy();
    expect(document.querySelector("article pre code")?.textContent).toContain(
      "const",
    );
    expect(
      screen.getAllByRole("button", { name: "Reading mode" }),
    ).toHaveLength(1);
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Edit mode" }));
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Read me" })).toBeNull();
  });
});
