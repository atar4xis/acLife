import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  buildPlainEvent,
  dispatchWindowPointer,
  openEventEditor,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

const editor = () => screen.getByRole("dialog", { name: "Edit event" });
const header = () => editor().querySelector("h3")!.parentElement!;
const placement = () => {
  const { style } = document.querySelector<HTMLElement>(".event-editor")!;
  return { top: parseFloat(style.top), left: parseFloat(style.left) };
};

const openEditor = async () => {
  const { user } = renderCalendar({ events: [buildPlainEvent()] });
  await openEventEditor(user, "Planning");
};

const grab = (target: Element, init: PointerEventInit = {}) =>
  fireEvent.pointerDown(target, {
    button: 0,
    clientX: 100,
    clientY: 100,
    ...init,
  });

const moveTo = (clientX: number, clientY: number) =>
  dispatchWindowPointer("pointermove", { clientX, clientY });

const release = () => dispatchWindowPointer("pointerup", {});

describe("Event editor dragging", () => {
  const innerWidth = window.innerWidth;
  afterEach(() => {
    window.innerWidth = innerWidth;
  });

  it("follows the pointer when grabbed by the header", async () => {
    await openEditor();
    const start = placement();

    grab(header());
    moveTo(160, 130);

    expect(placement()).toEqual({
      top: start.top + 30,
      left: start.left + 60,
    });
  });

  it("stops following once the pointer is released", async () => {
    await openEditor();

    grab(header());
    moveTo(160, 130);
    release();
    const dropped = placement();
    moveTo(300, 300);

    expect(placement()).toEqual(dropped);
  });

  it("ignores the primary button being something else", async () => {
    await openEditor();
    const start = placement();

    grab(header(), { button: 2 });
    moveTo(160, 130);

    expect(placement()).toEqual(start);
  });

  it("does not start from the body of the editor", async () => {
    await openEditor();
    const start = placement();

    grab(screen.getByPlaceholderText("Planning"));
    moveTo(160, 130);

    expect(placement()).toEqual(start);
  });

  it("does not start from a header button", async () => {
    await openEditor();
    const start = placement();
    const button = header().querySelector("button");
    expect(button).not.toBeNull();

    grab(button!);
    moveTo(160, 130);

    expect(placement()).toEqual(start);
  });

  it("cannot be dragged past the top and left window edges", async () => {
    await openEditor();

    grab(header());
    moveTo(-5000, -5000);

    expect(placement()).toEqual({ top: 0, left: 0 });
  });

  it("cannot be dragged past the bottom and right window edges", async () => {
    await openEditor();

    grab(header());
    moveTo(5000, 5000);

    expect(placement()).toEqual({
      top: window.innerHeight,
      left: window.innerWidth,
    });
  });

  it("shows a grab cursor on the header", async () => {
    await openEditor();

    expect(header().className).toContain("cursor-grab");
  });

  it("cannot be dragged on mobile", async () => {
    window.innerWidth = 500;
    await openEditor();
    const start = placement();

    grab(header());
    moveTo(160, 130);

    expect(placement()).toEqual(start);
    expect(header().className).not.toContain("cursor-grab");
  });
});
