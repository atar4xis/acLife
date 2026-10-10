import { act, cleanup, render } from "@testing-library/react";
import { type Dispatch, useReducer } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  masterKey: null as CryptoKey | null,
  user: undefined as unknown,
  serverMeta: undefined as unknown,
  post: undefined as unknown as (endpoint: string, body: never) => unknown,
  decryptGate: Promise.resolve() as Promise<void>,
}));

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

vi.mock("../../src/lib/journal/crypt.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/journal/crypt.ts")>();
  return {
    ...original,
    decryptItem: async (...args: Parameters<typeof original.decryptItem>) => {
      await session.decryptGate;
      return original.decryptItem(...args);
    },
  };
});

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ masterKey: session.masterKey, user: session.user }),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    post: (endpoint: string, body: unknown) => session.post(endpoint, body as never),
    serverMeta: session.serverMeta,
  }),
}));

import { useJournalSync } from "../../src/hooks/journal/useJournalSync.ts";
import { computeBucketHash } from "../../src/lib/bucketHash.ts";
import { CLIENT_ID } from "../../src/lib/clientId.ts";
import {
  MAX_ENCRYPTED_JOURNAL_BYTES,
  decryptItem,
  encryptItem,
} from "../../src/lib/journal/crypt.ts";
import { emitStream } from "../../src/lib/stream.ts";
import {
  createJournalState,
  journalReducer,
} from "../../src/reducers/journalReducer.ts";
import type { EncryptedRecord } from "../../src/types/Sync.ts";
import type { JournalAction, JournalItem, JournalState } from "../../src/types/Journal.ts";

const realTimeout = setTimeout;
const BUCKETS = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"],
);

const eventOf = (change: Change) => {
  if (change.type === "deleted") throw new Error("deleted change");
  return change.record;
};

const bucketOf = (id: string) => id.slice(0, 2);

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

type SyncBody = {
  hash?: string;
  buckets?: string[];
  records?: { id: string; ts: number }[];
};

type Change =
  | { type: "added" | "updated"; record: EncryptedRecord }
  | { type: "deleted"; id: string };

class FakeServer {
  rows = new Map<string, EncryptedRecord>();
  requests: { endpoint: string; body: Change[] & SyncBody }[] = [];
  perPage = Infinity;
  fail: "network" | "full" | null = null;
  gate: Promise<void> | null = null;
  syncGate: Promise<void> | null = null;

  saves = () => this.requests.filter((r) => r.endpoint.startsWith("journal/save"));
  syncs = () => this.requests.filter((r) => r.endpoint === "journal/sync");

  async seed(...items: JournalItem[]) {
    for (const item of items) this.rows.set(item.id, await encryptItem(item, key));
  }

  items = () =>
    Promise.all(Array.from(this.rows.values(), (row) => decryptItem(row, key)));

  post = async (endpoint: string, body: Change[] & SyncBody) => {
    this.requests.push({ endpoint, body });
    if (endpoint.startsWith("journal/save")) return this.save(body);
    return this.sync(body);
  };

  private async save(changes: Change[]) {
    await this.gate;
    if (this.fail === "network")
      return { success: false, message: "offline", code: "internal_error" };
    if (this.fail === "full")
      return { success: false, code: "storage_limit_reached" };
    for (const change of changes) {
      if (change.type === "deleted") this.rows.delete(change.id);
      else if (
        (this.rows.get(change.record.id)?.updatedAt ?? -1) <=
        change.record.updatedAt
      )
        this.rows.set(change.record.id, change.record);
    }
    return { success: true };
  }

  private async sync(body: SyncBody) {
    await this.syncGate;
    const lines = Array.from(this.rows.values(), (r) => ({
      id: r.id,
      ts: r.updatedAt,
    }));
    if (body.hash !== undefined) {
      if ((await computeBucketHash(lines)) === body.hash)
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

    const buckets = body.buckets!;
    const client = new Map(body.records!.map((e) => [e.id, e.ts]));
    const deleted = body.records!.filter(
      (e) => buckets.includes(bucketOf(e.id)) && !this.rows.has(e.id),
    ).map((e) => e.id);
    const send = Array.from(this.rows.values())
      .filter((r) => buckets.includes(bucketOf(r.id)))
      .sort(
        (a, b) =>
          buckets.indexOf(bucketOf(a.id)) - buckets.indexOf(bucketOf(b.id)) ||
          a.id.localeCompare(b.id),
      )
      .filter((r) => r.updatedAt > (client.get(r.id) ?? -1));
    const page = send.slice(0, this.perPage);
    return {
      success: true,
      data: {
        added: page.filter((r) => !client.has(r.id)),
        updated: page.filter((r) => client.has(r.id)),
        deleted,
        remaining:
          send.length > page.length
            ? buckets.slice(buckets.indexOf(bucketOf(send[page.length].id)))
            : [],
      },
    };
  }
}

let server: FakeServer;
let current: { state: JournalState; dispatch: Dispatch<JournalAction> };

function Harness({ initial, loaded = true }: { initial: JournalItem[]; loaded?: boolean }) {
  const [state, dispatch] = useReducer(journalReducer, undefined, () => ({
    ...createJournalState(),
    items: initial,
  }));
  current = { state, dispatch };
  useJournalSync({ items: state.items, loaded, dispatch });
  return null;
}

const until = (cond: () => boolean) =>
  act(async () => {
    for (let i = 0; i < 400 && !cond(); i++)
      await new Promise((resolve) => realTimeout(resolve, 5));
    expect(cond()).toBe(true);
  });

const idle = () =>
  act(async () => {
    for (let i = 0; i < 12; i++)
      await new Promise((resolve) => realTimeout(resolve, 5));
  });

const debounce = () =>
  act(async () => {
    vi.advanceTimersByTime(1000);
  });

const mount = async (initial: JournalItem[], seeded = initial) => {
  await server.seed(...seeded);
  const view = render(<Harness initial={initial} />);
  await idle();
  return view;
};

const edit = (id: string, content: string, now = 5000) =>
  act(() =>
    current.dispatch({ type: "setContent", id, content, now }),
  );

const hidePage = () => {
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
};

const reload = async (
  view: ReturnType<typeof render>,
  items: JournalItem[],
  rest: () => Promise<void> = async () => {},
) => {
  view.rerender(<Harness initial={[]} loaded={false} />);
  await act(() => current.dispatch({ type: "hydrate", state: { items } }));
  view.rerender(<Harness initial={[]} loaded />);
  await rest();
  await idle();
};

const ids = (items: JournalItem[]) => items.map((i) => i.id).toSorted();
const stateIds = () => ids(current.state.items);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  server = new FakeServer();
  session.masterKey = key;
  session.user = { type: "online", subscription_status: "active" };
  session.serverMeta = undefined;
  session.post = server.post;
  session.decryptGate = Promise.resolve();
});

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => realTimeout(resolve, 30));
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useJournalSync saving", () => {
  it("sends only items that differ from what was loaded", async () => {
    const [a, b] = [note("0a", 1), note("0a", 2)];
    await mount([a, b]);
    expect(server.saves()).toHaveLength(0);

    await edit(a.id, "changed");
    await debounce();
    await until(() => server.saves().length === 1);

    const [{ body, endpoint }] = server.saves();
    expect(endpoint).toBe(`journal/save?c=${CLIENT_ID}`);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ type: "updated", record: { id: a.id } });
    expect((await server.items()).find((i) => i?.id === a.id)?.content).toBe(
      "changed",
    );
  });

  it("sends created items as added and encrypts their content", async () => {
    await mount([]);
    const created = note("0b", 1, { content: "private words", name: "Hidden" });
    await act(() =>
      current.dispatch({
        type: "addItem",
        id: created.id,
        kind: "note",
        name: "Hidden",
        parentId: null,
        now: 2000,
      }),
    );
    await act(() =>
      current.dispatch({ type: "setContent", id: created.id, content: "private words", now: 3000 }),
    );
    await debounce();
    await until(() => server.saves().length === 1);

    const [change] = server.saves()[0].body;
    expect(change).toMatchObject({ type: "added", record: { id: created.id, updatedAt: 3000 } });
    expect(atob(eventOf(change).data)).not.toContain("private");
    expect(atob(eventOf(change).data)).not.toContain("Hidden");
  });

  it("sends removed items as deleted", async () => {
    const [a, b] = [note("0a", 1), note("0a", 2)];
    await mount([a, b]);

    await act(() => current.dispatch({ type: "removeItem", id: a.id }));
    await debounce();
    await until(() => server.saves().length === 1);

    expect(server.saves()[0].body).toEqual([{ type: "deleted", id: a.id }]);
    expect(Array.from(server.rows.keys())).toEqual([b.id]);

    await edit(b.id, "again", 5001);
    await debounce();
    await until(() => server.saves().length === 2);
    expect(server.saves()[1].body.map((c) => c.type)).toEqual(["updated"]);
  });

  it("debounces edits into one save", async () => {
    const a = note("0a", 1);
    await mount([a]);

    await edit(a.id, "1", 5000);
    await act(async () => void vi.advanceTimersByTime(600));
    await edit(a.id, "2", 5001);
    await act(async () => void vi.advanceTimersByTime(600));
    expect(server.saves()).toHaveLength(0);

    await debounce();
    await until(() => server.saves().length === 1);
    expect((await server.items())[0]?.content).toBe("2");
  });

  it("keeps an item edited during a save pending", async () => {
    const a = note("0a", 1);
    await mount([a]);
    let release!: () => void;
    server.gate = new Promise((resolve) => (release = resolve));

    await edit(a.id, "first", 5000);
    await debounce();
    await until(() => server.saves().length === 1);
    await edit(a.id, "second", 5001);
    release();
    server.gate = null;
    await idle();
    await debounce();
    await until(() => server.saves().length === 2);

    expect(eventOf(server.saves()[1].body[0]).updatedAt).toBe(5001);
    expect((await server.items())[0]?.content).toBe("second");
  });

  it("does not resend acknowledged items", async () => {
    const a = note("0a", 1);
    await mount([a]);

    await edit(a.id, "x");
    await debounce();
    await until(() => server.saves().length === 1);
    await idle();
    const syncs = server.syncs().length;
    await debounce();
    hidePage();
    await idle();

    expect(server.saves()).toHaveLength(1);
    expect(server.syncs()).toHaveLength(syncs);
  });

  it("sends in chunks of at most 20 changes", async () => {
    const many = Array.from({ length: 45 }, (_, i) => note("0a", i));
    await mount(many);

    for (const item of many) await act(() => current.dispatch({ type: "setContent", id: item.id, content: "x", now: 6000 }));
    await debounce();
    await until(() => server.saves().length === 3);

    expect(server.saves().map((s) => s.body.length)).toEqual([20, 20, 5]);
  });

  it("retries after a network error on the next change", async () => {
    const a = note("0a", 1);
    await mount([a]);
    server.fail = "network";

    await edit(a.id, "x");
    await debounce();
    await until(() => server.saves().length === 1);
    expect(server.rows.get(a.id)).toBeDefined();
    expect((await server.items())[0]?.content).toBe("");
    expect(toast.error).not.toHaveBeenCalled();

    server.fail = null;
    await edit(a.id, "y", 5001);
    await debounce();
    await until(() => server.saves().length === 2);
    expect((await server.items())[0]?.content).toBe("y");
  });

  it("toasts a full storage and keeps the batch pending", async () => {
    const a = note("0a", 1);
    await mount([a]);
    server.fail = "full";

    await edit(a.id, "x");
    await debounce();
    await until(() => server.saves().length === 1);
    await idle();
    expect(toast.error).toHaveBeenCalledWith(
      "Your storage is full, so the journal could not be synced.",
      { id: "journal-storage-full" },
    );
    expect(server.syncs()).toHaveLength(1);

    server.fail = null;
    await edit(a.id, "y", 5001);
    await debounce();
    await until(() => server.saves().length === 2);
    expect((await server.items())[0]?.content).toBe("y");
  });

  const noise = () =>
    Array.from({ length: 40000 }, () => Math.random().toString(36)).join("");

  it("skips an oversized item with a deduplicated toast and sends the rest", async () => {
    const [big, small] = [note("0a", 1), note("0a", 2)];
    await mount([big, small]);
    expect(noise().length).toBeGreaterThan(MAX_ENCRYPTED_JOURNAL_BYTES);

    await edit(big.id, noise(), 5000);
    await edit(small.id, "ok", 5000);
    await debounce();
    await until(() => server.rows.get(small.id)?.updatedAt === 5000);

    expect(server.saves()[0].body.map((c) => (c.type === "deleted" ? c.id : c.record.id))).toEqual([
      small.id,
    ]);
    expect(toast.error).toHaveBeenCalledWith(
      `"${big.name}" is too large to sync.`,
      { id: `journal-too-large-${big.id}` },
    );

    await edit(small.id, "again", 5001);
    await debounce();
    await until(() => server.rows.get(small.id)?.updatedAt === 5001);
    await idle();
    expect(
      new Set(vi.mocked(toast.error).mock.calls.map(([, options]) => options?.id)),
    ).toEqual(new Set([`journal-too-large-${big.id}`]));
    expect(server.rows.get(big.id)?.updatedAt).toBe(1000);
  });

  it("does not toast for an oversized item while re-saving", async () => {
    const big = note("0a", 1, { updatedAt: 3000, content: noise() });
    await server.seed({ ...big, updatedAt: 2000, content: "" });
    render(<Harness initial={[big]} />);
    await idle();

    expect(toast.error).not.toHaveBeenCalled();
    expect(server.saves()).toHaveLength(0);
  });

  it("saves immediately when the page gets hidden", async () => {
    const a = note("0a", 1);
    await mount([a]);

    await edit(a.id, "x");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await until(() => server.saves().length === 1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("flushes pending edits when it unmounts", async () => {
    const a = note("0a", 1);
    const view = await mount([a]);

    await edit(a.id, "late");
    view.unmount();
    await until(() => server.saves().length === 1);
  });
});

describe("useJournalSync pulling", () => {
  it("pulls items the server has after loading", async () => {
    const [a, b] = [note("0a", 1), note("ff", 2)];
    await mount([a], [a, b]);
    await until(() => stateIds().length === 2);

    expect(stateIds()).toEqual(ids([a, b]));
    expect(current.state.items.find((i) => i.id === b.id)).toEqual(b);
  });

  it("skips a row that cannot be decrypted and pulls the rest", async () => {
    const [a, b] = [note("0a", 1), note("ff", 2)];
    await server.seed(a, b);
    server.rows.set(a.id, { ...server.rows.get(a.id)!, data: "AAAA" });
    render(<Harness initial={[]} />);
    await idle();
    await until(() => stateIds().length === 1);

    expect(stateIds()).toEqual(ids([b]));
  });

  it("does not send pulled items back", async () => {
    await mount([], [note("0a", 1)]);
    await until(() => stateIds().length === 1);
    await debounce();
    await idle();

    expect(server.saves()).toHaveLength(0);
  });

  it("stops after the global hash when nothing differs", async () => {
    const a = note("0a", 1);
    await mount([a]);

    expect(server.syncs()).toHaveLength(1);
    expect(server.syncs()[0].body).toHaveProperty("hash");
  });

  it("only asks for the buckets whose hash differs", async () => {
    const [a, b] = [note("0a", 1), note("ff", 2)];
    await mount([a], [a, b, note("c3", 3)]);
    await until(() => stateIds().length === 3);

    const requested = server.syncs().slice(1).map((s) => s.body.buckets);
    expect(requested).toEqual([["c3", "ff"]]);
    expect(server.syncs()[1].body.records).toEqual([]);
  });

  it("follows remaining across pages", async () => {
    const items = [note("0a", 1), note("0a", 2), note("0b", 3), note("0c", 4), note("0c", 5)];
    server.perPage = 2;
    await mount([], items);
    await until(() => stateIds().length === 5);

    expect(stateIds()).toEqual(ids(items));
    const pages = server.syncs().slice(1).map((s) => s.body.buckets);
    expect(pages).toEqual([
      ["0a", "0b", "0c"],
      ["0b", "0c"],
      ["0c"],
    ]);
    expect(server.syncs()[3].body.records!.map((e: { id: string }) => e.id)).toEqual([
      items[3].id,
    ]);
  });

  it("does not repeat deleted ids on later pages", async () => {
    const gone = note("0c", 9);
    const items = [note("0b", 1), note("0b", 2)];
    server.perPage = 1;
    await server.seed(...items);
    render(<Harness initial={[gone]} />);
    await until(() => stateIds().length === 2);

    const pages = server.syncs().slice(1);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].body.records!.map((e: { id: string }) => e.id)).toEqual([gone.id]);
    expect(pages[1].body.records!.map((e: { id: string }) => e.id)).not.toContain(gone.id);
  });

  it("removes items the server deleted", async () => {
    const [a, b] = [note("0a", 1), note("0a", 2)];
    await mount([a, b], [a]);
    await until(() => stateIds().length === 1);

    expect(stateIds()).toEqual([a.id]);
    await debounce();
    await idle();
    expect(server.saves()).toHaveLength(0);
  });

  it("never replaces a pending item with the server copy", async () => {
    const a = note("0a", 1);
    server.fail = "network";
    await mount([a], [{ ...a, updatedAt: 9000, name: "server" }]);
    await until(() => stateIds().length === 1);
    expect(current.state.items[0].name).toBe("server");

    await edit(a.id, "local", 8000);
    await debounce();
    await until(() => server.saves().length === 1);
    await idle();
    const before = server.syncs().length;
    emitStream({ type: "sync" });
    await until(() => server.syncs().length > before + 1);
    await idle();

    expect(current.state.items[0].content).toBe("local");
    expect(current.state.items[0].name).toBe("server");
  });

  it("does not resurrect an item deleted locally and not yet saved", async () => {
    const a = note("0a", 1);
    server.fail = "network";
    await mount([a]);

    await act(() => current.dispatch({ type: "removeItem", id: a.id }));
    await debounce();
    await until(() => server.saves().length === 1);
    emitStream({ type: "sync" });
    await until(() => server.syncs().length >= 3);
    await idle();

    expect(stateIds()).toEqual([]);
  });

  it("re-saves its own items when the server only holds older ones", async () => {
    const mine = note("0a", 1, { updatedAt: 3000, content: "mine" });
    const other = note("c3", 2);
    await server.seed({ ...mine, updatedAt: 2000, content: "stale" }, other);
    render(<Harness initial={[mine, other]} />);
    await until(() => server.saves().length === 1);

    expect(server.saves()[0].body.map((c) => (c.type === "deleted" ? c.id : c.record.id))).toEqual([mine.id]);
    expect((await server.items())[0]).toEqual(mine);
  });

  it("learns the newer server copy after its older save lost", async () => {
    const a = note("0a", 1, { updatedAt: 1000 });
    await mount([a]);
    await server.seed({ ...a, updatedAt: 8000, name: "other device" });

    await edit(a.id, "late edit", 5000);
    await debounce();
    await until(() => current.state.items[0].name === "other device");

    expect(server.saves()).toHaveLength(1);
    expect(current.state.items[0].updatedAt).toBe(8000);
  });

  it("starts from the new baseline when the journal is reloaded", async () => {
    const [a, b] = [note("0a", 1), note("0b", 2)];
    const view = await mount([a], [a, b]);
    await until(() => stateIds().length === 2);

    await reload(view, [b]);
    await debounce();
    await idle();

    expect(server.saves()).toHaveLength(0);
    expect(server.rows.has(a.id)).toBe(true);
  });

  it("ignores a save that finishes after the journal was reloaded", async () => {
    const [a, b] = [note("0a", 1), note("0b", 2)];
    const view = await mount([a, b]);
    let release!: () => void;
    server.gate = new Promise((resolve) => (release = resolve));

    await edit(a.id, "x");
    await debounce();
    await until(() => server.saves().length === 1);
    await reload(view, [b], async () => {
      release();
      server.gate = null;
      await idle();
    });
    await debounce();
    await idle();

    expect(server.saves()).toHaveLength(1);
  });

  it("ignores a pull that was decrypting when the journal was reloaded", async () => {
    const [a, b] = [note("0a", 1), note("0b", 2)];
    await server.seed(a, b);
    let release!: () => void;
    session.decryptGate = new Promise((resolve) => (release = resolve));
    const view = render(<Harness initial={[b]} />);
    await until(() => server.syncs().length >= 2);

    let releaseFresh!: () => void;
    await reload(view, [b], async () => {
      session.decryptGate = new Promise((resolve) => (releaseFresh = resolve));
      release();
      await idle();
      expect(stateIds()).toEqual([b.id]);
      releaseFresh();
    });
    await until(() => stateIds().length === 2);
  });

  it("syncs again on a stream sync message", async () => {
    await mount([]);
    await server.seed(note("0a", 1));

    emitStream({ type: "sync" });
    await until(() => stateIds().length === 1);
  });
});

describe("useJournalSync stream", () => {
  const change = async (item: JournalItem, type: "added" | "updated" = "updated") => {
    const event = await encryptItem(item, key);
    return { type, id: event.id, data: event.data, updatedAt: event.updatedAt };
  };

  it("applies changes from other clients", async () => {
    const [a, b, c] = [note("0a", 1), note("0a", 2), note("0a", 3)];
    await mount([a, b]);
    const before = server.syncs().length;

    emitStream({
      type: "journal",
      originClientId: "other1",
      changes: [
        await change({ ...a, updatedAt: 2000, name: "renamed" }),
        await change(c, "added"),
        { type: "deleted", id: b.id },
      ],
    });
    await until(() => stateIds().includes(c.id));

    expect(stateIds()).toEqual(ids([a, c]));
    expect(current.state.items.find((i) => i.id === a.id)?.name).toBe("renamed");
    expect(server.syncs()).toHaveLength(before);
  });

  it("ignores a message that was decrypting when the journal was reloaded", async () => {
    const [b, c] = [note("0b", 2), note("0c", 3)];
    const view = await mount([b]);
    let release!: () => void;
    let releaseSync!: () => void;
    session.decryptGate = new Promise((resolve) => (release = resolve));

    emitStream({
      type: "journal",
      originClientId: "other1",
      changes: [await change(c, "added")],
    });
    await idle();
    server.syncGate = new Promise((resolve) => (releaseSync = resolve));
    await reload(view, [b], async () => {
      release();
      await idle();
      expect(stateIds()).toEqual([b.id]);
      releaseSync();
    });
  });

  it("ignores its own messages", async () => {
    const a = note("0a", 1);
    await mount([a]);

    emitStream({
      type: "journal",
      originClientId: CLIENT_ID,
      changes: [await change({ ...a, updatedAt: 2000, name: "renamed" })],
    });
    await idle();

    expect(current.state.items[0].name).toBe(a.name);
  });

  it("does not sync again on its own sync message", async () => {
    await mount([note("0a", 1)]);
    await server.seed(note("0a", 2));
    const before = server.syncs().length;

    emitStream({ type: "sync", originClientId: CLIENT_ID });
    await idle();

    expect(server.syncs().length).toBe(before);
    expect(stateIds()).toHaveLength(1);
  });

  it("skips older versions and pending ids", async () => {
    const [a, b] = [note("0a", 1, { updatedAt: 3000 }), note("0a", 2)];
    await mount([a, b]);
    server.fail = "network";
    await edit(b.id, "local", 4000);

    emitStream({
      type: "journal",
      originClientId: "other1",
      changes: [
        await change({ ...a, updatedAt: 2000, name: "older" }),
        await change({ ...b, updatedAt: 9000, name: "pending" }),
      ],
    });
    await idle();

    expect(current.state.items.map((i) => i.name)).toEqual([a.name, b.name]);
  });

  it("syncs when a change cannot be decrypted", async () => {
    await mount([]);
    const before = server.syncs().length;

    emitStream({
      type: "journal",
      originClientId: "other1",
      changes: [{ type: "updated", id: note("0a", 1).id, data: btoa("garbage-bytes-that-are-long-enough"), updatedAt: 5 }],
    });
    await until(() => server.syncs().length > before);
  });

  it("syncs on a journal message without changes and emits no sync message", async () => {
    await mount([note("0a", 1)]);
    await server.seed(note("0a", 2));
    const seen = vi.fn();
    const { stream } = await import("../../src/lib/stream.ts");
    stream.addEventListener("sync", seen);

    emitStream({ type: "journal", originClientId: "other1" });
    await until(() => stateIds().length === 2);
    stream.removeEventListener("sync", seen);

    expect(seen).not.toHaveBeenCalled();
  });
});

describe("useJournalSync gating", () => {
  const silent = async () => {
    await server.seed(note("0a", 1));
    const a = note("0b", 2);
    const view = render(<Harness initial={[a]} />);
    await edit(a.id, "x");
    await debounce();
    await idle();
    emitStream({ type: "sync" });
    await idle();
    view.unmount();
    await idle();
    expect(server.requests).toEqual([]);
  };

  it("does nothing for offline users", async () => {
    session.user = { type: "offline" };
    await silent();
  });

  it("does nothing while locked", async () => {
    session.masterKey = null;
    await silent();
  });

  it("does nothing while the subscription is missing", async () => {
    session.user = { type: "online", subscription_status: "canceled" };
    session.serverMeta = { registration: { subscriptionRequired: true } };
    await silent();
  });

  it("does nothing before the journal is loaded", async () => {
    await server.seed(note("0a", 1));
    render(<Harness initial={[]} loaded={false} />);
    await idle();
    emitStream({ type: "sync" });
    await idle();
    expect(server.requests).toEqual([]);
  });
});
