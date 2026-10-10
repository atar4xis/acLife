import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  ready: true,
  get: vi.fn(),
  set: vi.fn(),
}));
const renderedViews = vi.hoisted(() => [] as string[]);
const calendarEvents = vi.hoisted(() => ({
  saving: false,
  loadEvents: vi.fn(),
  saveEvents: vi.fn(),
  syncEvents: vi.fn(),
  syncBuckets: vi.fn(),
  applyChanges: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { loading: vi.fn(), dismiss: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: { type: "offline" }, masterKey: {}, bucketKey: null }),
}));
vi.mock("../../src/context/CalendarContext.tsx", () => ({
  useCalendarActions: () => ({
    dispatch: vi.fn(),
    pendingChanges: new Map(),
    setCurrentDate: vi.fn(),
    getCurrentDate: vi.fn(),
  }),
}));
vi.mock("../../src/context/CalendarSettingsContext.tsx", () => ({
  useCalendarSettings: (select: (s: object) => object) =>
    select({ defaultView: "week", defaultTimezone: "UTC" }),
}));
vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storage,
}));
vi.mock("../../src/hooks/useSettingsSync.ts", () => ({
  useSettingsSync: () => {},
}));
vi.mock("../../src/hooks/calendar/useCalendarEvents.ts", () => ({
  useCalendarEvents: () => calendarEvents,
}));
vi.mock("../../src/components/calendar/Calendar.tsx", () => ({
  default: ({ active }: { active: boolean }) => (
    <div data-testid="calendar" data-active={String(active)} />
  ),
}));
vi.mock("../../src/components/journal/JournalView.tsx", () => ({
  default: () => <div data-testid="journal" />,
}));
vi.mock("../../src/components/Sidebar.tsx", () => ({
  default: ({
    view,
    onChangeView,
  }: {
    view: string;
    onChangeView: (view: "calendar" | "journal") => void;
  }) => {
    renderedViews.push(view);
    return (
    <>
      <span data-testid="view">{view}</span>
      <button onClick={() => onChangeView("journal")}>to journal</button>
      <button onClick={() => onChangeView("calendar")}>to calendar</button>
    </>
    );
  },
}));
vi.mock("../../src/components/PushService.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/StreamService.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/NotificationService.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/AutoLockService.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/settings/SettingsDialog.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/calendar/TimezoneChangeDialog.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/login/UnlockDialog.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/subscription/SubscriptionDialog.tsx", () => ({ default: () => null }));

const { default: AppShell } = await import("../../src/components/AppShell");

beforeEach(() => {
  storage.ready = true;
  renderedViews.length = 0;
  storage.get.mockReset();
  storage.set.mockReset();
  calendarEvents.loadEvents.mockReset().mockResolvedValue([]);
});

describe("AppShell view", () => {
  it("starts on the calendar", async () => {
    render(<AppShell />);

    expect(screen.getByTestId("view")).toHaveTextContent("calendar");
    await waitFor(() =>
      expect(screen.getByTestId("calendar")).toHaveAttribute("data-active", "true"),
    );
    expect(screen.queryByTestId("journal")).toBeNull();
  });

  it("restores the journal view from storage", async () => {
    storage.get.mockReturnValue("journal");
    render(<AppShell />);

    expect(storage.get).toHaveBeenCalledWith("appView");
    await waitFor(() => expect(screen.getByTestId("view")).toHaveTextContent("journal"));
    expect(screen.getByTestId("journal")).toBeInTheDocument();
  });

  it("renders the saved journal view on the first render", () => {
    storage.get.mockReturnValue("journal");
    render(<AppShell />);

    expect(renderedViews[0]).toBe("journal");
    expect(screen.getByTestId("journal")).toBeInTheDocument();
  });

  it("waits for storage before restoring", async () => {
    storage.ready = false;
    storage.get.mockReturnValue("journal");
    const view = render(<AppShell />);

    expect(screen.getByTestId("view")).toHaveTextContent("calendar");
    expect(storage.get).not.toHaveBeenCalled();

    storage.ready = true;
    view.rerender(<AppShell />);
    await waitFor(() => expect(screen.getByTestId("view")).toHaveTextContent("journal"));
  });

  it("keeps the calendar when storage has no saved view", () => {
    storage.get.mockReturnValue("calendar");
    render(<AppShell />);

    expect(screen.getByTestId("view")).toHaveTextContent("calendar");
  });

  it("persists the view and keeps the calendar mounted but inactive", async () => {
    render(<AppShell />);
    const calendar = await screen.findByTestId("calendar");

    await act(async () => screen.getByText("to journal").click());
    expect(storage.set).toHaveBeenCalledWith("appView", "journal");
    expect(screen.getByTestId("journal")).toBeInTheDocument();
    expect(screen.getByTestId("calendar")).toBe(calendar);
    expect(calendar).toHaveAttribute("data-active", "false");

    await act(async () => screen.getByText("to calendar").click());
    expect(storage.set).toHaveBeenCalledWith("appView", "calendar");
    expect(screen.queryByTestId("journal")).toBeNull();
    expect(calendar).toHaveAttribute("data-active", "true");
  });
});
