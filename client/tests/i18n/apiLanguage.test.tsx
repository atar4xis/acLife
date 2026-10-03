import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { applyLanguage } from "../../src/i18n";

const { ApiProvider, useApi } = await vi.importActual<
  typeof import("../../src/context/ApiContext.tsx")
>("../../src/context/ApiContext.tsx");

const wrapper = ({ children }: { children: ReactNode }) => (
  <ApiProvider initialUrl="http://api.test">{children}</ApiProvider>
);

const headerOf = (call: unknown[]) =>
  (call[1] as RequestInit).headers as Record<string, string>;

afterEach(() => applyLanguage("en"));

describe("API requests", () => {
  it.each([
    ["en", "get"],
    ["es", "get"],
    ["es", "post"],
    ["es", "del"],
  ] as const)("send the app language (%s) on %s", async (language, method) => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    applyLanguage(language);

    const { result } = renderHook(() => useApi(), { wrapper });
    const call = fetchMock.mock.calls.length;
    if (method === "post") await result.current.post("x", {});
    else await result.current[method]("x");

    const request = fetchMock.mock.calls.slice(call).pop()!;
    expect(headerOf(request)["Accept-Language"]).toBe(language);
  });
});
