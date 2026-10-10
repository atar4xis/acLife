import { EditorView } from "@codemirror/view";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

const session = vi.hoisted(() => ({
  masterKey: null as CryptoKey | null,
  user: undefined as { type: "online" | "offline" } | undefined,
  ready: true,
  store: new Map<string, unknown>(),
}));

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ masterKey: session.masterKey, user: session.user }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({
    ready: session.ready,
    get: (k: string) => session.store.get(k) ?? null,
    set: (k: string, v: unknown) => session.store.set(k, v),
  }),
}));

vi.mock("../../src/lib/nativeUpdater.ts", () => ({
  isTauri: false,
  openExternal: vi.fn(),
}));

import JournalSidebar from "../../src/components/journal/JournalSidebar.tsx";
import JournalView from "../../src/components/journal/JournalView.tsx";
import { Sidebar, SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import {
  JournalProvider,
  useJournal,
} from "../../src/context/JournalContext.tsx";

export const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"],
);
export const store = session.store;

Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: [][Symbol.iterator],
  }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

export const resetJournal = async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  vi.restoreAllMocks();
  vi.clearAllMocks();
  store.clear();
  session.masterKey = key;
  session.user = undefined;
  session.ready = true;
};

export const setSession = (changes: {
  masterKey?: CryptoKey | null;
  user?: { type: "online" | "offline" };
  ready?: boolean;
}) => Object.assign(session, changes);

session.masterKey = key;

export let journal: ReturnType<typeof useJournal>;

// eslint-disable-next-line
function Probe() {
  journal = useJournal();
  return null;
}

export const journalUi = () => (
  <JournalProvider>
    <Probe />
    <SidebarProvider>
      <Sidebar>
        <JournalSidebar />
      </Sidebar>
      <JournalView />
    </SidebarProvider>
  </JournalProvider>
);

export const renderJournal = () => render(journalUi());

export const renderLoadedJournal = async () => {
  const view = renderJournal();
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  return view;
};

export type User = ReturnType<typeof userEvent.setup>;

export const createNote = async (user: User, name: string) => {
  await user.click(screen.getByRole("button", { name: "New note" }));
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, name);
};

export const treeItem = (name: string) =>
  within(screen.getByRole("navigation", { name: "Notes" })).getByRole(
    "treeitem",
    { name },
  );

export const tabList = () =>
  screen.getByRole("tablist", { name: "Open notes" });

export const plusButton = () =>
  screen
    .getAllByRole("button", { name: "New tab" })
    .find((button) => !tabList().contains(button))!;

export const editorView = () =>
  EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;

export const editorViews = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".cm-editor")).map((el) =>
    EditorView.findFromDOM(el)!,
  );

export const dataTransfer = () => ({
  setData: vi.fn(),
  effectAllowed: "",
  dropEffect: "",
});

export const dragAt = (
  type: "dragOver" | "drop",
  element: Element,
  clientX = 0,
  clientY = 0,
) => {
  const event = createEvent[type](element, { dataTransfer: dataTransfer() });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return fireEvent(element, event);
};

export const dragStart = async (element: Element) => {
  fireEvent.dragStart(element, { dataTransfer: dataTransfer() });
  await act(() => new Promise((resolve) => setTimeout(resolve)));
};
