import {
  GFM,
  type LeafBlockParser,
  type MarkdownConfig,
  parser,
} from "@lezer/markdown";

const SPACE = /\s|^$/;
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const STRIKETHROUGH = { resolve: "Strikethrough", mark: "StrikethroughMark" };

export const singleTilde: MarkdownConfig = {
  parseInline: [
    {
      name: "SingleTildeStrikethrough",
      after: "Emphasis",
      parse(cx, next, pos) {
        if (next !== 126 || cx.char(pos + 1) === 126) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 1, pos + 2);
        const spaceBefore = SPACE.test(before);
        const spaceAfter = SPACE.test(after);
        const puncBefore = PUNCTUATION.test(before);
        const puncAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(
          STRIKETHROUGH,
          pos,
          pos + 1,
          !spaceAfter && (!puncAfter || spaceBefore || puncBefore),
          !spaceBefore && (!puncBefore || spaceAfter || puncAfter),
        );
      },
    },
  ],
};

export const FOOTNOTE_REFERENCE = /^\[\^([^\]\s]+)\](?!:)/;
export const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*/;

export const footnotes: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteDefinition", block: true },
    "FootnoteLabel",
    "FootnoteReference",
  ],
  parseInline: [
    {
      name: "FootnoteReference",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 94) return -1;
        const match = FOOTNOTE_REFERENCE.exec(cx.slice(pos, cx.end));
        if (!match) return -1;
        return cx.addElement(
          cx.elt("FootnoteReference", pos, pos + match[0].length),
        );
      },
    },
  ],
  parseBlock: [
    {
      name: "FootnoteDefinition",
      before: "LinkReference",
      endLeaf: (_cx, line, leaf) =>
        FOOTNOTE_DEFINITION.test(leaf.content) &&
        FOOTNOTE_DEFINITION.test(line.text.slice(line.pos)),
      leaf: (_cx, leaf) =>
        FOOTNOTE_DEFINITION.test(leaf.content)
          ? ({
              nextLine: () => false,
              finish(cx, leaf) {
                const match = FOOTNOTE_DEFINITION.exec(leaf.content)!;
                const labelEnd = leaf.start + match[0].trimEnd().length;
                const bodyStart = leaf.start + match[0].length;
                cx.addLeafElement(
                  leaf,
                  cx.elt(
                    "FootnoteDefinition",
                    leaf.start,
                    leaf.start + leaf.content.length,
                    [
                      cx.elt("FootnoteLabel", leaf.start, labelEnd),
                      ...cx.parser.parseInline(
                        leaf.content.slice(match[0].length),
                        bodyStart,
                      ),
                    ],
                  ),
                );
                return true;
              },
            } satisfies LeafBlockParser)
          : null,
    },
  ],
};

export const numberFootnotes = (
  tree: ReturnType<typeof journalParser.parse>,
  slice: (from: number, to: number) => string,
) => {
  const defined = new Set<string>();
  const used: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "FootnoteDefinition") {
        if (node.node.parent?.name === "Document")
          defined.add(FOOTNOTE_DEFINITION.exec(slice(node.from, node.to))![1]);
        return false;
      } else if (node.name === "FootnoteReference")
        used.push(FOOTNOTE_REFERENCE.exec(slice(node.from, node.to))![1]);
    },
  });
  const numbers = new Map<string, number>();
  for (const label of used)
    if (defined.has(label) && !numbers.has(label))
      numbers.set(label, numbers.size + 1);
  return numbers;
};

export const isDefinition = (name: string) =>
  name === "LinkReference" || name === "FootnoteDefinition";
export const isHeading = (name: string) => /^(ATX|Setext)Heading/.test(name);
export const isList = (name: string) =>
  name === "BulletList" || name === "OrderedList";

export const journalParser = parser.configure([GFM, singleTilde, footnotes]);
