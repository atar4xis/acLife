import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LanguageSync from "../../src/components/LanguageSync.tsx";
import { applyLanguage } from "../../src/i18n";

const mocks = vi.hoisted(() => ({ cachePut: vi.fn() }));

vi.mock("../../src/context/CalendarSettingsContext.tsx", () => ({
  useCalendarSettings: () => undefined,
}));

describe("LanguageSync locale cache", () => {
  beforeEach(() => {
    mocks.cachePut.mockReset();
    vi.stubGlobal("caches", {
      open: async () => ({ put: mocks.cachePut }),
    });
  });

  afterEach(async () => {
    await act(() => applyLanguage("en"));
    vi.unstubAllGlobals();
  });

  it("keeps the current language for the service worker in the cache", async () => {
    await act(async () => void render(<LanguageSync />));

    expect(mocks.cachePut).toHaveBeenCalledWith("/locale", expect.any(Response));
    expect(
      (await mocks.cachePut.mock.calls[0][1].json()).notify.eventStarting,
    ).toBe("Event starting");
  });

  it("rewrites the cached locale when the language changes", async () => {
    await act(async () => void render(<LanguageSync />));
    mocks.cachePut.mockClear();

    await act(() => applyLanguage("es"));

    expect(
      (await mocks.cachePut.mock.calls[0][1].json()).notify.eventStarting,
    ).toBe("El evento va a empezar");
  });
});
