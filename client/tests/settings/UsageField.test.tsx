import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => api,
}));

import UsageField from "../../src/components/settings/pages/UsageField.tsx";
import { expectNoViolations } from "../a11y/axe.ts";

const MB = 1024 ** 2;

const renderSection = () =>
  render(<UsageField />);

const bar = () => screen.findByRole("progressbar", { name: "Usage" });

beforeEach(() => {
  api.get.mockReset();
  vi.mocked(toast.error).mockClear();
});

describe("UsageField", () => {
  it("asks the server for the quota and shows what is used", async () => {
    api.get.mockResolvedValue({
      success: true,
      data: { used: 10 * MB, limit: 500 * MB },
    });
    renderSection();

    expect(await screen.findByText("10 MB of 500 MB used")).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("user/quota");
    const progress = await bar();
    expect(progress.getAttribute("aria-valuenow")).toBe("2");
    expect(progress.getAttribute("aria-valuetext")).toBe("10 MB of 500 MB used");
    expect(progress.firstElementChild).toHaveStyle({ width: "2%" });
    expect(progress.firstElementChild?.className).toContain("bg-primary");
  });

  it("warns when the quota is nearly used up", async () => {
    api.get.mockResolvedValue({
      success: true,
      data: { used: 450 * MB, limit: 500 * MB },
    });
    renderSection();

    const progress = await bar();
    expect(progress.firstElementChild?.className).toContain("bg-destructive");
    expect(progress.firstElementChild).toHaveStyle({ width: "90%" });
  });

  it("never draws the bar past full", async () => {
    api.get.mockResolvedValue({
      success: true,
      data: { used: 700 * MB, limit: 500 * MB },
    });
    renderSection();

    const progress = await bar();
    expect(progress.getAttribute("aria-valuenow")).toBe("100");
    expect(progress.firstElementChild).toHaveStyle({ width: "100%" });
    expect(screen.getByText("700 MB of 500 MB used")).toBeTruthy();
  });

  it("copes with a limit of zero", async () => {
    api.get.mockResolvedValue({ success: true, data: { used: 0, limit: 0 } });
    renderSection();

    const progress = await bar();
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText("0 byte of 0 byte used")).toBeTruthy();
  });

  it("treats any usage as full when the limit is zero", async () => {
    api.get.mockResolvedValue({ success: true, data: { used: 5 * MB, limit: 0 } });
    renderSection();

    const progress = await bar();
    expect(progress.getAttribute("aria-valuenow")).toBe("100");
    expect(progress.firstElementChild?.className).toContain("bg-destructive");
  });

  it("shows a skeleton while loading", () => {
    api.get.mockReturnValue(new Promise(() => {}));
    renderSection();

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("reports a failed load with the server's message", async () => {
    api.get.mockResolvedValue({ success: false, message: "Nope." });
    renderSection();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope."));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("falls back to its own message when the server gives none", async () => {
    api.get.mockResolvedValue({ success: false });
    renderSection();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to load usage."),
    );
  });

  it("has no accessibility violations", async () => {
    api.get.mockResolvedValue({
      success: true,
      data: { used: 10 * MB, limit: 500 * MB },
    });
    const { container } = renderSection();
    await bar();

    await expectNoViolations(container);
  });
});
