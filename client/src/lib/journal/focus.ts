const focusSoon = (
  attribute: string,
  id: string,
  shouldFocus: () => boolean = () => true,
) =>
  setTimeout(() => {
    if (!shouldFocus()) return;
    Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`))
      .find((element) => element.getAttribute(attribute) === id)
      ?.focus();
  });

const focusIsFree = () => document.activeElement === document.body;

export const focusRow = (id: string) =>
  focusSoon("data-item-id", id, focusIsFree);

export const focusTab = (id: string) => focusSoon("data-tab-id", id);

export const focusAfterLastClose = () =>
  setTimeout(() =>
    (
      document.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
      ) ?? document.querySelector<HTMLElement>("[data-new-tab]")
    )?.focus(),
  );

export const openContextMenu = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
};
