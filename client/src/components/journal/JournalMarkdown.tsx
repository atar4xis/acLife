import { openExternal } from "@/lib/nativeUpdater";
import { isValidUrl } from "@/lib/validators";
import { Checkbox } from "@/components/ui/checkbox";
import { ExternalLink } from "lucide-react";
import { memo, useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown, { type Components, type Options } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import HighlightedLines from "@/components/journal/HighlightedLines";
import {
  chunkBlocks,
  keyBlocks,
  splitNote,
  type KeyedBlock,
  type KeyedBlocks,
  type ReaderBlock,
  type ReaderNote,
} from "@/lib/journal/readerBlocks";
import { cn } from "@/lib/utils";

const FOOTNOTE_PREFIX = "user-content-fn-";

const COMPONENTS: Components = {
  a: ({ href, children, ...props }) => {
    const footnote = "data-footnote-ref" in props;
    return (
      <a
        href={href}
        title={footnote ? undefined : href}
        onClick={(e) => {
          e.preventDefault();
          if (href && isValidUrl(href)) openExternal(href);
        }}
      >
        {children}
        {!footnote && (
          <ExternalLink
            aria-hidden
            className="ms-1 inline size-3.5 text-muted-foreground"
          />
        )}
      </a>
    );
  },
  img: ({ alt }) => <span>{alt}</span>,
  code: ({ node, className, children }) => {
    const language = /(?:^|\s)language-(\S+)/.exec(className ?? "")?.[1];

    return (
      <code
        className={className}
        data-line={node?.properties.dataLine as number | undefined}
        data-end-line={node?.properties.dataEndLine as number | undefined}
      >
        {language && typeof children === "string" ? (
          <HighlightedLines code={children} language={language} />
        ) : (
          children
        )}
      </code>
    );
  },
  input: ({ checked }) => <Checkbox checked={!!checked} disabled />,
};

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hProperties: Record<string, string | number> };
  position?: { start: { line: number }; end: { line: number } };
};

const BLOCKS = new Set([
  "paragraph",
  "heading",
  "list",
  "listItem",
  "blockquote",
  "code",
  "table",
  "thematicBreak",
]);

const HTML_PARENTS = new Set(["root", "listItem", "blockquote"]);

const tagBlocks = () => (tree: MdNode) => {
  const walk = (node: MdNode) => {
    node.children = node.children?.map((child) =>
      child.type === "html" && HTML_PARENTS.has(node.type)
        ? {
            type: "code",
            value: child.value,
            position: child.position,
            data: { hProperties: { className: "html-block" } },
          }
        : child,
    );
    node.children?.forEach((child, i) => {
      const previous = node.children![i - 1];
      if (!BLOCKS.has(child.type)) return;
      const joined =
        child.type === "list" &&
        previous?.type === "list" &&
        child.position!.start.line === previous.position!.end.line + 1;
      const { start, end } = child.position!;
      const fenced =
        child.type === "code" &&
        end.line - start.line + 1 > child.value!.split("\n").length;
      child.data = {
        hProperties: {
          ...child.data?.hProperties,
          dataLine: start.line + (fenced ? 1 : 0),
          dataEndLine: end.line - (fenced ? 1 : 0),
          ...(joined && { className: "list-joined" }),
        },
      };
    });
    node.children?.forEach(walk);
  };
  walk(tree);
};

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  position?: { start: { line: number } };
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function footnoteNumbers(numbers: Record<string, number>) {
  return (tree: HastNode) => {
    tree.children = tree.children?.filter(
      (child) => !child.properties?.dataFootnotes,
    );
    const visit = (node: HastNode) => {
      if (node.properties?.dataFootnoteRef !== undefined) {
        const href = String(node.properties.href);
        const id = href.slice(
          href.indexOf(FOOTNOTE_PREFIX) + FOOTNOTE_PREFIX.length,
        );
        const label = id.replace(/(?:%[0-9a-f]{2})+/gi, (escaped) => {
          try {
            return decodeURIComponent(escaped);
          } catch {
            return escaped;
          }
        });
        node.children = [
          { type: "text", value: String(numbers[label] ?? numbers[id]) },
        ];
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function trimTaskSpace() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      node.children?.forEach((child, i) => {
        const next = node.children![i + 1];
        if (child.tagName !== "input") return;
        child.properties!.dataLine = node.position?.start.line;
        if (next?.type === "text") next.value = next.value?.trimStart();
      });
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks, tagBlocks];

const Block = memo(function Block({
  source,
  numbers,
  onToggleTask,
}: {
  source: string;
  numbers: string;
  onToggleTask?: (line: number) => void;
}) {
  const labels = JSON.parse(numbers) as Record<string, number>;
  const rehype = [
    trimTaskSpace,
    ...(Object.keys(labels).length ? [[footnoteNumbers, labels]] : []),
  ] as Options["rehypePlugins"];
  const components = useMemo<Components>(
    () => ({
      ...COMPONENTS,
      input: ({ node, checked }) => (
        <Checkbox
          checked={!!checked}
          onClick={(e) =>
            onToggleTask?.(
              Number(
                e.currentTarget.closest<HTMLElement>("[data-block-start]")!
                  .dataset.blockStart,
              ) +
                Number(node?.properties.dataLine) -
                1,
            )
          }
        />
      ),
    }),
    [onToggleTask],
  );

  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehype}
      components={components}
    >
      {source}
    </Markdown>
  );
});

const BlockItem = memo(function BlockItem({
  source,
  numbers,
  line,
  variant,
  onToggleTask,
}: ReaderBlock & { onToggleTask?: (line: number) => void }) {
  return (
    <div
      className={cn("journal-block", variant && `journal-block-${variant}`)}
      data-block-start={line}
    >
      <Block source={source} numbers={numbers} onToggleTask={onToggleTask} />
    </div>
  );
});

const BlockChunk = memo(
  function BlockChunk({
    blocks,
    onToggleTask,
  }: {
    blocks: KeyedBlock[];
    onToggleTask?: (line: number) => void;
  }) {
    return blocks.map(({ key, ...block }) => (
      <BlockItem key={key} {...block} onToggleTask={onToggleTask} />
    ));
  },
  (previous, next) =>
    previous.onToggleTask === next.onToggleTask &&
    previous.blocks.length === next.blocks.length &&
    previous.blocks.every((block, i) => block === next.blocks[i]),
);

const Footnote = memo(function Footnote({
  label,
  body,
}: {
  label: string;
  body: string;
}) {
  return (
    <li id={`${FOOTNOTE_PREFIX}${label}`}>
      <span className="footnote-label">{label}.</span>
      <div>
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={[trimTaskSpace]}
          components={COMPONENTS}
        >
          {body}
        </Markdown>
      </div>
    </li>
  );
});

const Reader = memo(function Reader({
  source,
  onToggleTask,
}: {
  source: string;
  onToggleTask?: (line: number) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<
    KeyedBlocks & { source?: string; note?: ReaderNote }
  >({ blocks: [], next: 0 });
  let current = state;
  if (state.source !== source) {
    const parsed = splitNote(
      source,
      state.note && { text: state.source!, tree: state.note.tree },
    );
    current = { ...keyBlocks(state, parsed.blocks), source, note: parsed };
    setState(current);
  }
  const note = current.note!;

  return (
    <div className="journal-prose">
      {chunkBlocks(current.blocks).map((blocks) => (
        <BlockChunk
          key={blocks[0].key}
          blocks={blocks}
          onToggleTask={onToggleTask}
        />
      ))}
      {note.footnotes.length > 0 && (
        <section
          data-footnotes="true"
          className="footnotes"
          data-line={note.footnoteLines.start}
          data-end-line={note.footnoteLines.end}
        >
          <h2 className="sr-only">{t("journal.footnotes")}</h2>
          <ol>
            {note.footnotes.map((footnote) => (
              <Footnote key={footnote.label} {...footnote} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
});

function JournalMarkdown({
  children,
  onToggleTask,
}: {
  children: string;
  onToggleTask?: (line: number) => void;
}) {
  return (
    <Reader source={useDeferredValue(children)} onToggleTask={onToggleTask} />
  );
}

export default memo(JournalMarkdown);
