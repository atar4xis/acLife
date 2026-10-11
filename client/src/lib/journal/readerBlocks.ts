import {
  FOOTNOTE_DEFINITION,
  numberFootnotes,
  isHeading,
  isList,
  journalParser,
} from "@/lib/journal/markdownParser";

type BlockVariant = "rule" | "tight" | "joined" | "adjacent";

type ReaderBlock = {
  key: string;
  line: number;
  source: string;
  numbers: string;
  variant?: BlockVariant;
};

type ReaderFootnote = { label: string; body: string };

type ReaderNote = {
  blocks: ReaderBlock[];
  footnotes: ReaderFootnote[];
  footnoteLines: { start: number; end: number };
};

const INLINE_FOOTNOTE = /\[\^([^\]\s]+)\](?!:)/g;

const hash = (text: string) => {
  let value = 5381;
  for (let i = 0; i < text.length; i++)
    value = ((value << 5) + value + text.charCodeAt(i)) | 0;
  return value;
};

export const splitNote = (text: string): ReaderNote => {
  const tree = journalParser.parse(text);
  const lineStarts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
    lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= pos) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };

  const references: string[] = [];
  const definitions = new Map<
    string,
    { body: string; start: number; end: number }
  >();
  const nodes: { name: string; from: number; to: number }[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const raw = text.slice(node.from, node.to);
    if (node.name === "LinkReference") {
      references.push(raw);
    } else if (node.name === "FootnoteDefinition") {
      const match = FOOTNOTE_DEFINITION.exec(raw)!;
      if (!definitions.has(match[1]))
        definitions.set(match[1], {
          body: raw.slice(match[0].length),
          start: lineOf(node.from),
          end: lineOf(node.to),
        });
    } else {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    }
  }

  const numbers = definitions.size
    ? numberFootnotes(tree, (from, to) => text.slice(from, to))
    : new Map<string, number>();

  const referenceText = references.join("\n");
  const seen = new Map<number, number>();
  const blocks = nodes.map(({ name, from, to }, i): ReaderBlock => {
    const line = lineOf(from);
    const raw = text.slice(
      name === "CodeBlock" ? lineStarts[line - 1] : from,
      to,
    );
    const labels = definitions.size
      ? [
          ...new Set(
            Array.from(raw.matchAll(INLINE_FOOTNOTE), (match) => match[1]),
          ),
        ].filter((label) => numbers.has(label))
      : [];
    const inert = name === "FencedCode" || name === "HTMLBlock";
    const extra = inert
      ? []
      : [
          ...(referenceText && raw.includes("[") ? [referenceText] : []),
          ...labels.map((label) => `[^${label}]: x`),
        ];
    const source = extra.length ? `${raw}\n\n${extra.join("\n")}` : raw;
    const next = nodes[i + 1];

    let variant: BlockVariant | undefined;
    if (name === "HorizontalRule") variant = "rule";
    else if (isHeading(name) && next && isHeading(next.name)) variant = "tight";
    else if (
      isList(name) &&
      next &&
      isList(next.name) &&
      lineOf(next.from) === lineOf(to) + 1
    )
      variant = "joined";
    else if (next && lineOf(next.from) === lineOf(to) + 1) variant = "adjacent";

    const digest = hash(source);
    const count = seen.get(digest) ?? 0;
    seen.set(digest, count + 1);
    return {
      key: `${digest}:${count}`,
      line,
      source,
      numbers: JSON.stringify(
        Object.fromEntries(
          labels.map((label) => [
            label.toUpperCase().toLowerCase(),
            numbers.get(label),
          ]),
        ),
      ),
      variant,
    };
  });

  const used = [...numbers.keys()].map((label) => definitions.get(label)!);
  return {
    blocks,
    footnotes: [...numbers.keys()].map((label) => ({
      label,
      body: definitions.get(label)!.body,
    })),
    footnoteLines: {
      start: Math.min(...used.map((item) => item.start)),
      end: Math.max(...used.map((item) => item.end)),
    },
  };
};
