import type { Command } from "@codemirror/view";

const selectedText = (view: Parameters<Command>[0]) =>
  view.state.selection.ranges
    .map((range) => view.state.doc.sliceString(range.from, range.to))
    .join("\n");

export const copySelection: Command = (view) => {
  navigator.clipboard.writeText(selectedText(view)).catch(() => {});
  return true;
};

export const cutSelection: Command = (view) => {
  navigator.clipboard
    .writeText(selectedText(view))
    .then(() =>
      view.dispatch({
        ...view.state.replaceSelection(""),
        userEvent: "delete.cut",
      }),
    )
    .catch(() => {});
  return true;
};

export const pasteClipboard: Command = (view) => {
  navigator.clipboard
    .readText()
    .then((text) =>
      view.dispatch({
        ...view.state.replaceSelection(text),
        userEvent: "input.paste",
        scrollIntoView: true,
      }),
    )
    .catch(() => {});
  return true;
};
