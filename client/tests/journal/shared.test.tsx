import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withParts } from "../syncParts.ts";

const world = vi.hoisted(() => ({
  shares: {
    enabled: true,
    joined: [] as unknown[],
    owned: [] as unknown[],
    openShare: undefined as unknown,
    nameOf: (_: string, email: string) => email,
  },
  post: undefined as unknown as (endpoint: string, body: unknown) => unknown,
}));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => world.shares,
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    post: withParts((endpoint: string, body: never) => world.post(endpoint, body)),
    serverMeta: undefined,
  }),
}));

import {
  journal,
  key,
  renderLoadedJournal,
  store,
  resetJournal,
  setSession,
  treeItem,
} from "./helpers.tsx";
import { decryptJson } from "../../src/lib/crypt.ts";
import JournalImportExport from "../../src/components/settings/pages/JournalImportExport.tsx";
import { useJournal, useJournalItems } from "../../src/context/JournalContext.tsx";
import { JournalProvider } from "../../src/context/JournalContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { computeBucketHash } from "../../src/lib/bucketHash.ts";
import { encryptItem } from "../../src/lib/journal/crypt.ts";
import { deriveSpaceKeys, generateSpaceKey } from "../../src/lib/shareCrypto.ts";
import type { JournalItem } from "../../src/types/Journal.ts";
import type { JoinedSpace } from "../../src/types/Share.ts";
import type { EncryptedRecord } from "../../src/types/Sync.ts";

const item = (id: string, extra: Partial<JournalItem>): JournalItem => ({
  id: `${id}0000-0000-4000-8000-000000000000`.slice(0, 36),
  parentId: null,
  type: "note",
  name: id,
  content: "",
  createdAt: 1,
  updatedAt: 1000,
  ...extra,
});

const folder = item("0a000001", { type: "folder", name: "Recipes" });
const note = item("0b000001", {
  name: "Pasta",
  content: "boil water",
  parentId: folder.id,
});

let seen: JournalItem[] = [];
let actions: ReturnType<typeof useJournal>;
function Probe() {
  seen = useJournalItems();
  actions = useJournal();
  return null;
}

let rows: Map<string, EncryptedRecord>;
let spaceKeys: Awaited<ReturnType<typeof deriveSpaceKeys>>;
const BUCKETS = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

const requests: { endpoint: string; body: unknown }[] = [];

const post = async (endpoint: string, body: unknown) => {
  requests.push({ endpoint, body });
  if (endpoint.startsWith("shares/save")) return { success: true };
  if (endpoint.startsWith("journal/")) return { success: true, data: { match: true } };
  const req = body as { hash?: string; buckets?: string[]; records?: { id: string }[] };
  const lines = Array.from(rows.values(), (r) => ({ id: r.id, ts: r.updatedAt }));
  if (req.hash !== undefined) {
    const slices = await Promise.all(
      BUCKETS.map(async (b) =>
        (
          await computeBucketHash(lines.filter((l) => l.id.startsWith(b)))
        ).slice(0, 11),
      ),
    );
    return { success: true, data: { match: false, table: slices.join("") } };
  }
  const known = new Set(req.records!.map((r) => r.id));
  const send = Array.from(rows.values()).filter((r) =>
    req.buckets!.includes(r.id.slice(0, 2)),
  );
  return {
    success: true,
    data: {
      added: send.filter((r) => !known.has(r.id)),
      updated: [],
      deleted: [],
      remaining: [],
    },
  };
};

const space = (
  permission: "read" | "write",
  scope: "item" | "collection" = "collection",
): JoinedSpace => ({
  id: "space-1",
  owner: "owner-1",
  ownerEmail: "owner@example.com",
  ownerPublicKey: "",
  kind: "journal",
  scope,
  permission,
  keys: spaceKeys,
});

const mountShared = async (
  permission: "read" | "write",
  scope: "item" | "collection" = "collection",
  owner = "owner@example.com",
) => {
  world.shares.joined = [space(permission, scope)];
  const view = await renderLoadedJournal();
  await waitFor(() =>
    expect(screen.getByRole("treeitem", { name: new RegExp(`Shared by ${owner}`) })).toBeTruthy(),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("treeitem", { name: /Shared by/ }));
  await user.click(treeItem("Recipes"));
  await user.click(treeItem("Pasta"));
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  return { view, user };
};

beforeEach(async () => {
  spaceKeys = await deriveSpaceKeys(generateSpaceKey());
  rows = new Map();
  for (const shared of [folder, note])
    rows.set(shared.id, await encryptItem(shared, spaceKeys.key));
  requests.length = 0;
  world.post = post;
  world.shares = {
    enabled: true,
    joined: [],
    owned: [],
    openShare: vi.fn(),
    nameOf: (_: string, email: string) => email,
  };
  setSession({ user: { type: "online" } });
});

afterEach(resetJournal);

const menuOf = async (user: ReturnType<typeof userEvent.setup>, name: string | RegExp) => {
  await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("treeitem", { name }) });
  return screen.findByRole("menu");
};

describe("a shared journal in the tree", () => {
  it("puts the shared folder under a folder named after its owner", async () => {
    await mountShared("read");

    const root = screen.getByRole("treeitem", { name: /Shared by owner@example.com/ });
    expect(root.getAttribute("aria-level")).toBe("1");
    expect(treeItem("Recipes").getAttribute("aria-level")).toBe("2");
    expect(treeItem("Pasta").getAttribute("aria-level")).toBe("3");
  });

  it("names that folder after the nickname of the owner", async () => {
    world.shares.nameOf = () => "Boss";

    await mountShared("read", "collection", "Boss");

    expect(screen.queryByText(/owner@example.com/)).toBeNull();
  });

  it("gives the folder of the owner no actions", async () => {
    const { user } = await mountShared("write");

    const menu = await menuOf(user, /Shared by/);
    expect(within(menu).queryByRole("menuitem")).toBeNull();
  });

  it("opens a note as read-only for a viewer", async () => {
    await mountShared("read");

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("readOnly", true);
    expect(document.querySelector(".cm-content")).toBeNull();
    expect(screen.getByText("boil water")).toBeTruthy();
  });

  it("offers a viewer no rename, customize, move or delete", async () => {
    const { user } = await mountShared("read");

    const menu = await menuOf(user, "Pasta");
    expect(within(menu).queryByRole("menuitem", { name: "Rename" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Customize" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(within(menu).queryByText("Move to")).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Share..." })).toBeNull();
  });

  it("ignores F2 and Delete on a viewer's note", async () => {
    const { user } = await mountShared("read");

    treeItem("Pasta").focus();
    await user.keyboard("{F2}");
    expect(screen.queryByLabelText("Rename")).toBeNull();
    await user.keyboard("{Delete}");
    expect(journal.items.some((i) => i.name === "Pasta")).toBe(true);
  });

  it("lets a writer edit the text and the title", async () => {
    await mountShared("write");

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("readOnly", false);
    expect(document.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");

    await act(async () => journal.setContent(note.id, "boil water and salt"));
    expect(journal.items.find((i) => i.name === "Pasta")).toBeTruthy();
  });

  it("keeps shared notes out of my own journal: not synced, not stored", async () => {
    const { user } = await mountShared("write");
    await user.click(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), " 2");
    await act(() => new Promise((resolve) => setTimeout(resolve, 1500)));

    expect(requests.some((r) => r.endpoint.startsWith("shares/save"))).toBe(true);
    const own = requests.filter((r) => r.endpoint === "journal/save" || r.endpoint.startsWith("journal/save?"));
    expect(JSON.stringify(own)).not.toContain(note.id);

    const stored = store.get("journal");
    expect(stored).toBeTruthy();
    const { items } = await decryptJson<{ items: JournalItem[] }>(stored as ArrayBuffer, key);
    expect(items.map((i) => i.id)).not.toContain(note.id);
    expect(items.map((i) => i.id)).not.toContain(folder.id);
  });

  it("does not delete a shared folder a viewer pressed Delete on", async () => {
    const { user } = await mountShared("read");

    treeItem("Recipes").focus();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("offers a writer of a collection rename and delete", async () => {
    const { user } = await mountShared("write");

    const menu = await menuOf(user, "Pasta");
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Share..." })).toBeNull();
  });

  it("offers a writer of a single note rename but not delete", async () => {
    const { user } = await mountShared("write", "item");

    const menu = await menuOf(user, "Pasta");
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("offers my own note no place inside the shared folders", async () => {
    world.shares.joined = [space("write")];
    const view = await renderLoadedJournal();
    await act(async () => {
      journal.addItem("note", null);
    });
    const own = journal.items.find((i) => !i._shared && i.type === "note")!;
    await waitFor(() => expect(screen.getByRole("treeitem", { name: /Shared by/ })).toBeTruthy());

    const user = userEvent.setup();
    const menu = await menuOf(user, own.name);
    expect(within(menu).queryByText("Move to")).toBeNull();
    view.unmount();
  });
});

describe("export", () => {
  it("never imports into a folder somebody shared with me", async () => {
    world.shares.joined = [space("write")];
    await act(async () => {
      render(
        <SettingsStoreProvider>
          <JournalProvider>
            <Probe />
            <JournalImportExport />
          </JournalProvider>
        </SettingsStoreProvider>,
      );
    });
    await waitFor(() => expect(seen.some((i) => i._shared)).toBe(true));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import" })).toBeEnabled(),
    );

    const file = new File(["# cake"], "Cake.md");
    Object.defineProperty(file, "text", { value: () => Promise.resolve("# cake") });
    Object.defineProperty(file, "webkitRelativePath", { value: "Recipes/Cake.md" });
    await userEvent
      .setup({ applyAccept: false })
      .upload(screen.getByTestId("import-folder"), [file]);

    await waitFor(() => expect(seen.some((i) => i.name === "Cake")).toBe(true));
    const cake = seen.find((i) => i.name === "Cake")!;
    const parent = seen.find((i) => i.id === cake.parentId)!;
    expect(parent._shared).toBeUndefined();
    expect(cake._shared).toBeUndefined();
    expect(seen.filter((i) => i.name === "Recipes")).toHaveLength(2);
  });

  it("offers only my own folders", async () => {
    world.shares.joined = [space("write")];
    await act(async () => {
      render(
        <SettingsStoreProvider>
          <JournalProvider>
            <Probe />
            <JournalImportExport />
          </JournalProvider>
        </SettingsStoreProvider>,
      );
    });
    await waitFor(() => expect(seen.some((i) => i._shared)).toBe(true));
    await act(async () => actions.addItem("folder", null));
    const mine = seen.find((i) => !i._shared && i.type === "folder")!;

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(mine.name)).toBeTruthy();
    expect(within(dialog).queryByText("Recipes")).toBeNull();
    expect(within(dialog).queryByText(/Shared by/)).toBeNull();
  });
});

describe("sharing my own notes", () => {
  const openShare = () => world.shares.openShare as ReturnType<typeof vi.fn>;

  it("offers to share a note or a folder of mine", async () => {
    await renderLoadedJournal();
    const user = userEvent.setup();
    await act(async () => {
      journal.addItem("note", null);
      journal.addItem("folder", null);
    });
    const mine = journal.items.filter((i) => !i._shared);
    const noteItem = mine.find((i) => i.type === "note")!;
    const folderItem = mine.find((i) => i.type === "folder")!;

    let menu = await menuOf(user, noteItem.name);
    await user.click(within(menu).getByRole("menuitem", { name: "Share..." }));
    expect(openShare()).toHaveBeenLastCalledWith({
      kind: "journal",
      scope: "item",
      target: noteItem.id,
      label: noteItem.name,
    });

    menu = await menuOf(user, folderItem.name);
    await user.click(within(menu).getByRole("menuitem", { name: "Share..." }));
    expect(openShare()).toHaveBeenLastCalledWith({
      kind: "journal",
      scope: "collection",
      target: folderItem.id,
      label: folderItem.name,
    });
  });

  it("offers nothing when sharing is not available", async () => {
    world.shares.enabled = false;
    await renderLoadedJournal();
    const user = userEvent.setup();
    await act(async () => journal.addItem("note", null));

    const menu = await menuOf(user, journal.items[0].name);
    expect(within(menu).queryByRole("menuitem", { name: "Share..." })).toBeNull();
  });
});

void key;
