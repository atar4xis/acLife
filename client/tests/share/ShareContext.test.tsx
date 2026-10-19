import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  masterKey: null as CryptoKey | null,
  user: undefined as unknown,
  serverMeta: undefined as unknown,
  contacts: {} as Record<string, string>,
  lastSynced: {} as Record<string, string>,
  contactEmails: null as string | null,
  nicknames: null as unknown,
  get: undefined as unknown as (endpoint: string) => Promise<unknown>,
  post: undefined as unknown as (
    endpoint: string,
    body: unknown,
  ) => Promise<unknown>,
  del: undefined as unknown as (endpoint: string) => Promise<unknown>,
}));

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

vi.mock("../../src/context/ApiContext.tsx", () => {
  const api = {
    get: (endpoint: string) => session.get(endpoint),
    post: (endpoint: string, body: unknown) => session.post(endpoint, body),
    del: (endpoint: string) => session.del(endpoint),
    get serverMeta() {
      return session.serverMeta;
    },
  };
  return { useApi: () => api };
});

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: session.user, masterKey: session.masterKey }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => {
  const get = (key: string) => {
    if (key === "shareContacts") return session.contacts;
    if (key === "journalLastSynced") return session.lastSynced;
    if (key === "contactEmails") return session.contactEmails;
    if (key === "contactNicknames") return session.nicknames;
    return {};
  };
  const set = (key: string, value: never) => {
    if (key === "shareContacts") session.contacts = value;
    if (key === "journalLastSynced") session.lastSynced = value;
    if (key === "contactEmails") session.contactEmails = value;
    if (key === "contactNicknames") session.nicknames = value;
  };
  const storage = { ready: true, get, set };
  return { useStorage: () => storage };
});

import { ShareProvider, useShares } from "../../src/context/ShareContext.tsx";
import {
  generateKeyPair,
  generateSpaceKey,
  unwrapSpaceKey,
  unwrapSpaceKeyForOwner,
  wrapPrivateKey,
  wrapSpaceKey,
  wrapSpaceKeyForOwner,
} from "../../src/lib/shareCrypto.ts";
import { toast } from "sonner";
import { t } from "../../src/i18n";
import { CLIENT_ID } from "../../src/lib/clientId.ts";
import { emitStream } from "../../src/lib/stream.ts";
import { decryptJson } from "../../src/lib/crypt.ts";
import { arrayBufferToBase64 } from "../../src/lib/utils.ts";

type Keys = { publicKey: string; wrappedPrivate: string };

class FakeServer {
  keys: Keys | null = null;
  racing: Keys | null = null;
  list: { owned: unknown[]; received: unknown[] } = { owned: [], received: [] };
  requests: { method: string; endpoint: string; body?: unknown }[] = [];
  lookupFails = false;
  lookups = new Map<string, { uuid: string; publicKey: string }>();

  get = async (endpoint: string) => {
    this.requests.push({ method: "GET", endpoint });
    if (endpoint === "user/keys")
      return { success: true, data: this.keys ?? undefined };
    if (endpoint === "shares") return { success: true, data: this.list };
    return { success: false };
  };

  post = async (path: string, body: unknown) => {
    const endpoint = path.split("?")[0];
    this.requests.push({ method: "POST", endpoint, body });
    if (endpoint === "user/keys") {
      if (this.racing) {
        this.keys = this.racing;
        this.racing = null;
      }
      if (this.keys) return { success: false, code: "keys_exist" };
      this.keys = body as Keys;
      return { success: true };
    }
    if (endpoint === "user/keys/lookup") {
      const found = this.lookups.get((body as { email: string }).email);
      if (this.lookupFails) return { success: false, code: "internal_error" };
      if ((body as { email: string }).email === "me@example.com")
        return { success: false, code: "self" };
      return found
        ? { success: true, data: found }
        : { success: false, code: "user_not_found" };
    }
    if (endpoint === "shares/spaces")
      return { success: true, data: { id: "new-space" } };
    return { success: true };
  };

  del = async (path: string) => {
    const endpoint = path.split("?")[0];
    this.requests.push({ method: "DELETE", endpoint });
    return { success: true };
  };

  find = (endpoint: string) =>
    this.requests.filter((r) => r.endpoint === endpoint);
}

let server: FakeServer;

const wrapper = ({ children }: { children: ReactNode }) => (
  <ShareProvider>{children}</ShareProvider>
);

const mount = () => renderHook(() => useShares(), { wrapper });

beforeEach(async () => {
  server = new FakeServer();
  session.masterKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  session.user = { type: "online", uuid: "me", subscription_status: "active" };
  session.serverMeta = undefined;
  session.contacts = {};
  session.lastSynced = {};
  session.contactEmails = null;
  session.nicknames = null;
  session.get = server.get;
  session.post = server.post;
  session.del = server.del;
});

afterEach(() => vi.clearAllMocks());

describe("key pair", () => {
  it("creates and uploads a key pair on the first run", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    expect(server.keys).not.toBeNull();
    expect(result.current.publicKey).toBe(server.keys!.publicKey);
    expect(server.keys!.wrappedPrivate).not.toContain(server.keys!.publicKey);
  });

  it("uses the key pair another device stored first", async () => {
    const other = await generateKeyPair();
    server.racing = {
      publicKey: arrayBufferToBase64(other.publicKey.buffer),
      wrappedPrivate: await wrapPrivateKey(
        other.privateKey,
        session.masterKey!,
      ),
    };

    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.publicKey).toBe(server.keys!.publicKey);
    expect(result.current.publicKey).toBe(
      arrayBufferToBase64(other.publicKey.buffer),
    );
  });

  it("gives up without retrying when the upload is refused", async () => {
    server.post = async (endpoint, body) => {
      server.requests.push({ method: "POST", endpoint, body });
      return { success: false, code: "rate_limited" };
    };
    session.post = (endpoint, body) => server.post(endpoint, body);

    const { result } = mount();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result.current.enabled).toBe(false);
    expect(
      server.find("user/keys").filter((r) => r.method === "POST"),
    ).toHaveLength(1);
  });

  it("reuses the stored key pair afterwards", async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.enabled).toBe(true));
    const stored = server.keys;
    first.unmount();
    server.requests = [];

    const second = mount();
    await waitFor(() => expect(second.result.current.enabled).toBe(true));
    expect(
      server.find("user/keys").filter((r) => r.method === "POST"),
    ).toHaveLength(0);
    expect(second.result.current.publicKey).toBe(stored!.publicKey);
  });

  it("does not unlock with another master key", async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.enabled).toBe(true));
    first.unmount();

    session.masterKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const second = mount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(second.result.current.enabled).toBe(false);
  });

  it("stays off for offline users, locked accounts and lapsed subscriptions", async () => {
    session.user = { type: "offline" };
    const offline = mount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(offline.result.current.enabled).toBe(false);
    offline.unmount();

    session.user = {
      type: "online",
      uuid: "me",
      subscription_status: "active",
    };
    session.masterKey = null;
    const locked = mount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(locked.result.current.enabled).toBe(false);
    locked.unmount();

    session.masterKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    session.user = {
      type: "online",
      uuid: "me",
      subscription_status: "canceled",
    };
    session.serverMeta = { registration: { subscriptionRequired: true } };
    const lapsed = mount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(lapsed.result.current.enabled).toBe(false);
    expect(server.requests).toHaveLength(0);
  });
});

describe("shares", () => {
  it("rejects a wrapped key the server moved to another space", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    const owner = await generateKeyPair();
    const wrappedKey = await wrapSpaceKey(
      generateSpaceKey(),
      owner.privateKey,
      result.current.publicKey!,
      "s1",
    );
    const share = (id: string) => ({
      id,
      owner: "owner",
      ownerEmail: "owner@example.com",
      ownerPublicKey: arrayBufferToBase64(owner.publicKey.buffer),
      kind: "journal",
      scope: "collection",
      permission: "write",
      status: "accepted",
      wrappedKey,
      keyVersion: 1,
    });
    server.list = { owned: [], received: [share("s1")] };
    await act(() => result.current.refresh());
    server.list = { owned: [], received: [share("s1"), share("s2")] };
    await act(() => result.current.refresh());

    expect(result.current.joined.map((space) => space.id)).toEqual(["s1"]);
  });

  it("opens the key of a share accepted from someone", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    const raw = generateSpaceKey();
    const owner = await generateKeyPair();
    const ownerPublicKey = arrayBufferToBase64(owner.publicKey.buffer);
    const wrapFromOwner = () =>
      wrapSpaceKey(raw, owner.privateKey, result.current.publicKey!, "s1");
    server.list = {
      owned: [],
      received: [
        {
          id: "s1",
          owner: "owner",
          ownerEmail: "owner@example.com",
          ownerPublicKey,
          kind: "journal",
          scope: "collection",
          permission: "write",
          status: "accepted",
          wrappedKey: await wrapFromOwner(),
          keyVersion: 1,
        },
        {
          id: "s2",
          owner: "owner",
          ownerEmail: "owner@example.com",
          ownerPublicKey,
          kind: "calendar",
          scope: "item",
          permission: "read",
          status: "pending",
          wrappedKey: await wrapFromOwner(),
          keyVersion: 1,
        },
      ],
    };
    await act(() => result.current.refresh());

    expect(result.current.joined).toHaveLength(1);
    expect(result.current.joined[0]).toMatchObject({
      id: "s1",
      ownerEmail: "owner@example.com",
      permission: "write",
    });
    expect(result.current.invites.map((i) => i.id)).toEqual(["s2"]);

    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(12) },
      result.current.joined[0].keys.key,
      new TextEncoder().encode("hi"),
    );
    expect(sealed.byteLength).toBeGreaterThan(2);
  });

  it("drops a share whose key was not wrapped by the owner", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const owner = await generateKeyPair();
    const forger = await generateKeyPair();

    server.list = {
      owned: [],
      received: [
        {
          id: "s1",
          owner: "o",
          ownerEmail: "o@example.com",
          ownerPublicKey: arrayBufferToBase64(owner.publicKey.buffer),
          kind: "journal",
          scope: "item",
          permission: "read",
          status: "accepted",
          wrappedKey: await wrapSpaceKey(
            generateSpaceKey(),
            forger.privateKey,
            result.current.publicKey!,
            "s1",
          ),
          keyVersion: 1,
        },
      ],
    };
    await act(() => result.current.refresh());
    expect(result.current.joined).toEqual([]);
  });

  it("drops a share whose key was wrapped for another space", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const owner = await generateKeyPair();

    server.list = {
      owned: [],
      received: [
        {
          id: "s1",
          owner: "o",
          ownerEmail: "o@example.com",
          ownerPublicKey: arrayBufferToBase64(owner.publicKey.buffer),
          kind: "journal",
          scope: "item",
          permission: "read",
          status: "accepted",
          wrappedKey: await wrapSpaceKey(
            generateSpaceKey(),
            owner.privateKey,
            result.current.publicKey!,
            "s2",
          ),
          keyVersion: 1,
        },
      ],
    };
    await act(() => result.current.refresh());
    expect(result.current.joined).toEqual([]);
  });

  it("leaves a joined share and forgets the owner once their key differs from the pinned one", async () => {
    session.contacts = { o: "pinned-earlier" };
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const owner = await generateKeyPair();

    server.list = {
      owned: [],
      received: [
        {
          id: "s1",
          owner: "o",
          ownerEmail: "o@example.com",
          ownerPublicKey: arrayBufferToBase64(owner.publicKey.buffer),
          kind: "journal",
          scope: "item",
          permission: "read",
          status: "accepted",
          wrappedKey: await wrapSpaceKey(
            generateSpaceKey(),
            owner.privateKey,
            result.current.publicKey!,
            "s1",
          ),
          keyVersion: 1,
        },
      ],
    };
    session.del = async (path: string) => {
      server.list = { owned: [], received: [] };
      return server.del(path);
    };
    await act(() => result.current.refresh());

    expect(server.find("shares/members/s1/me")).toHaveLength(1);
    expect(result.current.joined).toEqual([]);
    expect(session.contacts).toEqual({});
  });

  it("keeps its actions and value stable across rerenders", async () => {
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const before = result.current;

    rerender();

    expect(result.current).toBe(before);
  });

  it("keeps the pin and refuses the share while leaving it keeps failing", async () => {
    session.contacts = { o: "pinned-earlier" };
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const owner = await generateKeyPair();

    server.list = {
      owned: [],
      received: [
        {
          id: "s1",
          owner: "o",
          ownerEmail: "o@example.com",
          ownerPublicKey: arrayBufferToBase64(owner.publicKey.buffer),
          kind: "journal",
          scope: "item",
          permission: "read",
          status: "accepted",
          wrappedKey: await wrapSpaceKey(
            generateSpaceKey(),
            owner.privateKey,
            result.current.publicKey!,
            "s1",
          ),
          keyVersion: 1,
        },
      ],
    };
    const leave = session.del;
    session.del = async () => ({ success: false });
    await act(() => result.current.refresh());
    await act(() => result.current.refresh());

    expect(result.current.joined).toEqual([]);
    expect(session.contacts).toEqual({ o: "pinned-earlier" });

    session.del = async (path: string) => {
      server.list = { owned: [], received: [] };
      return leave(path);
    };
    await act(() => result.current.refresh());

    expect(session.contacts).toEqual({});
  });

  it("forgets the owner when another device already left their share", async () => {
    session.contacts = { o: "pinned-earlier" };
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const owner = await generateKeyPair();

    server.list = {
      owned: [],
      received: [
        {
          id: "s1",
          owner: "o",
          ownerEmail: "o@example.com",
          ownerPublicKey: arrayBufferToBase64(owner.publicKey.buffer),
          kind: "journal",
          scope: "item",
          permission: "read",
          status: "accepted",
          wrappedKey: await wrapSpaceKey(
            generateSpaceKey(),
            owner.privateKey,
            result.current.publicKey!,
            "s1",
          ),
          keyVersion: 1,
        },
      ],
    };
    session.del = async () => {
      server.list = { owned: [], received: [] };
      return { success: false, code: "share_not_found" };
    };
    await act(() => result.current.refresh());

    expect(session.contacts).toEqual({});
  });

  it("treats a space that is already gone as deleted", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    session.del = async () => ({ success: false, code: "share_not_found" });

    let deleted = false;
    await act(async () => {
      deleted = await result.current.deleteSpace("s");
    });

    expect(deleted).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("removes a member and forgets them once their key differs from the pinned one", async () => {
    session.contacts = { m: "pinned-earlier", keep: "same" };
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const member = (user: string, publicKey: string) => ({
      user,
      email: `${user}@example.com`,
      publicKey,
      permission: "read",
      status: "accepted",
    });

    server.list = {
      owned: [
        {
          id: "mine",
          kind: "journal",
          scope: "collection",
          keyVersion: 1,
          members: [member("m", "new-key"), member("keep", "same")],
          ownerKey: "unreadable",
        },
      ],
      received: [],
    };
    await act(() => result.current.refresh());

    expect(server.find("shares/members/mine/m")).toHaveLength(1);
    expect(server.find("shares/members/mine/keep")).toHaveLength(0);
    expect(session.contacts).toEqual({ keep: "same" });
  });

  it("keeps a member whose key the server did not return", async () => {
    session.contacts = { m: "pinned-earlier" };
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    server.list = {
      owned: [
        {
          id: "mine",
          kind: "journal",
          scope: "collection",
          keyVersion: 1,
          members: [
            {
              user: "m",
              email: "m@example.com",
              publicKey: "",
              permission: "read",
              status: "accepted",
            },
          ],
          ownerKey: "unreadable",
        },
      ],
      received: [],
    };
    await act(() => result.current.refresh());

    expect(server.find("shares/members/mine/m")).toHaveLength(0);
    expect(session.contacts).toEqual({ m: "pinned-earlier" });
  });

  it("still lists my other spaces when one owner key is unreadable", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const owned = (id: string, ownerKey: string) => ({
      id,
      kind: "journal",
      scope: "collection",
      keyVersion: 1,
      members: [],
      ownerKey,
    });
    const good = await wrapSpaceKeyForOwner(
      new TextEncoder().encode(
        JSON.stringify({
          key: arrayBufferToBase64(generateSpaceKey().buffer),
          target: null,
          space: "good",
        }),
      ),
      session.masterKey!,
    );
    server.list = {
      owned: [owned("bad", "AAAA"), owned("good", good), owned("moved", good)],
      received: [],
    };

    await act(() => result.current.refresh());

    expect(result.current.owned.map((space) => space.id)).toEqual(["good"]);
  });

  it("shows the server's message when a share cannot be created", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    session.post = async () => ({
      success: false,
      message: "Share limit reached.",
    });
    const friend = await generateKeyPair();

    let id: string | null = "x";
    await act(async () => {
      id = await result.current.createShare({
        kind: "journal",
        scope: "item",
        target: "n",
        contact: {
          uuid: "friend",
          email: "friend@example.com",
          publicKey: arrayBufferToBase64(friend.publicKey.buffer),
        },
        permission: "read",
      });
    });

    expect(id).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Share limit reached.");
  });

  it("keeps the same keys across refreshes and skips an unchanged list", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const owner = await generateKeyPair();
    const ownerPublicKey = arrayBufferToBase64(owner.publicKey.buffer);
    const received = {
      id: "s1",
      owner: "o",
      ownerEmail: "o@example.com",
      ownerPublicKey,
      kind: "journal",
      scope: "item",
      permission: "read",
      status: "accepted",
      wrappedKey: await wrapSpaceKey(
        generateSpaceKey(),
        owner.privateKey,
        result.current.publicKey!,
        "s1",
      ),
      keyVersion: 1,
    };
    server.list = { owned: [], received: [received] };
    await act(() => result.current.refresh());
    const first = result.current.joined[0];

    await act(() => result.current.refresh());
    expect(result.current.joined[0]).toBe(first);

    server.list = {
      owned: [],
      received: [{ ...received, permission: "write" }],
    };
    await act(() => result.current.refresh());
    expect(result.current.joined[0]).not.toBe(first);
    expect(result.current.joined[0].permission).toBe("write");
    expect(result.current.joined[0].keys).toBe(first.keys);
  });

  it("shows the message of the server when a share is refused", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const friend = await generateKeyPair();
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("shares/spaces")
        ? { success: false, code: "share_limit_reached", message: "Limit reached." }
        : server.post(endpoint, body);

    let id: string | null = "unset";
    await act(async () => {
      id = await result.current.createShare({
        kind: "journal",
        scope: "item",
        target: "note-1",
        contact: { uuid: "friend", email: "friend@example.com", publicKey: arrayBufferToBase64(friend.publicKey.buffer) },
        permission: "read",
      });
    });

    expect(id).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Limit reached.");
  });

  it("creates a share: wraps the key for the person and keeps the owner's copy", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const friend = await generateKeyPair();
    const contact = {
      uuid: "friend",
      email: "friend@example.com",
      publicKey: arrayBufferToBase64(friend.publicKey.buffer),
    };

    let id: string | null = null;
    await act(async () => {
      id = await result.current.createShare({
        kind: "journal",
        scope: "collection",
        target: "folder-1",
        contact,
        permission: "write",
      });
    });

    const [{ body }] = server.find("shares/spaces") as {
      body: Record<string, unknown>;
    }[];
    expect(id).toBe(body.id);
    expect(body).toMatchObject({ kind: "journal", scope: "collection" });
    const [member] = body.members as {
      user: string;
      permission: string;
      wrappedKey: string;
    }[];
    expect(member).toMatchObject({ user: "friend", permission: "write" });

    const owner = JSON.parse(
      new TextDecoder().decode(
        await unwrapSpaceKeyForOwner(
          body.ownerKey as string,
          session.masterKey!,
        ),
      ),
    );
    expect(owner.target).toBe("folder-1");
    expect(owner.space).toBe(id);

    const opened = await unwrapSpaceKey(
      member.wrappedKey,
      friend.privateKey,
      result.current.publicKey!,
      id!,
    );
    expect(arrayBufferToBase64(opened.buffer)).toBe(owner.key);
    expect(session.contacts.friend).toBe(contact.publicKey);
  });

  it("lists a space I own with its target and key after a refresh", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    const raw = generateSpaceKey();
    server.list = {
      owned: [
        {
          id: "mine",
          kind: "calendar",
          scope: "item",
          keyVersion: 1,
          members: [],
          ownerKey: await wrapSpaceKeyForOwner(
            new TextEncoder().encode(
              JSON.stringify({
                key: arrayBufferToBase64(raw.buffer),
                target: "evt",
                space: "mine",
              }),
            ),
            session.masterKey!,
          ),
        },
      ],
      received: [],
    };
    await act(() => result.current.refresh());

    expect(result.current.owned).toHaveLength(1);
    expect(result.current.owned[0]).toMatchObject({
      id: "mine",
      target: "evt",
      kind: "calendar",
    });
    expect(Array.from(result.current.owned[0].raw)).toEqual(Array.from(raw));
  });

  it("does not open a space under an owner key that belongs to another space", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    const ownerKey = await wrapSpaceKeyForOwner(
      new TextEncoder().encode(
        JSON.stringify({
          key: arrayBufferToBase64(generateSpaceKey().buffer),
          target: "evt",
          space: "a",
        }),
      ),
      session.masterKey!,
    );
    const space = (id: string) => ({
      id,
      kind: "calendar",
      scope: "item",
      keyVersion: 1,
      members: [],
      ownerKey,
    });
    server.list = { owned: [space("a")], received: [] };
    await act(() => result.current.refresh());
    expect(result.current.owned.map((s) => s.id)).toEqual(["a"]);

    server.list = { owned: [space("a"), space("b")], received: [] };
    await act(() => result.current.refresh());
    expect(result.current.owned.map((s) => s.id)).toEqual(["a"]);
  });

  it("forgets the local data of spaces that are gone", async () => {
    const open = (name: string) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open(name, 1);
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
      });
    await Promise.all(
      ["acLifeShared-mine", "acLifeShared-gone", "acLifeEventCache"].map(open),
    );
    session.lastSynced = { mine: "kept", gone: "dropped" };
    const raw = generateSpaceKey();
    server.list = {
      owned: [
        {
          id: "mine",
          kind: "calendar",
          scope: "collection",
          keyVersion: 1,
          members: [],
          ownerKey: await wrapSpaceKeyForOwner(
            new TextEncoder().encode(
              JSON.stringify({
                key: arrayBufferToBase64(raw.buffer),
                target: null,
                space: "mine",
              }),
            ),
            session.masterKey!,
          ),
        },
      ],
      received: [],
    };
    const { result } = mount();
    await waitFor(() => expect(result.current.owned).toHaveLength(1));

    await waitFor(async () => {
      const names = (await indexedDB.databases()).map((db) => db.name);
      expect(names).toContain("acLifeShared-mine");
      expect(names).toContain("acLifeEventCache");
      expect(names).not.toContain("acLifeShared-gone");
    });
    expect(session.lastSynced).toEqual({ mine: "kept" });
  });

  it("keeps the newest answer when an older refresh finishes last", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await act(() => result.current.refresh());

    const invite = (id: string) => ({
      id,
      owner: "o",
      ownerEmail: "o@example.com",
      ownerPublicKey: "AAAA",
      kind: "journal",
      scope: "item",
      permission: "read",
      status: "pending",
      wrappedKey: "",
      keyVersion: 1,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = server.get;
    let calls = 0;
    session.get = async (endpoint: string) => {
      if (endpoint !== "shares") return original(endpoint);
      calls++;
      if (calls === 1) {
        await gate;
        return {
          success: true,
          data: { owned: [], received: [invite("old")] },
        };
      }
      return { success: true, data: { owned: [], received: [invite("new")] } };
    };

    let slow!: Promise<void>;
    act(() => {
      slow = result.current.refresh();
    });
    await act(() => result.current.refresh());
    expect(result.current.invites.map((i) => i.id)).toEqual(["new"]);

    release();
    await act(() => slow);
    expect(result.current.invites.map((i) => i.id)).toEqual(["new"]);
  });

  it("refreshes when the server says the shares changed", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() =>
      expect(server.find("shares").length).toBeGreaterThan(0),
    );
    const before = server.find("shares").length;

    await act(async () => emitStream({ type: "spaces" }));
    await waitFor(() =>
      expect(server.find("shares").length).toBeGreaterThan(before),
    );
  });

  it("reports the shares as loaded once the list arrived", async () => {
    const { result } = mount();
    expect(result.current.loaded).toBe(false);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(server.find("shares").length).toBeGreaterThan(0);
  });

  it("reports the shares as loaded when sharing is not available", async () => {
    session.user = { type: "offline" };
    const { result } = mount();

    expect(result.current.loaded).toBe(true);
  });

  it("reports the shares as loaded when the key pair cannot be set up", async () => {
    session.get = async () => ({ success: false });
    const { result } = mount();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.enabled).toBe(false);
  });

  it("shows a nickname instead of the email and forgets it with the contact", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const ann = { uuid: "ann", email: "ann@example.com", publicKey: "key-1" };
    act(() => result.current.pinContact(ann));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));
    expect(result.current.nameOf("ann", "ann@example.com")).toBe("ann@example.com");

    act(() => result.current.setNickname("ann", "  Annie  "));
    await waitFor(() => expect(result.current.nameOf("ann", "ann@example.com")).toBe("Annie"));
    expect(result.current.nicknames).toEqual({ ann: "Annie" });

    act(() => result.current.setNickname("ann", "   "));
    await waitFor(() => expect(result.current.nicknames).toEqual({}));

    act(() => result.current.setNickname("ann", "Annie"));
    await waitFor(() => expect(result.current.nicknames).toEqual({ ann: "Annie" }));
    act(() => result.current.removeContact("ann"));
    await waitFor(() => expect(result.current.nicknames).toEqual({}));
  });

  it("keeps a nickname encrypted on the device and reads it back after a reload", async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.enabled).toBe(true));
    act(() => first.result.current.setNickname("ann", "Annie"));
    await waitFor(() => expect(session.nicknames).not.toBeNull());
    first.unmount();

    expect(JSON.stringify(session.nicknames)).not.toContain("Annie");
    const second = mount();
    await waitFor(() => expect(second.result.current.nicknames).toEqual({ ann: "Annie" }));
  });

  it("limits the length of a nickname", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => result.current.setNickname("ann", "x".repeat(500)));

    await waitFor(() => expect(result.current.nicknames.ann).toHaveLength(50));
  });

  it("ignores the shares message caused by its own action", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() =>
      expect(server.find("shares").length).toBeGreaterThan(0),
    );
    await act(async () => emitStream({ type: "sync" }));
    await waitFor(() => expect(server.find("shares").length).toBe(2));

    await act(async () =>
      emitStream({ type: "spaces", originClientId: CLIENT_ID }),
    );
    await act(async () =>
      emitStream({ type: "spaces", originClientId: "other1" }),
    );

    await waitFor(() => expect(server.find("shares").length).toBe(3));
  });

  it("sends the client id with share changes", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const paths: string[] = [];
    session.del = async (path: string) => {
      paths.push(path);
      return { success: true };
    };

    await act(() => result.current.deleteSpace("s"));

    expect(paths).toEqual([`shares/spaces/s?c=${CLIENT_ID}`]);
  });

  it("does not ask the server again when a contact is pinned", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() =>
      expect(server.find("shares").length).toBeGreaterThan(0),
    );
    const before = server.find("shares").length;

    act(() =>
      result.current.pinContact({
        uuid: "u",
        email: "u@example.com",
        publicKey: "key-1",
      }),
    );
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    expect(server.find("shares")).toHaveLength(before);
  });

  it("calls the server for membership changes and refreshes", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.setPermission("s", "u", "read");
      await result.current.removeMember("s", "u");
      await result.current.deleteSpace("s");
      await result.current.respondToInvite("s", true);
      await result.current.respondToInvite("s", false);
    });

    expect(server.find("shares/members/permission")[0].body).toEqual({
      space: "s",
      user: "u",
      permission: "read",
    });
    expect(server.find("shares/members/s/u")).toHaveLength(1);
    expect(server.find("shares/spaces/s")).toHaveLength(1);
    expect(server.find("shares/members/accept")[0].body).toEqual({
      space: "s",
    });
    expect(server.find("shares/members/decline")[0].body).toEqual({
      space: "s",
    });
  });

  it("tells the user when a membership change fails and does not refresh", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() =>
      expect(server.find("shares").length).toBeGreaterThan(0),
    );
    const before = server.find("shares").length;
    session.del = async () => ({ success: false });

    let removed = true;
    await act(async () => {
      removed = await result.current.removeMember("s", "u");
    });

    expect(removed).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(t("serverErrors.internal_error"));
    expect(server.find("shares")).toHaveLength(before);
  });

  it("wraps the key again for a person added later", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const raw = generateSpaceKey();
    const friend = await generateKeyPair();
    const keys = await import("../../src/lib/shareCrypto.ts").then((m) =>
      m.deriveSpaceKeys(raw),
    );

    await act(async () => {
      await result.current.addMember(
        {
          id: "s",
          kind: "journal",
          scope: "collection",
          target: null,
          members: [],
          raw,
          keys,
        },
        {
          uuid: "friend",
          email: "friend@example.com",
          publicKey: arrayBufferToBase64(friend.publicKey.buffer),
        },
        "read",
      );
    });

    expect(session.contacts.friend).toBeDefined();
    const [{ body }] = server.find("shares/members/add") as {
      body: { wrappedKey: string };
    }[];
    const opened = await import("../../src/lib/shareCrypto.ts").then((m) =>
      m.unwrapSpaceKey(
        body.wrappedKey,
        friend.privateKey,
        result.current.publicKey!,
        "s",
      ),
    );
    expect(Array.from(opened)).toEqual(Array.from(raw));
  });
});

describe("contacts", () => {
  it("tells new, known and changed keys apart", async () => {
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const contact = { uuid: "u", email: "u@example.com", publicKey: "key-1" };

    expect(result.current.trustOf(contact)).toBe("new");
    act(() => result.current.pinContact(contact));
    rerender();
    expect(result.current.trustOf(contact)).toBe("same");
    expect(result.current.trustOf({ ...contact, publicKey: "key-2" })).toBe(
      "changed",
    );
    expect(result.current.trustOf({ ...contact, uuid: "other" })).toBe("new");
  });

  it("remembers the email of a pinned person, encrypted", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const contact = { uuid: "u", email: "u@example.com", publicKey: "key-1" };

    act(() => result.current.pinContact(contact));

    await waitFor(() => expect(session.contactEmails).not.toBeNull());
    expect(JSON.stringify(session.contactEmails)).not.toContain(
      "u@example.com",
    );
    expect(result.current.contacts).toEqual([{ ...contact, removable: true }]);
  });

  it("keeps every person pinned in quick succession", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let calls = 0;
    const slowFirst = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockImplementation(async (...args: Parameters<typeof encrypt>) => {
        if (calls++ === 0) await new Promise((r) => setTimeout(r, 50));
        return encrypt(...args);
      });

    act(() => {
      result.current.pinContact({
        uuid: "a",
        email: "a@example.com",
        publicKey: "key-a",
      });
      result.current.pinContact({
        uuid: "b",
        email: "b@example.com",
        publicKey: "key-b",
      });
    });

    try {
      await new Promise((r) => setTimeout(r, 200));
      const book = await decryptJson<Record<string, string>>(
        session.contactEmails as never,
        session.masterKey!,
      );
      expect(book).toEqual({ a: "a@example.com", b: "b@example.com" });
    } finally {
      slowFirst.mockRestore();
    }
  });

  it("brings back remembered contacts after a restart", async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.enabled).toBe(true));
    act(() =>
      first.result.current.pinContact({
        uuid: "u",
        email: "u@example.com",
        publicKey: "key-1",
      }),
    );
    await waitFor(() => expect(session.contactEmails).not.toBeNull());
    first.unmount();

    const second = mount();
    await waitFor(() =>
      expect(second.result.current.contacts).toEqual([
        {
          uuid: "u",
          email: "u@example.com",
          publicKey: "key-1",
          removable: true,
        },
      ]),
    );
  });

  it("forgets a contact, key and email", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    act(() =>
      result.current.pinContact({
        uuid: "u",
        email: "u@example.com",
        publicKey: "key-1",
      }),
    );
    act(() =>
      result.current.pinContact({
        uuid: "v",
        email: "v@example.com",
        publicKey: "key-2",
      }),
    );
    await waitFor(() => expect(result.current.contacts).toHaveLength(2));

    act(() => result.current.removeContact("u"));

    await waitFor(() =>
      expect(result.current.contacts.map((c) => c.uuid)).toEqual(["v"]),
    );
    expect(session.contacts).toEqual({ v: "key-2" });
    expect(
      result.current.trustOf({
        uuid: "u",
        email: "u@example.com",
        publicKey: "key-1",
      }),
    ).toBe("new");
  });

  it("lists people from shares and remembered ones once each", async () => {
    session.contacts = { u: "key-1", v: "key-2" };
    server.list = {
      owned: [
        {
          id: "s",
          kind: "journal",
          scope: "collection",
          ownerKey: await wrapSpaceKeyForOwner(
            new TextEncoder().encode(
              JSON.stringify({
                key: arrayBufferToBase64(generateSpaceKey().buffer),
                target: null,
                space: "s",
              }),
            ),
            session.masterKey!,
          ),
          keyVersion: 1,
          members: [
            {
              user: "u",
              email: "u@example.com",
              publicKey: "key-1",
              permission: "read",
              status: "accepted",
            },
          ],
        },
      ],
      received: [],
    };
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    act(() =>
      result.current.pinContact({
        uuid: "v",
        email: "v@example.com",
        publicKey: "key-2",
      }),
    );
    act(() =>
      result.current.pinContact({
        uuid: "u",
        email: "u@example.com",
        publicKey: "key-1",
      }),
    );
    await act(() => result.current.refresh());

    await waitFor(() =>
      expect(
        result.current.contacts.map((c) => [c.uuid, c.removable]).toSorted(),
      ).toEqual([
        ["u", false],
        ["v", true],
      ]),
    );
  });

  it("looks a person up by email", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    server.lookups.set("a@example.com", { uuid: "a", publicKey: "k" });

    expect(await result.current.lookupContact("a@example.com")).toEqual({
      uuid: "a",
      email: "a@example.com",
      publicKey: "k",
    });
    expect(await result.current.lookupContact("nobody@example.com")).toBeNull();
    expect(await result.current.lookupContact("me@example.com")).toBe("self");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("tells a failed lookup apart from an unknown person", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    server.lookupFails = true;

    expect(await result.current.lookupContact("a@example.com")).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(t("serverErrors.internal_error"));
  });
});
