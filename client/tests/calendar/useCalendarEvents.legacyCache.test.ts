import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { User } from "../../src/types/User.ts";

const storage = vi.hoisted(() => ({
  ready: true,
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({ post: vi.fn() }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storage,
}));

const { useCalendarEvents } = await import(
  "../../src/hooks/calendar/useCalendarEvents.ts"
);

const render = () =>
  renderHook(() =>
    useCalendarEvents({ type: "online" } as User, null, null),
  );

describe("useCalendarEvents legacy cache", () => {
  it("frees the old single-blob cache", () => {
    storage.get.mockReturnValue(new ArrayBuffer(8));
    storage.set.mockClear();

    render();

    expect(storage.set).toHaveBeenCalledWith("cachedEvents", null);
  });

  it("leaves storage alone when there is none", () => {
    storage.get.mockReturnValue(null);
    storage.set.mockClear();

    render();

    expect(storage.set).not.toHaveBeenCalled();
  });
});
