import { openExternal } from "@/lib/nativeUpdater";
import { isValidUrl } from "@/lib/validators";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && isValidUrl(href)) openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  img: ({ alt }) => <span>{alt}</span>,
};

const REMARK_PLUGINS = [remarkGfm];

export default function JournalMarkdown({ children }: { children: string }) {
  return (
    <div className="journal-prose">
      <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  );
}
