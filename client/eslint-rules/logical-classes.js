const PHYSICAL =
  /^-?(?:(?:m[lr]|p[lr]|scroll-[mp][lr])-|text-(?:left|right)|float-(?:left|right)|border-[lr](?:-|$)|rounded-(?:[lr]|[tb][lr])(?:-|$)|(?:left|right)-(?!0$|1\/2$|\[50%\]$)(?:\d|\[|px$|full$))/;


const utility = (token) => {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "[") depth++;
    else if (token[i] === "]") depth--;
    else if (token[i] === ":" && depth === 0) cut = i + 1;
  }
  return { variants: token.slice(0, cut), name: token.slice(cut) };
};

const check = (text) =>
  text.split(/\s+/).flatMap((token) => {
    const { variants, name } = utility(token);
    if (!PHYSICAL.test(name)) return [];
    if (/(?:^|:)(?:rtl|ltr):/.test(variants)) return [];
    if (/\[side=|data-side|\[data-side/.test(token)) return [];
    return [name.replace(/^-/, "")];
  });

export default {
  rules: {
    "logical-classes": {
      meta: {
        type: "problem",
        messages: {
          physical:
            'Physical class "{{name}}" breaks right-to-left layouts. Use the logical form (ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e), or add an rtl:/ltr: variant when it is intentional.',
        },
      },
      create(context) {
        const report = (node, text) => {
          for (const name of check(text)) {
            context.report({ node, messageId: "physical", data: { name } });
          }
        };
        return {
          Literal(node) {
            if (typeof node.value === "string") report(node, node.value);
          },
          TemplateElement(node) {
            report(node, node.value.raw);
          },
        };
      },
    },
  },
};

