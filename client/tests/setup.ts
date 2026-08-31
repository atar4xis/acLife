import "@testing-library/jest-dom/vitest";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    promise: vi.fn(),
  },
}));

// mock API
vi.mock("../src/context/ApiContext.tsx", () => {
  const original = vi.importActual("../src/context/ApiContext.tsx");
  return {
    ...original,
    useApi: () => ({
      url: "http://mock-api",
      setUrl: () => {},
      get: () => ({}),
      getRaw: () => ({}),
      post: () => ({}),
      put: () => ({}),
      delete: () => ({}),
    }),
  };
});

beforeEach(() => {
  // mock localStorage
  const store: Record<string, string> = {};

  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const key in store) delete store[key];
    }),
  });

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  vi.stubGlobal("matchMedia", () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});
