import { TreeFragment, type Tree } from "@lezer/common";
import {
  FOOTNOTE_DEFINITION,
  numberFootnotes,
  isHeading,
  isList,
  journalParser,
} from "@/lib/journal/markdownParser";

type BlockVariant = "rule" | "tight" | "joined" | "adjacent";

export type ReaderBlock = {
  line: number;
  source: string;
  numbers: string;
  variant?: BlockVariant;
};

type ReaderFootnote = { label: string; body: string };

export type KeyedBlock = ReaderBlock & { key: string };

export type KeyedBlocks = { blocks: KeyedBlock[]; next: number };

export type ReaderNote = {
  tree: Tree;
  blocks: ReaderBlock[];
  footnotes: ReaderFootnote[];
  footnoteLines: { start: number; end: number };
};

type SyntaxNode = ReturnType<typeof journalParser.parse>["topNode"];

type NodeSpan = {
  name: string;
  from: number;
  to: number;
  wholeLine?: boolean;
  number?: number;
};

const MIN_SPLIT_ITEMS = 10;
const CHUNK_BLOCKS = 25;
const SPLITTABLE_CONTENT = new Set([
  "ListMark",
  "Paragraph",
  "Task",
  "BulletList",
  "OrderedList",
]);
const ORDERED_MARKER = /^(\s*)\d{1,9}([.)])/;

const INLINE_FOOTNOTE = /\[\^([^\]\s]+)\](?!:)/g;

const listItems = (list: SyntaxNode, text: string): SyntaxNode[] => {
  const items: SyntaxNode[] = [];
  for (let item = list.firstChild; item; item = item.nextSibling) {
    for (let child = item.firstChild; child; child = child.nextSibling)
      if (!SPLITTABLE_CONTENT.has(child.name)) return [];
    items.push(item);
  }

  return items.length >= MIN_SPLIT_ITEMS &&
    !/\n[ \t]*\n/.test(text.slice(list.from, list.to))
    ? items
    : [];
};

const parseNote = (text: string, previous?: { text: string; tree: Tree }) => {
  if (!previous) return journalParser.parse(text);

  let from = 0;
  while (
    from < previous.text.length &&
    from < text.length &&
    previous.text.charCodeAt(from) === text.charCodeAt(from)
  )
    from++;
  let toA = previous.text.length;
  let toB = text.length;
  while (
    toA > from &&
    toB > from &&
    previous.text.charCodeAt(toA - 1) === text.charCodeAt(toB - 1)
  ) {
    toA--;
    toB--;
  }

  return journalParser.parse(
    text,
    TreeFragment.applyChanges(TreeFragment.addTree(previous.tree), [
      { fromA: from, toA, fromB: from, toB },
    ]),
  );
};

export const splitNote = (
  text: string,
  previous?: { text: string; tree: Tree },
): ReaderNote => {
  const tree = parseNote(text, previous);
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
  const nodes: NodeSpan[] = [];
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
      const items = isList(node.name) ? listItems(node, text) : [];
      if (items.length === 0) {
        nodes.push({
          name: node.name,
          from: node.from,
          to: node.to,
          wholeLine: node.name === "CodeBlock",
        });
        continue;
      }

      const first = Number(/\d+/.exec(text.slice(node.from, node.to))?.[0]);
      items.forEach((item, i) =>
        nodes.push({
          name: node.name,
          from: item.from,
          to: item.to,
          wholeLine: true,
          number: node.name === "OrderedList" ? first + i : undefined,
        }),
      );
    }
  }

  const numbers = definitions.size
    ? numberFootnotes(tree, (from, to) => text.slice(from, to))
    : new Map<string, number>();

  const referenceText = references.join("\n");
  const blocks = nodes.map(
    ({ name, from, to, wholeLine, number }, i): ReaderBlock => {
      const line = lineOf(from);
      const sliced = text.slice(wholeLine ? lineStarts[line - 1] : from, to);
      const raw =
        number === undefined
          ? sliced
          : sliced.replace(ORDERED_MARKER, `$1${number}$2`);
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
      else if (isHeading(name) && next && isHeading(next.name))
        variant = "tight";
      else if (
        isList(name) &&
        next &&
        isList(next.name) &&
        lineOf(next.from) === lineOf(to) + 1
      )
        variant = "joined";
      else if (next && lineOf(next.from) === lineOf(to) + 1)
        variant = "adjacent";

      return {
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
    },
  );

  const used = [...numbers.keys()].map((label) => definitions.get(label)!);
  return {
    tree,
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

export const keyBlocks = (
  previous: KeyedBlocks,
  blocks: ReaderBlock[],
): KeyedBlocks => {
  const old = previous.blocks;
  const same = (i: number, j: number) => old[i].source === blocks[j].source;
  let head = 0;
  while (head < old.length && head < blocks.length && same(head, head)) head++;
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < blocks.length - head &&
    same(old.length - 1 - tail, blocks.length - 1 - tail)
  )
    tail++;

  let next = previous.next;
  const keyed = blocks.map((block, i): KeyedBlock => {
    const fromEnd = blocks.length - i;
    const reused =
      i < head
        ? old[i]
        : fromEnd <= tail
          ? old[old.length - fromEnd]
          : i < old.length - tail
            ? old[i]
            : undefined;
    return reused &&
      reused.source === block.source &&
      reused.numbers === block.numbers &&
      reused.line === block.line &&
      reused.variant === block.variant
      ? reused
      : { ...block, key: reused?.key ?? String(next++) };
  });

  return { blocks: keyed, next };
};

export const chunkBlocks = (blocks: KeyedBlock[]) =>
  blocks.reduce<KeyedBlock[][]>((chunks, block) => {
    if (chunks.length === 0 || Number(block.key) % CHUNK_BLOCKS === 0)
      chunks.push([block]);
    else chunks[chunks.length - 1].push(block);
    return chunks;
  }, []);
