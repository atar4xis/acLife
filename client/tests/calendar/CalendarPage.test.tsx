import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLanguage } from "../../src/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import LanguageSync from "../../src/components/LanguageSync.tsx";
import RegionPage from "../../src/components/settings/pages/RegionPage.tsx";
import CalendarPage from "../../src/components/settings/pages/CalendarPage.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";
import { readSettings } from "../settingsStorage.ts";

function Harness() {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <CalendarPage sectionRefs={sectionRefs} />;
}

const renderCalendarPage = () =>
  render(
    <SettingsStoreProvider>
      <LanguageSync />
      <CalendarProvider>
        <Harness />
      </CalendarProvider>
    </SettingsStoreProvider>,
  );

// below-the-fold sections mount after idle, so wait for their skeletons to go
const renderLoadedCalendarPage = async () => {
  const result = renderCalendarPage();
  await waitFor(() =>
    expect(
      document.querySelector('[data-slot="skeleton"]'),
    ).not.toBeInTheDocument(),
  );
  return result;
};

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ get: () => "{}" }),
}));

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
}));

const stubCache = () => {
  const put = vi.fn();
  vi.stubGlobal("caches", {
    open: async () => ({ put, match: async () => new Response("x") }),
  });
  URL.createObjectURL = () => "blob:custom";
  URL.revokeObjectURL = () => {};
  return put;
};

const stubAudio = () => {
  const players: { src: string; volume: number }[] = [];
  vi.stubGlobal("Audio", function (src: string) {
    const player = {
      src,
      volume: 1,
      pause: () => {},
      play: () => Promise.resolve(),
    };
    players.push(player);
    return player;
  });
  return players;
};

describe("CalendarPage", () => {
  afterEach(() => {
    applyLanguage("en");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mocks.toastError.mockReset();
  });

  beforeEach(() => {
    // radix Select relies on pointer capture, which jsdom doesn't implement
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it("renders the current default view selection", () => {
    renderCalendarPage();

    expect(screen.getByText("Week")).toBeInTheDocument();
  });

  it("renders the current snap minutes and default event duration", () => {
    renderCalendarPage();

    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
  });

  it("renders default event and task name inputs with their stored values", () => {
    renderCalendarPage();

    expect(screen.getByDisplayValue("new event")).toBeInTheDocument();
    expect(screen.getByDisplayValue("new task")).toBeInTheDocument();
  });

  it("updates the default event name as the user types", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const input = screen.getByDisplayValue("new event");
    await user.clear(input);
    await user.type(input, "standup");

    expect(screen.getByDisplayValue("standup")).toBeInTheDocument();
  });

  it("updates the default task name as the user types", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const input = screen.getByDisplayValue("new task");
    await user.clear(input);
    await user.type(input, "todo");

    expect(screen.getByDisplayValue("todo")).toBeInTheDocument();
  });

  it("changes the default view via the select", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    await user.click(screen.getByRole("combobox", { name: "Default view" }));
    const options = await screen.findAllByText("Day");
    await user.click(options[options.length - 1]);

    expect(await screen.findByText("Day")).toBeInTheDocument();
  });

  it("saves and previews the notification sound when it changes", async () => {
    const user = userEvent.setup();
    const players = stubAudio();
    await renderLoadedCalendarPage();

    await user.click(
      screen.getByRole("combobox", { name: "Notification sound" }),
    );
    await user.click(await screen.findByRole("option", { name: "Sound 3" }));

    expect(readSettings().notificationSound).toBe(3);
    await waitFor(() => expect(players).toHaveLength(1));
    expect(players).toEqual([
      expect.objectContaining({ src: `${import.meta.env.BASE_URL}sounds/notification_3.mp3`, volume: 0.8 }),
    ]);
  });

  it("saves and previews the notification volume when the slider is released", async () => {
    const user = userEvent.setup();
    const players = stubAudio();
    await renderLoadedCalendarPage();

    screen.getByRole("slider", { name: "Notification volume" }).focus();
    await user.keyboard("[ArrowLeft]");

    expect(readSettings().notificationVolume).toBe(79);
    await waitFor(() => expect(players).toHaveLength(1));
    expect(players).toEqual([
      expect.objectContaining({ src: `${import.meta.env.BASE_URL}sounds/notification_1.mp3`, volume: 0.79 }),
    ]);
  });

  describe("custom notification sound", () => {
    const chooseCustom = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(
        screen.getByRole("combobox", { name: "Notification sound" }),
      );
      await user.click(await screen.findByRole("option", { name: "Custom" }));
    };

    it("opens the file picker instead of changing the setting", async () => {
      const user = userEvent.setup();
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      await renderLoadedCalendarPage();

      await chooseCustom(user);

      expect(click).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("combobox", { name: "Notification sound" }),
      ).toHaveTextContent("Sound 1");
    });

    it("keeps an uploaded file as the sound and previews it", async () => {
      const user = userEvent.setup();
      const players = stubAudio();
      const put = stubCache();
      await renderLoadedCalendarPage();
      const file = new File(["x"], "ding.mp3", { type: "audio/mpeg" });

      await user.upload(screen.getByTestId("custom-sound-input"), file);

      await waitFor(() => expect(players).toHaveLength(1));
      expect(put).toHaveBeenCalledWith("/custom", expect.any(Response));
      expect(readSettings().notificationSound).toBe(0);
      expect(players[0].src).toBe("blob:custom");
      expect(
        screen.getByRole("button", { name: "Choose another file" }),
      ).toBeInTheDocument();
    });

    it.each([
      ["a file that is not audio", new File(["x"], "a.txt", { type: "text/plain" })],
      [
        "an audio file over 1 MB",
        new File([new Uint8Array((1 << 20) + 1)], "big.mp3", {
          type: "audio/mpeg",
        }),
      ],
    ])("rejects %s", async (_, file) => {
      const user = userEvent.setup({ applyAccept: false });
      const put = stubCache();
      await renderLoadedCalendarPage();

      await user.upload(screen.getByTestId("custom-sound-input"), file);

      expect(mocks.toastError).toHaveBeenCalledWith(
        "Choose an audio file smaller than 1 MB.",
      );
      expect(put).not.toHaveBeenCalledWith("/custom", expect.anything());
      expect(
        screen.getByRole("combobox", { name: "Notification sound" }),
      ).toHaveTextContent("Sound 1");
    });
  });

  it("saves default notifications for new events", async () => {
    const user = userEvent.setup();
    await renderLoadedCalendarPage();

    await user.click(screen.getByRole("button", { name: "Add notification" }));
    await user.click(screen.getByRole("combobox", { name: "How to notify" }));
    await user.click(
      await screen.findByRole("option", {
        name: "Send a push notification to this device",
      }),
    );

    expect(readSettings().defaultEventNotifications).toEqual([
      { when: "start", amount: 10, method: "device" },
    ]);

    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(readSettings().defaultEventNotifications).toEqual([]);
  });

  it("changes what a click and a double click do", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const click = screen.getByRole("combobox", {
      name: "When an event is clicked",
    });
    const doubleClick = screen.getByRole("combobox", {
      name: "When an event is double-clicked",
    });
    expect(click).toHaveTextContent("View event details");
    expect(doubleClick).toHaveTextContent("Edit event");

    await user.click(click);
    await user.click(await screen.findByRole("option", { name: "Do nothing" }));
    await user.click(doubleClick);
    await user.click(
      await screen.findByRole("option", { name: "View event details" }),
    );

    expect(click).toHaveTextContent("Do nothing");
    expect(doubleClick).toHaveTextContent("View event details");
  });

  it("shows the default event and task names in the chosen language until customized", async () => {
    const user = userEvent.setup();
    render(
      <SettingsStoreProvider>
        <LanguageSync />
        <CalendarProvider>
          <RegionPage sectionRefs={{ current: new Map() }} />
          <Harness />
        </CalendarProvider>
      </SettingsStoreProvider>,
    );

    const [languageTrigger] = screen.getAllByRole("combobox");
    await user.click(languageTrigger);
    await user.click(await screen.findByRole("option", { name: "Español" }));

    expect(await screen.findByDisplayValue("nuevo evento")).toBeInTheDocument();
    expect(screen.getByDisplayValue("nueva tarea")).toBeInTheDocument();

    const input = screen.getByDisplayValue("nuevo evento");
    await user.clear(input);
    await user.type(input, "standup");
    await user.tab();

    expect(readSettings().defaultEventName).toBe("standup");
    expect(screen.getByDisplayValue("standup")).toBeInTheDocument();
  });


  it("increases the snap minutes slider with the keyboard", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const sliders = screen.getAllByRole("slider");
    sliders[0].focus();
    await user.keyboard("[ArrowRight]");

    expect(screen.getByText("6 min")).toBeInTheDocument();
  });

  it("increases the default event duration slider with the keyboard", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    screen.getByRole("slider", { name: "Event duration" }).focus();
    await user.keyboard("[ArrowRight]");

    expect(screen.getByText("61 min")).toBeInTheDocument();
  });

  it("renders the agenda enabled switch on by default and the default range", async () => {
    await renderLoadedCalendarPage();

    const switches = screen.getAllByRole("switch");
    expect(switches[switches.length - 2]).toBeChecked();
    expect(screen.getAllByText("3 days")).toHaveLength(2);
  });

  it("shows the overdue slider only while show overdue tasks is on", async () => {
    const user = userEvent.setup();
    await renderLoadedCalendarPage();

    const switches = screen.getAllByRole("switch");
    const overdueSwitch = switches[switches.length - 1];
    expect(overdueSwitch).toBeChecked();
    const sliderCount = screen.getAllByRole("slider").length;

    await user.click(overdueSwitch);

    expect(screen.getAllByRole("slider")).toHaveLength(sliderCount - 1);
    expect(readSettings().showOverdueTasks).toBe(false);
  });

  it("clamps the overdue days slider between 1 and 28 days", async () => {
    const user = userEvent.setup();
    await renderLoadedCalendarPage();

    const sliders = screen.getAllByRole("slider");
    sliders[sliders.length - 1].focus();
    for (let i = 0; i < 30; i++) {
      await user.keyboard("[ArrowRight]");
    }

    expect(screen.getByText("28 days")).toBeInTheDocument();
    expect(readSettings().overdueDays).toBe(28);
  });

  it("toggles the agenda enabled switch off", async () => {
    const user = userEvent.setup();
    await renderLoadedCalendarPage();

    const switches = screen.getAllByRole("switch");
    const agendaSwitch = switches[switches.length - 2];
    await user.click(agendaSwitch);

    expect(agendaSwitch).not.toBeChecked();

    const stored = readSettings();
    expect(stored.agendaEnabled).toBe(false);
  });

  it("increases the agenda range slider with the keyboard", async () => {
    const user = userEvent.setup();
    await renderLoadedCalendarPage();

    const sliders = screen.getAllByRole("slider");
    sliders[sliders.length - 2].focus();
    await user.keyboard("[ArrowRight]");

    expect(screen.getByText("4 days")).toBeInTheDocument();

    const stored = readSettings();
    expect(stored.agendaRangeDays).toBe(4);
  });

  it("clamps the agenda range slider between 1 and 14 days", async () => {
    const user = userEvent.setup();
    await renderLoadedCalendarPage();

    const sliders = screen.getAllByRole("slider");
    const rangeSlider = sliders[sliders.length - 2];
    rangeSlider.focus();

    for (let i = 0; i < 20; i++) {
      await user.keyboard("[ArrowRight]");
    }

    expect(screen.getByText("14 days")).toBeInTheDocument();
  });

  it("persists changes made through the page to localStorage", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const input = screen.getByDisplayValue("new event");
    await user.clear(input);
    await user.type(input, "focus block");

    // auto-save is debounced, so wait for the commit
    await waitFor(() => {
      const stored = readSettings();
      expect(stored.defaultEventName).toBe("focus block");
    });
  });

  it("persists a default event name edit immediately on blur, without waiting for the debounce", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const input = screen.getByDisplayValue("new event");
    await user.clear(input);
    await user.type(input, "focus block");
    await user.tab();

    const stored = readSettings();
    expect(stored.defaultEventName).toBe("focus block");
  });

  describe("color presets keyboard support", () => {
    const swatches = () =>
      screen
        .getAllByRole("button", { name: /^Remove / })
        .map((b) => b.getAttribute("aria-label")!);

    it("reorders a color with shift + arrow keys and keeps focus on it", async () => {
      const user = userEvent.setup();
      await renderLoadedCalendarPage();
      const [first, second] = swatches();
      const swatch = screen.getByRole("button", { name: first });

      swatch.focus();
      await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

      expect(swatches().slice(0, 2)).toEqual([second, first]);
      expect(swatch).toHaveFocus();
      const stored = readSettings().eventColorPresets as string[];
      expect(stored[1]).toBe(first.replace("Remove ", ""));
    });

    it("removes a color with Delete", async () => {
      const user = userEvent.setup();
      await renderLoadedCalendarPage();
      const before = swatches();

      screen.getByRole("button", { name: before[0] }).focus();
      await user.keyboard("{Delete}");

      expect(swatches()).toEqual(before.slice(1));
    });
  });

  describe("mini calendar section", () => {
    // "Enabled" also labels the agenda switch, so look the switches up by setting key
    const miniSwitch = (key: string) =>
      document.querySelector<HTMLElement>(
        `[role="switch"][aria-labelledby="setting-label-${key}"]`,
      )!;

    const dependents = [
      "miniCalendarEventBars",
      "miniCalendarWeekNumbers",
      "miniCalendarBoldDayNumbers",
      "miniCalendarDropdowns",
    ];

    it("starts enabled with everything else off", async () => {
      await renderLoadedCalendarPage();

      expect(miniSwitch("miniCalendarEnabled")).toBeChecked();
      dependents.forEach((key) => expect(miniSwitch(key)).not.toBeChecked());
    });

    it.each(dependents)("toggles %s and stores it", async (key) => {
      const user = userEvent.setup();
      await renderLoadedCalendarPage();

      await user.click(miniSwitch(key));

      expect(miniSwitch(key)).toBeChecked();
      expect(readSettings()[key as keyof ReturnType<typeof readSettings>]).toBe(
        true,
      );
    });

    it("disables the other switches while the mini calendar is off", async () => {
      const user = userEvent.setup();
      await renderLoadedCalendarPage();
      dependents.forEach((key) => expect(miniSwitch(key)).toBeEnabled());

      await user.click(miniSwitch("miniCalendarEnabled"));

      expect(readSettings().miniCalendarEnabled).toBe(false);
      dependents.forEach((key) => expect(miniSwitch(key)).toBeDisabled());
    });
  });
});
