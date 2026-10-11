import { type EditorView, WidgetType } from "@codemirror/view";
import { ExternalLink } from "lucide-react";
import { type ReactElement, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import JournalMarkdown from "@/components/journal/JournalMarkdown";
import { Checkbox } from "@/components/ui/checkbox";
import { openExternal } from "@/lib/nativeUpdater";
import { cn } from "@/lib/utils";
import { isValidUrl } from "@/lib/validators";

export const BULLET_GAP = "0.5rem";
export const NUMBER_GAP = "0.25rem";
export const BULLETS = ["•", "◦", "▪"];

const marker = (depth: number, className: string) => {
  const box = document.createElement("span");
  box.className = className;
  box.style.width = `calc(${depth} * var(--journal-indent))`;
  return box;
};

export class ListMarkerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly depth: number,
    readonly bullet: boolean,
  ) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return (
      other.text === this.text &&
      other.depth === this.depth &&
      other.bullet === this.bullet
    );
  }

  toDOM() {
    const box = marker(
      this.depth,
      cn("cm-list-marker", this.bullet && "cm-bullet"),
    );
    box.style.paddingInlineEnd = this.bullet ? BULLET_GAP : NUMBER_GAP;
    if (this.bullet) {
      box.style.fontSize = "var(--journal-bullet-size)";
      box.style.lineHeight = "1";
    }
    box.textContent = this.text;
    return box;
  }
}

export class FootnoteRefWidget extends WidgetType {
  constructor(readonly number: number) {
    super();
  }

  eq(other: FootnoteRefWidget) {
    return other.number === this.number;
  }

  toDOM() {
    const sup = document.createElement("sup");
    sup.className = "cm-footnote-ref";
    const link = document.createElement("a");
    link.textContent = String(this.number);
    sup.append(link);
    return sup;
  }

  ignoreEvent() {
    return false;
  }
}

export class FootnoteLabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: FootnoteLabelWidget) {
    return other.label === this.label;
  }

  toDOM(view: EditorView) {
    const label = document.createElement("span");
    label.className = "cm-footnote-label";
    label.textContent = `${this.label}.`;
    label.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { left, width } = label.getBoundingClientRect();
      const ratio = width
        ? Math.min(Math.max((e.clientX - left) / width, 0), 1)
        : 0;
      const anchor =
        view.posAtDOM(label) + 2 + Math.round(ratio * this.label.length);
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
    });
    return label;
  }

  ignoreEvent() {
    return false;
  }
}

export class LinkIconWidget extends WidgetType {
  constructor(readonly href: string) {
    super();
  }

  eq(other: LinkIconWidget) {
    return other.href === this.href;
  }

  toDOM() {
    const icon = document.createElement("span");
    icon.className = "cm-link-icon";
    icon.title = this.href;
    icon.addEventListener("mousedown", (e) => e.preventDefault());
    icon.addEventListener("click", () => {
      if (isValidUrl(this.href)) openExternal(this.href);
    });
    return mount(icon, createElement(ExternalLink));
  }

  destroy(dom: HTMLElement) {
    unmount(dom);
  }

  ignoreEvent() {
    return false;
  }
}

export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-rule";
    return rule;
  }
}

const roots = new WeakMap<HTMLElement, Root>();

const mount = (host: HTMLElement, element: ReactElement) => {
  const root = createRoot(host);
  roots.set(host, root);
  root.render(element);
  return host;
};

const unmount = (host: HTMLElement) => {
  const root = roots.get(host);
  roots.delete(host);
  setTimeout(() => root?.unmount());
};

export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly depth: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.depth === this.depth;
  }

  toDOM(view: EditorView) {
    const wrapper = marker(this.depth, "cm-list-marker");
    return mount(
      wrapper,
      createElement(Checkbox, {
        className: "cm-task",
        checked: this.checked,
        onMouseDown: (e) => e.preventDefault(),
        onCheckedChange: () => {
          const from = view.posAtDOM(wrapper);
          view.dispatch({
            changes: {
              from,
              to: from + 3,
              insert: this.checked ? "[ ]" : "[x]",
            },
          });
        },
      }),
    );
  }

  destroy(dom: HTMLElement) {
    unmount(dom);
  }

  ignoreEvent() {
    return false;
  }
}

export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: TableWidget) {
    return other.source === this.source;
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-table";
    return mount(wrapper, createElement(JournalMarkdown, null, this.source));
  }

  destroy(dom: HTMLElement) {
    unmount(dom);
  }

  ignoreEvent() {
    return false;
  }
}
