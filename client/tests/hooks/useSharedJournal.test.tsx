import { act, cleanup, render } from "@testing-library/react";
import { toast } from "sonner";
import { type Dispatch, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncRequests, withParts } from "../syncParts.ts";

const apiPost = withParts((endpoint: string, body: never) =>
  session.post(endpoint, body),
);

const session = vi.hoisted(() => ({
  decompressDelay: 0,
  realTimeout: setTimeout,
  masterKey: null as CryptoKey | null,
  stored: {} as Record<string, unknown>,
  cache: {} as Record<string, unknown>,
  user: undefined as unknown,
  post: undefined as unknown as (endpoint: string, body: never) => unknown,
  shares: {
    joined: [] as unknown[],
    owned: [] as unknown[],
    deleteSpace: undefined as unknown as (id: string) => Promise<boolean>,
  },
}));

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => {
    if (session.decompressDelay)
      await new Promise((resolve) =>
        session.realTimeout(resolve, session.decompressDelay),
      );
    return input;
  },
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ masterKey: session.masterKey, user: session.user }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => {
  const storage = {
    ready: true,
    get: (key: string) =>
      key === "journalLastSynced"
        ? session.stored
        : key === "sharedJournals"
          ? session.cache
          : null,
    set: (key: string, value: Record<string, unknown>) => {
      if (key === "journalLastSynced") session.stored = value;
      if (key === "sharedJournals") session.cache = value;
    },
  };
  return { useStorage: () => storage };
});

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    post: apiPost,
    serverMeta: undefined,
  }),
}));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => session.shares,
}));

import JournalSharing from "../../src/components/journal/JournalSharing.tsx";
import { computeBucketHash } from "../../src/lib/bucketHash.ts";
import { encryptJson } from "../../src/lib/crypt.ts";
import { decryptItem, encryptItem } from "../../src/lib/journal/crypt.ts";
import {
  deriveSpaceKeys,
  generateSpaceKey,
} from "../../src/lib/shareCrypto.ts";
import { emitStream } from "../../src/lib/stream.ts";
import {
  createJournalState,
  journalReducer,
} from "../../src/reducers/journalReducer.ts";
import type {
  JournalAction,
  JournalItem,
  JournalState,
} from "../../src/types/Journal.ts";
import type { JoinedSpace, OwnedSpace } from "../../src/types/Share.ts";
import type { EncryptedRecord } from "../../src/types/Sync.ts";

const realTimeout = setTimeout;
const BUCKETS = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

type Change =
  | { type: "added" | "updated"; record: EncryptedRecord }
  | { type: "deleted"; id: string };

const note = (bucket: string, n: number, extra: Partial<JournalItem> = {}) =>
  ({
    id: `${bucket}${n.toString(16).padStart(6, "0")}-0000-4000-8000-000000000000`,
    parentId: null,
    type: "note",
    name: `note ${bucket}${n}`,
    content: "",
    createdAt: 1,
    updatedAt: 1000,
    ...extra,
  }) as JournalItem;

const bucketOf = (id: string) => id.slice(0, 2);

class FakeSpaceServer {
  rows = new Map<string, EncryptedRecord>();
  requests: { endpoint: string; body: unknown }[] = [];

  constructor(private keys: Awaited<ReturnType<typeof deriveSpaceKeys>>) {}

  saves = () =>
    this.requests.filter((r) => r.endpoint.startsWith("shares/save"));

  async seed(...items: JournalItem[]) {
    for (const item of items)
      this.rows.set(item.id, await encryptItem(item, this.keys.key));
  }

  items = async () =>
    (
      await Promise.all(
        Array.from(this.rows.values(), (row) =>
          decryptItem(row, this.keys.key),
        ),
      )
    ).filter((item): item is JournalItem => item !== null);

  post = async (endpoint: string, body: unknown) => {
    this.requests.push({ endpoint, body });
    if (endpoint.startsWith("shares/save")) {
      for (const change of body as Change[]) {
        if (change.type === "deleted") this.rows.delete(change.id);
        else if (
          (this.rows.get(change.record.id)?.updatedAt ?? -1) <=
          change.record.updatedAt
        )
          this.rows.set(change.record.id, change.record);
      }
      return { success: true };
    }

    const req = body as {
      hash?: string;
      buckets?: string[];
      records?: { id: string; ts: number }[];
    };
    const lines = Array.from(this.rows.values(), (r) => ({
      id: r.id,
      ts: r.updatedAt,
    }));
    if (req.hash !== undefined) {
      if ((await computeBucketHash(lines)) === req.hash)
        return { success: true, data: { match: true } };
      const slices = await Promise.all(
        BUCKETS.map(async (b) =>
          (
            await computeBucketHash(lines.filter((l) => bucketOf(l.id) === b))
          ).slice(0, 11),
        ),
      );
      return { success: true, data: { match: false, table: slices.join("") } };
    }

    const buckets = req.buckets!;
    const client = new Map(req.records!.map((e) => [e.id, e.ts]));
    const send = Array.from(this.rows.values())
      .filter((r) => buckets.includes(bucketOf(r.id)))
      .filter((r) => r.updatedAt > (client.get(r.id) ?? -1));
    return {
      success: true,
      data: {
        added: send.filter((r) => !client.has(r.id)),
        updated: send.filter((r) => client.has(r.id)),
        deleted: req
          .records!.filter(
            (e) => buckets.includes(bucketOf(e.id)) && !this.rows.has(e.id),
          )
          .map((e) => e.id),
        remaining: [],
      },
    };
  };
}

let current: { state: JournalState; dispatch: Dispatch<JournalAction> };

function Harness({ initial }: { initial: JournalItem[] }) {
  const [state, dispatch] = useReducer(journalReducer, undefined, () => ({
    ...createJournalState(),
    items: initial,
  }));
  current = { state, dispatch };
  return (
    <JournalSharing
      items={state.items}
      removed={state.removed}
      loaded
      dispatch={dispatch}
    />
  );
}

const idle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++)
      await new Promise((resolve) => realTimeout(resolve, 5));
  });

const debounce = () =>
  act(async () => {
    vi.advanceTimersByTime(1000);
  });

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++)
    await act(async () => {
      await new Promise((resolve) => realTimeout(resolve, 5));
    });
  expect(cond()).toBe(true);
};

let keys: Awaited<ReturnType<typeof deriveSpaceKeys>>;
let server: FakeSpaceServer;

const joinedSpace = (
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
  keys,
});

const ownedSpace = (
  target: string | null,
  scope: "item" | "collection" = "collection",
): OwnedSpace => ({
  id: "space-1",
  kind: "journal",
  scope,
  target,
  members: [],
  raw: new Uint8Array(32),
  keys,
});

beforeEach(async () => {
  vi.mocked(toast.error).mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  keys = await deriveSpaceKeys(generateSpaceKey());
  session.masterKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  session.stored = {};
  session.cache = {};
  session.decompressDelay = 0;
  server = new FakeSpaceServer(keys);
  session.user = { type: "online", subscription_status: "active" };
  session.post = server.post;
  session.shares = {
    joined: [],
    owned: [],
    deleteSpace: vi.fn(async () => true),
  };
});

afterEach(async () => {
  vi.mocked(toast.error).mockClear();
  cleanup();
  await new Promise((resolve) => realTimeout(resolve, 30));
  vi.useRealTimers();
});

describe("a journal shared with me", () => {
  it("restores the shared notes after a reload and only checks the hash", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("read")];

    const first = render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);
    await debounce();
    await until(() => Object.keys(session.cache).length === 1);
    first.unmount();

    server.requests.length = 0;
    render(<Harness initial={[]} />);
    await until(() => server.requests.length > 0);
    await idle();

    expect(current.state.items[0]).toMatchObject({
      id: shared.id,
      content: "hello",
      _shared: { space: "space-1" },
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body).toHaveProperty("hash");
  });

  it("drops cached notes the owner deleted in the meantime", async () => {
    const kept = note("0a", 1);
    const gone = note("0b", 1);
    await server.seed(kept, gone);
    session.shares.joined = [joinedSpace("read")];

    const first = render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 2);
    await debounce();
    await until(() => Object.keys(session.cache).length === 1);
    first.unmount();

    server.rows.delete(gone.id);
    render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    expect(current.state.items[0].id).toBe(kept.id);
  });

  it("shows the shared notes marked with their space and permission", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("write")];

    render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    expect(current.state.items[0]).toMatchObject({
      id: shared.id,
      content: "hello",
      _shared: {
        space: "space-1",
        owner: "owner-1",
        scope: "collection",
        permission: "write",
      },
    });
  });

  it("saves edits to the space, encrypted with the space key and without runtime fields", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("write")];

    render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    await act(() =>
      current.dispatch({
        type: "setContent",
        id: shared.id,
        content: "edited",
        now: 5000,
      }),
    );
    await debounce();
    await until(() => server.saves().length === 1);

    expect(server.saves()[0].endpoint).toMatch(
      /^shares\/save\?space=space-1&c=/,
    );
    const [stored] = await server.items();
    expect(stored.content).toBe("edited");
    expect(stored).not.toHaveProperty("_shared");
  });

  it("tells a member when the owner's shared storage is full", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("write")];
    render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("shares/save")
        ? { success: false, code: "storage_limit_reached" }
        : server.post(endpoint, body);
    await act(() =>
      current.dispatch({
        type: "setContent",
        id: shared.id,
        content: "edited",
        now: 5000,
      }),
    );
    await debounce();
    await until(() => vi.mocked(toast.error).mock.calls.length > 0);

    expect(toast.error).toHaveBeenCalledWith(
      "The owner's storage is full. Your changes were not saved.",
      { id: "journal-storage-full-space-1" },
    );
  });

  it("tells the owner when their shared storage is full", async () => {
    session.shares.owned = [ownedSpace(null)];
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("shares/save")
        ? { success: false, code: "storage_limit_reached" }
        : server.post(endpoint, body);
    const inside = note("0b", 1, { content: "mine" });

    render(<Harness initial={[inside]} />);
    await until(() => vi.mocked(toast.error).mock.calls.length > 0);

    expect(toast.error).toHaveBeenCalledWith(
      "Your shared storage is full. Changes were not shared.",
      { id: "journal-storage-full-space-1" },
    );
  });

  it("never lets a shared record replace one of my own items", async () => {
    const mine = note("0a", 1, { content: "mine" });
    await server.seed({ ...mine, content: "forged", updatedAt: 5000 });
    session.shares.joined = [joinedSpace("read")];

    render(<Harness initial={[mine]} />);
    await until(() => server.requests.length >= 2);
    await idle();

    expect(current.state.items).toEqual([mine]);
  });

  it("never saves for a read-only space and ignores edits", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("read")];

    render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    await act(() =>
      current.dispatch({
        type: "setContent",
        id: shared.id,
        content: "edited",
        now: 5000,
      }),
    );
    await act(() => current.dispatch({ type: "removeItem", id: shared.id }));
    await debounce();
    await idle();

    expect(current.state.items[0].content).toBe("hello");
    expect(server.saves()).toHaveLength(0);
  });

  it("stops sending what was edited when the permission drops to read", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("write")];

    const view = render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    await act(() =>
      current.dispatch({
        type: "setContent",
        id: shared.id,
        content: "edited",
        now: 5000,
      }),
    );
    session.shares.joined = [joinedSpace("read")];
    view.rerender(<Harness initial={[]} />);
    await debounce();
    await idle();

    expect(server.saves()).toHaveLength(0);
  });

  it("removes the items when the space goes away", async () => {
    await server.seed(note("0a", 1));
    session.shares.joined = [joinedSpace("write")];

    const view = render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    session.shares.joined = [];
    view.rerender(<Harness initial={[]} />);
    await until(() => current.state.items.length === 0);
  });

  it("applies a change another member streamed", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("write")];

    render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    const newer = { ...shared, content: "from someone", updatedAt: 9000 };
    const record = await encryptItem(newer, keys.key);
    await act(async () => {
      emitStream({
        type: "space-updated",
        space: "space-1",
        originClientId: "other1",
        changes: [{ type: "updated", ...record }],
      });
    });
    await until(() => current.state.items[0].content === "from someone");
    expect(current.state.items[0]._shared?.space).toBe("space-1");
  });

  it("ignores messages of other spaces", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("write")];

    render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    const record = await encryptItem(
      { ...shared, content: "x", updatedAt: 9000 },
      keys.key,
    );
    await act(async () => {
      emitStream({
        type: "space-updated",
        space: "space-2",
        originClientId: "other1",
        changes: [{ type: "updated", ...record }],
      });
    });
    await idle();
    expect(current.state.items[0].content).toBe("hello");
  });

  it("lets an item-space writer edit but not delete or create", async () => {
    const shared = note("0a", 1, { content: "hello" });
    await server.seed(shared);
    session.shares.joined = [joinedSpace("write", "item")];

    render(<Harness initial={[]} />);
    await until(() => current.state.items.length === 1);

    await act(() =>
      current.dispatch({
        type: "setContent",
        id: shared.id,
        content: "edited",
        now: 5000,
      }),
    );
    await act(() => current.dispatch({ type: "removeItem", id: shared.id }));
    await act(() =>
      current.dispatch({
        type: "addItem",
        id: "new-id",
        kind: "note",
        name: "n",
        parentId: shared.id,
        style: {},
        now: 6000,
      }),
    );

    const items = current.state.items;
    expect(items.map((i) => i.id)).toContain(shared.id);
    expect(items.find((i) => i.id === shared.id)?.content).toBe("edited");
    expect(items.find((i) => i.id === "new-id")?._shared).toBeUndefined();
  });
});

describe("journals shared both ways", () => {
  it("asks about every space in one request", async () => {
    session.shares.joined = [
      joinedSpace("write"),
      { ...joinedSpace("read"), id: "space-2" },
    ];
    syncRequests.length = 0;

    render(<Harness initial={[]} />);
    await until(() => syncRequests.length > 0);
    await idle();

    expect(syncRequests[0].spaces.toSorted()).toEqual(["space-1", "space-2"]);
    expect(syncRequests.filter((r) => r.spaces.length === 1)).toEqual([]);
  });

  it("sends one request when several syncs are asked for at once", async () => {
    session.shares.joined = [joinedSpace("write")];
    render(<Harness initial={[]} />);
    await until(() => syncRequests.length > 0);
    await idle();
    syncRequests.length = 0;

    await act(async () => {
      emitStream({ type: "sync", originClientId: "other1" });
      emitStream({ type: "sync", originClientId: "other1" });
      emitStream({ type: "sync", originClientId: "other1" });
    });
    await idle();

    expect(syncRequests).toHaveLength(1);
  });
});

describe("my own journal shared out", () => {
  const folder = note("0a", 1, { type: "folder", name: "Shared folder" });
  const inside = note("0b", 1, { parentId: folder.id, content: "inside" });
  const outside = note("0c", 1, { content: "private" });

  it("mirrors only the shared folder and what is inside it", async () => {
    session.shares.owned = [ownedSpace(folder.id)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 2);

    expect(Array.from(server.rows.keys()).toSorted()).toEqual(
      [folder.id, inside.id].toSorted(),
    );
    const [saved] = await server.items();
    expect(saved).not.toHaveProperty("_shared");
    expect(current.state.items).toHaveLength(3);
  });

  it("keeps my notes when the space starts out empty", async () => {
    session.shares.owned = [ownedSpace(null)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 3);
    await idle();

    expect(current.state.items.map((i) => i.id).toSorted()).toEqual(
      [folder.id, inside.id, outside.id].toSorted(),
    );
  });

  it("deletes my copy of what a member deleted while I was away, and only that", async () => {
    session.shares.owned = [ownedSpace(folder.id)];
    session.stored = {
      "space-1": await encryptJson(
        { [folder.id]: 1000, [inside.id]: 1000 },
        session.masterKey!,
      ),
    };
    await server.seed(folder);

    render(<Harness initial={[folder, inside, outside]} />);
    await until(
      () => !current.state.items.some((item) => item.id === inside.id),
    );

    expect(current.state.items.map((i) => i.id).toSorted()).toEqual(
      [folder.id, outside.id].toSorted(),
    );
    await debounce();
    await idle();
    expect(server.rows.has(inside.id)).toBe(false);
    expect(
      server
        .saves()
        .flatMap((r) => r.body as Change[])
        .filter((change) => change.type === "deleted"),
    ).toEqual([]);
  });

  it("waits for what it knew about the space before sending anything", async () => {
    session.shares.owned = [ownedSpace(folder.id)];
    session.decompressDelay = 60;
    session.stored = {
      "space-1": await encryptJson(
        { [folder.id]: 1000, [inside.id]: 1000 },
        session.masterKey!,
      ),
    };
    await server.seed(folder);

    render(<Harness initial={[folder, inside]} />);
    await act(async () => {
      await new Promise((resolve) => realTimeout(resolve, 20));
    });
    expect(server.requests).toHaveLength(0);

    await until(
      () => !current.state.items.some((item) => item.id === inside.id),
    );
    expect(server.rows.has(inside.id)).toBe(false);
  });

  it("stops sharing a note that another device deleted", async () => {
    session.shares.owned = [ownedSpace(folder.id)];
    render(<Harness initial={[folder, inside]} />);
    await idle();

    await act(() =>
      current.dispatch({
        type: "applyRemote",
        upserts: [],
        deletedIds: [folder.id],
      }),
    );

    expect(session.shares.deleteSpace).toHaveBeenCalledWith("space-1");
  });

  it("keeps sharing when the journal is replaced without the shared note", async () => {
    session.shares.owned = [ownedSpace(folder.id)];
    render(<Harness initial={[folder, inside]} />);
    await idle();

    await act(() =>
      current.dispatch({ type: "hydrate", state: { items: [] } }),
    );
    await idle();

    expect(session.shares.deleteSpace).not.toHaveBeenCalled();
  });

  it("keeps sharing a note this device has not received yet", async () => {
    session.shares.owned = [ownedSpace(folder.id)];
    render(<Harness initial={[]} />);
    await idle();

    expect(session.shares.deleteSpace).not.toHaveBeenCalled();
  });

  it("stops sharing a note that gets deleted", async () => {
    const other = note("0c", 1, { content: "other" });
    session.shares.owned = [ownedSpace(folder.id)];
    render(<Harness initial={[folder, inside, other]} />);
    await idle();

    await act(() => current.dispatch({ type: "removeItem", id: other.id }));
    expect(session.shares.deleteSpace).not.toHaveBeenCalled();

    await act(() => current.dispatch({ type: "removeItem", id: folder.id }));
    expect(session.shares.deleteSpace).toHaveBeenCalledTimes(1);
    expect(session.shares.deleteSpace).toHaveBeenCalledWith("space-1");
  });

  it("does not stop sharing when the journal reloads without the shared note", async () => {
    session.shares.owned = [ownedSpace(folder.id)];
    const dispatch = vi.fn();
    const view = render(
      <JournalSharing items={[folder, inside]} removed={[]} loaded dispatch={dispatch} />,
    );
    await idle();

    view.rerender(
      <JournalSharing items={[]} removed={[]} loaded={false} dispatch={dispatch} />,
    );
    view.rerender(<JournalSharing items={[]} removed={[]} loaded dispatch={dispatch} />);
    await idle();

    expect(session.shares.deleteSpace).not.toHaveBeenCalled();
  });

  it("does not bring back what a member deleted", async () => {
    session.shares.owned = [ownedSpace(folder.id)];
    session.stored = {
      "space-1": await encryptJson(
        { [folder.id]: 1000, [inside.id]: 1000 },
        session.masterKey!,
      ),
    };
    await server.seed(folder);

    render(<Harness initial={[folder, inside]} />);
    await until(
      () => !current.state.items.some((item) => item.id === inside.id),
    );
    await debounce();
    await idle();
    expect(server.rows.has(inside.id)).toBe(false);
  });

  it("mirrors the whole journal for a space without a target", async () => {
    session.shares.owned = [ownedSpace(null)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 3);
  });

  it("mirrors only the one note of an item space", async () => {
    session.shares.owned = [ownedSpace(outside.id, "item")];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 1);
    expect(Array.from(server.rows.keys())).toEqual([outside.id]);
  });

  it("takes member edits into my own items without sending them back", async () => {
    session.shares.owned = [ownedSpace(folder.id)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 2);
    const savesBefore = server.saves().length;

    const edited = { ...inside, content: "member wrote this", updatedAt: 9000 };
    const record = await encryptItem(edited, keys.key);
    server.rows.set(edited.id, record);
    await act(async () => {
      emitStream({
        type: "space-updated",
        space: "space-1",
        originClientId: "other1",
        changes: [{ type: "updated", ...record }],
      });
    });

    await until(
      () =>
        current.state.items.find((i) => i.id === inside.id)?.content ===
        "member wrote this",
    );
    const mine = current.state.items.find((i) => i.id === inside.id)!;
    expect(mine._shared).toBeUndefined();
    expect(mine.updatedAt).toBe(9000);

    await debounce();
    await idle();
    expect(server.saves()).toHaveLength(savesBefore);
  });

  it("still takes a newer member edit after a pending local edit is sent", async () => {
    session.shares.owned = [ownedSpace(folder.id)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 2);

    await act(() =>
      current.dispatch({
        type: "setContent",
        id: inside.id,
        content: "mine",
        now: 7000,
      }),
    );
    const edited = { ...inside, content: "member wrote this", updatedAt: 9000 };
    const record = await encryptItem(edited, keys.key);
    server.rows.set(edited.id, record);
    await act(async () => {
      emitStream({
        type: "space-updated",
        space: "space-1",
        originClientId: "other1",
        changes: [{ type: "updated", ...record }],
      });
    });
    await idle();
    await debounce();

    await until(
      () =>
        current.state.items.find((i) => i.id === inside.id)?.content ===
        "member wrote this",
    );
  });

  it("creates what a member added and deletes what a member deleted", async () => {
    session.shares.owned = [ownedSpace(folder.id)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 2);

    const created = note("0d", 1, {
      parentId: folder.id,
      content: "new from member",
      updatedAt: 8000,
    });
    const record = await encryptItem(created, keys.key);
    server.rows.set(created.id, record);
    server.rows.delete(inside.id);
    await act(async () => {
      emitStream({
        type: "space-updated",
        space: "space-1",
        originClientId: "other1",
        changes: [
          { type: "added", ...record },
          { type: "deleted", id: inside.id },
        ],
      });
    });

    await until(() => current.state.items.some((i) => i.id === created.id));
    expect(current.state.items.some((i) => i.id === inside.id)).toBe(false);
    expect(
      current.state.items.find((i) => i.id === created.id)?._shared,
    ).toBeUndefined();
  });

  it("ignores member notes that land outside the shared folder or replace my private ones", async () => {
    session.shares.owned = [ownedSpace(folder.id)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 2);

    const stray = note("0d", 1, { content: "at my root", updatedAt: 8000 });
    const overwrite = { ...outside, content: "replaced", updatedAt: 9000 };
    const kept = note("0e", 1, {
      parentId: folder.id,
      content: "fine",
      updatedAt: 8000,
    });
    const records = await Promise.all(
      [stray, overwrite, kept].map((n) => encryptItem(n, keys.key)),
    );
    await act(async () => {
      emitStream({
        type: "space-updated",
        space: "space-1",
        originClientId: "other1",
        changes: records.map((record) => ({ type: "added", ...record })),
      });
    });

    await until(() => current.state.items.some((i) => i.id === kept.id));
    expect(current.state.items.some((i) => i.id === stray.id)).toBe(false);
    expect(current.state.items.find((i) => i.id === outside.id)?.content).toBe(
      outside.content,
    );
  });

  it("leaves member notes I did not admit on the server", async () => {
    const stray = note("0d", 1, { content: "at my root", updatedAt: 8000 });
    await server.seed(stray);
    session.shares.owned = [ownedSpace(folder.id)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.has(inside.id));
    await idle();

    expect(server.rows.has(stray.id)).toBe(true);
    expect(current.state.items.some((i) => i.id === stray.id)).toBe(false);
  });

  it("sends my own edits of mirrored notes to the space", async () => {
    session.shares.owned = [ownedSpace(folder.id)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 2);

    await act(() =>
      current.dispatch({
        type: "setContent",
        id: inside.id,
        content: "I changed it",
        now: 7000,
      }),
    );
    await debounce();
    await until(() => server.saves().length >= 2);
    const stored = (await server.items()).find((i) => i.id === inside.id);
    expect(stored?.content).toBe("I changed it");
  });

  it("stops mirroring a note moved out of the folder", async () => {
    session.shares.owned = [ownedSpace(folder.id)];

    render(<Harness initial={[folder, inside, outside]} />);
    await until(() => server.rows.size === 2);

    await act(() =>
      current.dispatch({
        type: "moveItem",
        id: inside.id,
        parentId: null,
        now: 7000,
      }),
    );
    await debounce();
    await until(() => server.rows.size === 1);
    expect(server.rows.has(inside.id)).toBe(false);
  });
});
