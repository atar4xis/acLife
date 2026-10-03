import { afterEach, describe, expect, it } from "vitest";
import { act, screen } from "@testing-library/react";
import { applyLanguage } from "../../src/i18n";
import { buildPlainEvent, renderCalendar } from "./helpers.tsx";

describe("Calendar language change", () => {
  afterEach(() => applyLanguage("en"));

  it("retranslates day headers right away without a reload", () => {
    renderCalendar({ events: [buildPlainEvent()], mode: "week" });
    expect(
      screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/).length,
    ).toBeGreaterThan(0);

    act(() => applyLanguage("es"));

    expect(screen.queryAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)).toEqual(
      [],
    );
    expect(
      screen.getAllByText(/^(lun|mar|mié|jue|vie|sáb|dom)\b/i).length,
    ).toBeGreaterThan(0);
  });
});
