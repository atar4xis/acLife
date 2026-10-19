import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSelectionBox } from "../../src/hooks/useSelectionBox";

const onBox = vi.fn();
const onClick = vi.fn();

function Box() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { begin, box } = useSelectionBox<string>({
    containerRef,
    getRects: () => [{ key: "a", left: 0, right: 50, top: 0, bottom: 50 }],
    onBox,
    onClick,
  });

  return (
    <div ref={containerRef} onPointerDown={(e) => begin(e, "session")}>
      area
      {box && <span data-testid="box" />}
    </div>
  );
}

const press = () =>
  fireEvent.pointerDown(screen.getByText("area"), {
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  });

afterEach(() => {
  onBox.mockReset();
  onClick.mockReset();
});

describe("useSelectionBox", () => {
  it("reports a click when the pointer does not move", () => {
    render(<Box />);

    press();
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onClick).toHaveBeenCalledWith("session");
    expect(onBox).not.toHaveBeenCalled();
    expect(screen.queryByTestId("box")).toBeNull();
  });

  it("reports boxed keys once the pointer moved past the threshold", () => {
    render(<Box />);

    press();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 40 });
    expect(screen.getByTestId("box")).toBeTruthy();
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onBox).toHaveBeenLastCalledWith(new Set(["a"]), "session");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("drops the box on pointer cancel without reporting a click", () => {
    render(<Box />);

    press();
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 40 });
    fireEvent.pointerCancel(window, { pointerId: 1 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 20 });

    expect(screen.queryByTestId("box")).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted mid-drag", () => {
    const view = render(<Box />);

    press();
    view.unmount();
    onBox.mockReset();
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 40 });
    });

    expect(onBox).not.toHaveBeenCalled();
  });
});
