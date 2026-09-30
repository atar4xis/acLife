import { act, fireEvent, screen } from "@testing-library/react";

export const grid = () => screen.getByRole("grid");

export const activeElement = () =>
  document.getElementById(
    screen
      .getByRole("grid", { hidden: true })
      .getAttribute("aria-activedescendant") ?? "",
  );

// what a screen reader speaks for the active descendant
export const spoken = () => activeElement()?.getAttribute("aria-label") ?? "";

// like tabbing in: a Tab key press precedes the focus
export const focusGrid = () => {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => grid().focus());
  return grid();
};
