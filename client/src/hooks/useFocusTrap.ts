import { useEffect, type RefObject } from "react";

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isRendered = (el: HTMLElement, root: HTMLElement) => {
  if (getComputedStyle(el).visibility === "hidden") return false;
  let node: HTMLElement | null = el;
  while (node && node !== root.parentElement) {
    if (getComputedStyle(node).display === "none") return false;
    node = node.parentElement;
  }
  return true;
};

export default function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const container = ref.current;
      if (e.key !== "Tab" || !container) return;

      const target = e.target;
      const inside = target instanceof Node && container.contains(target);
      if (!inside && target !== document.body) return;

      const items = Array.from(
        container.querySelectorAll<HTMLElement>(TABBABLE),
      ).filter((el) => el.tabIndex >= 0 && isRendered(el, container));
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (!inside || (e.shiftKey && target === first)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && target === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [ref]);
}
