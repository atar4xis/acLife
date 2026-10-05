import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { DateTime } from "luxon";
import {
  CalendarProvider,
  useCalendarActions,
  useCurrentDate,
  useEditing,
  useEventList,
} from "../../src/context/CalendarContext.tsx";
import {
  useEventSelected,
  useSelectedEvents,
} from "../../src/hooks/useSelection.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

const event = (id: string): CalendarEvent => ({
  id,
  title: id,
  start: DateTime.fromISO("2026-03-18T09:00"),
  end: DateTime.fromISO("2026-03-18T10:00"),
  timestamp: 0,
});

type Actions = ReturnType<typeof useCalendarActions>;

const setup = () => {
  const renders = { actions: 0, date: 0, events: 0, editing: 0 };
  let actions!: Actions;

  const Probes = () => {
    actions = useCalendarActions();
    renders.actions++;
    return (
      <>
        <DateProbe />
        <EventsProbe />
        <EditingProbe />
      </>
    );
  };
  const DateProbe = () => {
    useCurrentDate();
    renders.date++;
    return null;
  };
  const EventsProbe = () => {
    useEventList();
    renders.events++;
    return null;
  };
  const EditingProbe = () => {
    useEditing();
    renders.editing++;
    return null;
  };

  render(
    <CalendarProvider>
      <Probes />
    </CalendarProvider>,
  );

  return { renders, actions: () => actions };
};

describe("calendar context slices", () => {
  it("renders readers of one slice only when that slice changes", () => {
    const { renders, actions } = setup();
    // Probes owns the nested ones, so count them against a fresh baseline
    const base = { ...renders };

    act(() => actions().selection.toggle(event("a")));
    expect(renders).toEqual(base);

    act(() => actions().setEditingEvent(event("a"), 1));
    expect(renders.editing).toBe(base.editing + 1);
    expect(renders.date).toBe(base.date);
    expect(renders.events).toBe(base.events);

    act(() => actions().setCurrentDate(DateTime.fromISO("2026-04-01")));
    expect(renders.date).toBe(base.date + 1);
    expect(renders.events).toBe(base.events);

    act(() => actions().dispatch({ type: "add", event: event("a") }));
    expect(renders.events).toBe(base.events + 1);
  });

  it("keeps the actions identical across every state change", () => {
    const { actions } = setup();
    const before = actions();

    act(() => actions().selection.toggle(event("a")));
    act(() => actions().setEditingEvent(event("a"), 0));
    act(() => actions().setCurrentDate(DateTime.fromISO("2026-04-01")));
    act(() => actions().dispatch({ type: "add", event: event("a") }));

    expect(actions()).toBe(before);
  });

  it("does not render again when editing is set to what it already is", () => {
    const { renders, actions } = setup();
    const target = event("a");
    act(() => actions().setEditingEvent(target, 2));
    const before = renders.editing;

    act(() => actions().setEditingEvent(target, 2));
    expect(renders.editing).toBe(before);

    act(() => actions().setEditingEvent(null));
    act(() => actions().setEditingEvent(null));
    expect(renders.editing).toBe(before + 1);
  });

  it("reads the date as of the latest render", () => {
    const { actions } = setup();

    act(() => actions().setCurrentDate(DateTime.fromISO("2026-05-05")));

    expect(actions().getCurrentDate().toISODate()).toBe("2026-05-05");
  });

  it("reads the new date right after setting it, before any render", () => {
    const { actions } = setup();

    act(() => {
      actions().setCurrentDate(DateTime.fromISO("2026-05-05"));
      expect(actions().getCurrentDate().toISODate()).toBe("2026-05-05");

      actions().setCurrentDate((date) => date.plus({ days: 1 }));
      actions().setCurrentDate((date) => date.plus({ days: 1 }));
      expect(actions().getCurrentDate().toISODate()).toBe("2026-05-07");
    });
  });

  it("applies functional date updates", () => {
    const { actions } = setup();
    act(() => actions().setCurrentDate(DateTime.fromISO("2026-05-05")));

    act(() => actions().setCurrentDate((date) => date.plus({ days: 1 })));

    expect(actions().getCurrentDate().toISODate()).toBe("2026-05-06");
  });

  it("calls the latest registered edit handler through one stable function", () => {
    const { actions } = setup();
    const { eventHandlers, setEventHandlers } = actions();
    const first = vi.fn();
    const second = vi.fn();
    const handlers = (edit: typeof first) => ({
      edit,
      move: vi.fn(),
      remove: vi.fn(),
      duplicate: vi.fn(),
      detach: vi.fn(),
      reset: vi.fn(),
    });

    setEventHandlers(handlers(first));
    eventHandlers.edit(event("a"), event("b"));
    setEventHandlers(handlers(second));
    eventHandlers.edit(event("a"), event("c"));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(actions().eventHandlers).toBe(eventHandlers);
  });

  it("throws outside a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useCurrentDate())).toThrow(
      "useCurrentDate must be used within a CalendarProvider",
    );
  });
});

describe("selection hooks", () => {
  it("re-renders an event only when its own selected state flips", () => {
    const renders = { a: 0, b: 0, all: 0 };
    let actions!: Actions;

    const Controls = () => {
      actions = useCalendarActions();
      return null;
    };
    const Row = ({ id }: { id: "a" | "b" }) => {
      const { selection } = useCalendarActions();
      const selected = useEventSelected(selection, id);
      renders[id]++;
      return <span data-testid={id}>{String(selected)}</span>;
    };
    const All = () => {
      const { selection } = useCalendarActions();
      const selected = useSelectedEvents(selection);
      renders.all++;
      return <span data-testid="all">{selected.size}</span>;
    };

    const { getByTestId } = render(
      <CalendarProvider>
        <Controls />
        <Row id="a" />
        <Row id="b" />
        <All />
      </CalendarProvider>,
    );
    const base = { ...renders };

    act(() => actions.selection.toggle(event("a")));

    expect(getByTestId("a")).toHaveTextContent("true");
    expect(getByTestId("b")).toHaveTextContent("false");
    expect(getByTestId("all")).toHaveTextContent("1");
    expect(renders.a).toBe(base.a + 1);
    expect(renders.b).toBe(base.b);
    expect(renders.all).toBe(base.all + 1);
  });
});
