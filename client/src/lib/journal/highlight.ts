import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-json";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

type Segment = { text: string; className?: string };

// prism's nested tokens -> flat segments, each keeps its innermost token's classes
const flatten = (
  tokens: (string | Prism.Token)[],
  className: string | undefined,
  out: Segment[],
) => {
  for (const token of tokens) {
    if (typeof token === "string") {
      if (token) out.push({ text: token, className });
      continue;
    }

    const own = [token.type, ...[token.alias ?? []].flat()]
      .map((name) => `tok-${name}`)
      .join(" ");

    const { content } = token;
    if (typeof content === "string")
      out.push({ text: content, className: own });
    else flatten([content].flat(), own, out);
  }
};

export function highlightCode(code: string, language: string): Segment[] {
  const grammar = Prism.languages[language.toLowerCase()];
  if (!grammar) return [{ text: code }];

  const out: Segment[] = [];
  flatten(Prism.tokenize(code, grammar), undefined, out);
  return out;
}
