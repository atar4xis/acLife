import "@testing-library/jest-dom/vitest";
import "@testing-library/jest-dom";
import "../src/i18n";
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

Element.prototype.scrollTo = function (this: Element, options) {
  if (typeof options === "object")
    this.scrollTop = options.top ?? this.scrollTop;
};

const nativeMatches = Element.prototype.matches;
Element.prototype.matches = function (this: Element, selector: string) {
  return selector === ":focus-visible"
    ? this === document.activeElement
    : nativeMatches.call(this, selector);
};

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
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});
