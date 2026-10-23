import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { HEADING_LEVELS } from "@/lib/journal/formatKeymap";

const NODE_FORMATS: Record<string, string> = {
  StrongEmphasis: "bold",
  Emphasis: "italic",
  Strikethrough: "strikethrough",
  InlineCode: "code",
  Link: "link",
  Task: "taskList",
  OrderedList: "numberedList",
  Blockquote: "quote",
  FencedCode: "codeBlock",
  URL: "url",
};

export function activeFormats(state: EditorState) {
  const { from, to } = state.selection.main;
  const formats = new Set<string>();

  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(
      from,
      from === to ? -1 : 1,
    );
    node;
    node = node.parent
  ) {
    const heading = node.name.match(/^ATXHeading([1-6])$/);
    if (heading) formats.add(`heading${heading[1]}`);
    if (node.name === "BulletList") formats.add("bulletList");
    if (NODE_FORMATS[node.name]) formats.add(NODE_FORMATS[node.name]);
  }

  if (formats.has("taskList")) formats.delete("bulletList");
  return [...formats];
}

const ALL_FORMATS = [
  "bold",
  "italic",
  "strikethrough",
  "code",
  "link",
  "bulletList",
  "numberedList",
  "taskList",
  "quote",
  ...HEADING_LEVELS.map((level) => `heading${level}`),
];

export function disabledFormats(active: string[]) {
  const isActive = (format: string) => active.includes(format);
  const inCode = isActive("code");
  const inUrl = isActive("url");

  if (isActive("codeBlock")) return ALL_FORMATS;

  return ALL_FORMATS.filter((format) => {
    if (isActive(format)) return false;
    if (["bold", "italic", "strikethrough"].includes(format))
      return inCode || inUrl;
    if (format === "code") return inUrl;
    if (format === "link") return inCode;
    return false;
  });
}
