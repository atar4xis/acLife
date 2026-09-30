import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import useFocusTrap from "../../src/hooks/useFocusTrap.ts";

function Trap() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);

  return (
    <>
      <button>outside</button>
      <div ref={ref}>
        <button tabIndex={-1}>skipped first</button>
        <button>first</button>
        <button hidden>hidden</button>
        <button>last</button>
        <a href="#x" tabIndex={-1}>
          skipped last
        </a>
      </div>
    </>
  );
}

const tab = (shiftKey = false) => {
  const target = document.activeElement ?? document.body;
  const notPrevented = fireEvent.keyDown(target, { key: "Tab", shiftKey });
  return !notPrevented;
};

describe("useFocusTrap", () => {
  it("wraps forward from the last tabbable element to the first", () => {
    render(<Trap />);
    screen.getByText("last").focus();

    expect(tab()).toBe(true);
    expect(screen.getByText("first")).toHaveFocus();
  });

  it("wraps backward from the first tabbable element to the last", () => {
    render(<Trap />);
    screen.getByText("first").focus();

    expect(tab(true)).toBe(true);
    expect(screen.getByText("last")).toHaveFocus();
  });

  it("leaves Tab alone between the edges", () => {
    render(<Trap />);
    screen.getByText("first").focus();

    expect(tab()).toBe(false);
  });

  it("pulls focus in when it is on the body", () => {
    render(<Trap />);
    (document.activeElement as HTMLElement | null)?.blur();

    expect(tab()).toBe(true);
    expect(screen.getByText("first")).toHaveFocus();
  });

  it("ignores Tab from elements outside that are not the body", () => {
    render(<Trap />);
    screen.getByText("outside").focus();

    expect(tab()).toBe(false);
    expect(screen.getByText("outside")).toHaveFocus();
  });
});
