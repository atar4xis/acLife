import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { lastInputModality } from "../../src/lib/inputModality.ts";

describe("lastInputModality", () => {
  it("starts as pointer until a key is pressed", () => {
    expect(lastInputModality()).toBe("pointer");
  });

  it("follows the latest pointer press or key press", () => {
    fireEvent.pointerDown(document.body);
    expect(lastInputModality()).toBe("pointer");

    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(lastInputModality()).toBe("keyboard");

    fireEvent.pointerDown(document.body);
    expect(lastInputModality()).toBe("pointer");
  });

  it("ignores modifier keys on their own", () => {
    fireEvent.pointerDown(document.body);
    for (const key of ["Shift", "Control", "Alt", "Meta"])
      fireEvent.keyDown(document.body, { key });

    expect(lastInputModality()).toBe("pointer");
  });

  it("counts a modified key press", () => {
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });

    expect(lastInputModality()).toBe("keyboard");
  });

  it("sees events that stop propagating, since it listens in the capture phase", () => {
    const el = document.createElement("div");
    el.addEventListener("keydown", (e) => e.stopPropagation());
    document.body.appendChild(el);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(el, { key: "a" });

    expect(lastInputModality()).toBe("keyboard");
  });
});
