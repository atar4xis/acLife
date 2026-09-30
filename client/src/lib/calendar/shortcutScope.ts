const OWNS_KEYS = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable=false])",
  "[data-radix-popper-content-wrapper]",
  ...[
    "dialog",
    "alertdialog",
    "slider",
    "radio",
    "radiogroup",
    "combobox",
    "listbox",
    "option",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "tablist",
    "spinbutton",
    "textbox",
    "searchbox",
    "tree",
    "treeitem",
  ].map((role) => `[role=${role}]`),
].join(",");

// shortcuts apply everywhere unless the focused control uses those keys itself
export function shortcutsApply(target: EventTarget | null) {
  return !(target instanceof Element && target.closest(OWNS_KEYS));
}
