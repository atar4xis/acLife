import { afterEach, describe, expect, it } from "vitest";
import { applyLanguage } from "../../src/i18n";
import { resolveDefaultName } from "../../src/lib/calendar/defaultNames.ts";
import { defaultCalendarSettings } from "../../src/lib/settingsDefaults.ts";

afterEach(() => applyLanguage("en"));

describe("resolveDefaultName", () => {
  it("translates the stored default into the current language", () => {
    const { defaultEventName, defaultTaskName } = defaultCalendarSettings;

    expect(resolveDefaultName("defaultEventName", defaultEventName)).toBe(
      "new event",
    );

    applyLanguage("es");

    expect(resolveDefaultName("defaultEventName", defaultEventName)).toBe(
      "nuevo evento",
    );
    expect(resolveDefaultName("defaultTaskName", defaultTaskName)).toBe(
      "nueva tarea",
    );
  });

  it("keeps a customized name in every language", () => {
    applyLanguage("es");

    expect(resolveDefaultName("defaultEventName", "standup")).toBe("standup");
    expect(resolveDefaultName("defaultTaskName", "")).toBe("");
  });
});
