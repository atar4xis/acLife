import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { User } from "../../src/types/User.ts";

const storageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => apiMock,
}));

// the real provider hands out a new storage object after every write
vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ ready: true, ...storageMock }),
}));

const { useCalendarEvents } = await import(
  "../../src/hooks/calendar/useCalendarEvents.ts"
);

describe("useCalendarEvents", () => {
  it("keeps its callbacks when the storage object changes", () => {
    const user = { type: "online" } as User;
    const { result, rerender } = renderHook(() =>
      useCalendarEvents(user, null, null),
    );
    const before = { ...result.current };

    rerender();

    expect(result.current.loadEvents).toBe(before.loadEvents);
    expect(result.current.syncEvents).toBe(before.syncEvents);
    expect(result.current.syncBuckets).toBe(before.syncBuckets);
    expect(result.current.saveEvents).toBe(before.saveEvents);
  });
});
