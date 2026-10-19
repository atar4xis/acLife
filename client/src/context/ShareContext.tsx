import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";
import { pruneSharedCaches } from "@/lib/sharedCache";
import { t } from "@/i18n";
import { decryptJson, encryptJson } from "@/lib/crypt";
import { createSerialQueue } from "@/lib/serialQueue";
import { withClient } from "@/lib/clientId";
import { MAX_NICKNAME_LENGTH } from "@/lib/constants";
import { isOwnMessage, onStream } from "@/lib/stream";
import { isSubscriptionMissing } from "@/lib/subscription";
import {
  type SpaceKeys,
  deriveSpaceKeys,
  generateKeyPair,
  generateSpaceKey,
  unwrapPrivateKey,
  unwrapSpaceKey,
  unwrapSpaceKeyForOwner,
  wrapPrivateKey,
  wrapSpaceKey,
  wrapSpaceKeyForOwner,
} from "@/lib/shareCrypto";
import { bytesToBase64, uint8ArrayFromBase64 } from "@/lib/utils";
import type { WithChildren } from "@/types/Props";
import type {
  Contact,
  JoinedSpace,
  OwnedSpace,
  Permission,
  ReceivedShare,
  SavedContact,
  ShareListWire,
  SpaceKind,
  SpaceScope,
  Trust,
} from "@/types/Share";
import { toast } from "sonner";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

type ShareRequest = {
  kind: SpaceKind;
  scope: SpaceScope;
  target: string | null | (() => string);
  label: string;
};

type StoredKeys = { publicKey: string; wrappedPrivate: string };

type ShareContextValue = {
  enabled: boolean;
  loaded: boolean;
  owned: OwnedSpace[];
  joined: JoinedSpace[];
  invites: ReceivedShare[];
  contacts: SavedContact[];
  nicknames: Record<string, string>;
  nameOf: (uuid: string, email: string) => string;
  setNickname: (uuid: string, nickname: string) => void;
  publicKey: string | null;
  shareRequest: ShareRequest | null;
  openShare: (request: ShareRequest) => void;
  closeShare: () => void;
  refresh: () => Promise<void>;
  lookupContact: (
    email: string,
  ) => Promise<Contact | "self" | null | undefined>;
  trustOf: (contact: Contact) => Trust;
  pinContact: (contact: Contact) => void;
  removeContact: (uuid: string) => void;
  createShare: (args: {
    kind: SpaceKind;
    scope: SpaceScope;
    target: string | null;
    contact: Contact;
    permission: Permission;
  }) => Promise<string | null>;
  addMember: (
    space: OwnedSpace,
    contact: Contact,
    permission: Permission,
  ) => Promise<boolean>;
  setPermission: (
    space: string,
    user: string,
    permission: Permission,
  ) => Promise<boolean>;
  removeMember: (space: string, user: string) => Promise<boolean>;
  deleteSpace: (space: string) => Promise<boolean>;
  respondToInvite: (space: string, accept: boolean) => Promise<boolean>;
};

const DEFAULT_SHARE_CONTEXT: ShareContextValue = {
  enabled: false,
  loaded: true,
  owned: [],
  joined: [],
  invites: [],
  contacts: [],
  nicknames: {},
  nameOf: (_, email) => email,
  setNickname: () => {},
  publicKey: null,
  shareRequest: null,
  openShare: () => {},
  closeShare: () => {},
  refresh: async () => {},
  lookupContact: async () => null,
  trustOf: () => "new",
  pinContact: () => {},
  removeContact: () => {},
  createShare: async () => null,
  addMember: async () => false,
  setPermission: async () => false,
  removeMember: async () => false,
  deleteSpace: async () => false,
  respondToInvite: async () => false,
};

const ShareContext = createContext(DEFAULT_SHARE_CONTEXT);

type OpenedSpaceKey = { raw: Uint8Array<ArrayBuffer>; target: string | null };

type DerivedSpace = OpenedSpaceKey & { keys: SpaceKeys };

const toastFailure = (res: { message?: string }) =>
  toast.error(res.message || t("serverErrors.internal_error"));

const succeededOrGone = (res: { success: boolean; code?: string }) =>
  res.success ||
  res.code === "share_not_found" ||
  res.code === "user_not_found";

const decodeOwnerKey = async (
  ownerKey: string,
  space: string,
  masterKey: CryptoKey,
) => {
  const bytes = await unwrapSpaceKeyForOwner(ownerKey, masterKey);
  const opened = JSON.parse(new TextDecoder().decode(bytes)) as {
    key: string;
    target: string | null;
    space: string;
  };
  if (opened.space !== space)
    throw new Error("Owner key belongs to another share.");

  return { raw: uint8ArrayFromBase64(opened.key), target: opened.target };
};

const encodeOwnerKey = (
  raw: Uint8Array<ArrayBuffer>,
  target: string | null,
  space: string,
  masterKey: CryptoKey,
) =>
  wrapSpaceKeyForOwner(
    new TextEncoder().encode(
      JSON.stringify({ key: bytesToBase64(raw), target, space }),
    ),
    masterKey,
  );

async function loadKeyPair(
  get: <T>(endpoint: string) => Promise<{ success: boolean; data?: T }>,
  post: (endpoint: string, body: unknown) => Promise<unknown>,
  masterKey: CryptoKey,
) {
  const stored = await get<StoredKeys | null>("user/keys");
  if (!stored.success) return null;
  if (stored.data) return openKeyPair(stored.data, masterKey);

  const pair = await generateKeyPair();
  await post("user/keys", {
    publicKey: bytesToBase64(pair.publicKey),
    wrappedPrivate: await wrapPrivateKey(pair.privateKey, masterKey),
  });

  // two clients can race to create the pair, so use whichever the server kept
  const winner = await get<StoredKeys>("user/keys");
  return winner.data ? openKeyPair(winner.data, masterKey) : null;
}

const openKeyPair = async (stored: StoredKeys, masterKey: CryptoKey) => ({
  privateKey: await unwrapPrivateKey(stored.wrappedPrivate, masterKey),
  publicKey: stored.publicKey,
});

function useEncryptedMap(
  key: "contactEmails" | "contactNicknames",
  masterKey: CryptoKey | null,
) {
  const { ready, get, set } = useStorage();
  const [book, setBook] = useState<Record<string, string>>({});
  const ref = useRef<Record<string, string>>({});
  const [queue] = useState(createSerialQueue);
  const stored = useEffectEvent(() => get(key));

  useEffect(() => {
    if (!masterKey || !ready) return;

    let cancelled = false;
    const encrypted = stored();
    (async () => {
      const loaded = encrypted
        ? await decryptJson<Record<string, string>>(encrypted, masterKey).catch(
            () => ({}),
          )
        : {};
      if (cancelled) return;

      ref.current = loaded;
      setBook(loaded);
    })();

    return () => {
      cancelled = true;
      ref.current = {};
      setBook({});
    };
  }, [masterKey, ready]);

  const save = useCallback(
    (next: Record<string, string>) => {
      if (!masterKey) return;

      ref.current = next;
      setBook(next);
      queue(async () => set(key, await encryptJson(next, masterKey)));
    },
    [set, key, masterKey, queue],
  );

  return useMemo(() => ({ book, ref, save }), [book, ref, save]);
}

export function ShareProvider({ children }: WithChildren) {
  const { user, masterKey } = useUser();
  const { get, post, del, serverMeta } = useApi();
  const storage = useStorage();
  const { get: getStored, set: setStored } = storage;
  const enabled =
    user?.type === "online" &&
    !!masterKey &&
    !isSubscriptionMissing(user, serverMeta);

  const [keyPair, setKeyPair] = useState<{
    privateKey: CryptoKey;
    publicKey: string;
  } | null>(null);
  const [owned, setOwned] = useState<OwnedSpace[]>([]);
  const [joined, setJoined] = useState<JoinedSpace[]>([]);
  const [invites, setInvites] = useState<ReceivedShare[]>([]);
  const [listed, setListed] = useState(false);
  const [shareRequest, setShareRequest] = useState<ShareRequest | null>(null);
  const closeShare = useCallback(() => setShareRequest(null), []);

  const contactEmails = useEncryptedMap("contactEmails", masterKey);
  const contactNicknames = useEncryptedMap("contactNicknames", masterKey);
  const derived = useRef(new Map<string, DerivedSpace>());
  const lastSignature = useRef("");
  const refreshTicket = useRef(0);

  const lastList = useRef<ShareListWire | null>(null);

  const applyList = useCallback(
    async (list: ShareListWire, ticket: number) => {
      if (!keyPair || !masterKey) return;

      const pinned = getStored("shareContacts");
      const listSignature = JSON.stringify([list, pinned]);
      if (listSignature === lastSignature.current) return;

      const previous = derived.current;
      const current = new Map<string, DerivedSpace>();
      const deriveOnce = async (
        material: string,
        open: () => Promise<OpenedSpaceKey>,
      ) => {
        const known = previous.get(material) ?? current.get(material);
        if (known) {
          current.set(material, known);
          return known;
        }

        const opened = await open();
        const next = { ...opened, keys: await deriveSpaceKeys(opened.raw) };
        current.set(material, next);
        return next;
      };

      const nextOwned = (
        await Promise.all(
          list.owned.map(async (share): Promise<OwnedSpace | null> => {
            try {
              const { raw, target, keys } = await deriveOnce(
                share.id + share.ownerKey,
                () => decodeOwnerKey(share.ownerKey, share.id, masterKey),
              );
              return {
                id: share.id,
                kind: share.kind,
                scope: share.scope,
                target,
                members: share.members,
                raw,
                keys,
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter((space): space is OwnedSpace => space !== null);

      // a share whose owner key differs from the pin is not joined, cutChanged leaves it on the next refresh
      const accepted = list.received.filter(
        (s) =>
          s.status === "accepted" &&
          (pinned[s.owner] ?? s.ownerPublicKey) === s.ownerPublicKey,
      );
      const nextJoined = (
        await Promise.all(
          accepted.map(async (share): Promise<JoinedSpace | null> => {
            try {
              const { keys } = await deriveOnce(
                share.id + share.wrappedKey + share.ownerPublicKey,
                async () => ({
                  raw: await unwrapSpaceKey(
                    share.wrappedKey,
                    keyPair.privateKey,
                    share.ownerPublicKey,
                    share.id,
                  ),
                  target: null,
                }),
              );
              return {
                id: share.id,
                owner: share.owner,
                ownerEmail: share.ownerEmail,
                ownerPublicKey: share.ownerPublicKey,
                kind: share.kind,
                scope: share.scope,
                permission: share.permission,
                keys,
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter((space): space is JoinedSpace => space !== null);

      if (ticket !== refreshTicket.current) return;

      derived.current = current;
      lastSignature.current = listSignature;
      const spaces = [...list.owned, ...list.received].map((s) => s.id);
      pruneSharedCaches(new Set(spaces)).catch(() => {});
      for (const key of ["journalLastSynced", "sharedJournals"] as const) {
        const stored = getStored(key);
        const kept = Object.entries(stored).filter(([id]) =>
          spaces.includes(id),
        );
        if (kept.length < Object.keys(stored).length)
          setStored(key, Object.fromEntries(kept));
      }
      setOwned(nextOwned);
      setJoined(nextJoined);
      setInvites(list.received.filter((s) => s.status === "pending"));
    },
    [keyPair, masterKey, getStored, setStored],
  );

  const forgetContacts = useCallback(
    (uuids: string[]) => {
      const without = <T,>(record: Record<string, T>) =>
        Object.fromEntries(
          Object.entries(record).filter(([id]) => !uuids.includes(id)),
        );

      storage.set("shareContacts", without(storage.get("shareContacts")));
      contactEmails.save(without(contactEmails.ref.current));
      contactNicknames.save(without(contactNicknames.ref.current));
    },
    [storage, contactEmails, contactNicknames],
  );

  const removeContact = useCallback(
    (uuid: string) => forgetContacts([uuid]),
    [forgetContacts],
  );

  // a changed key ends the share and every tie to that person
  const cutChanged = useCallback(
    async (list: ShareListWire) => {
      if (user?.type !== "online") return false;

      const pinned = getStored("shareContacts");
      const changed = (uuid: string, key: string) =>
        !!pinned[uuid] && !!key && pinned[uuid] !== key;

      const pendingCuts = [
        ...list.received
          .filter((s) => changed(s.owner, s.ownerPublicKey))
          .map((s) => ({ space: s.id, user: user.uuid, person: s.owner })),
        ...list.owned.flatMap((space) =>
          space.members
            .filter((m) => changed(m.user, m.publicKey))
            .map((m) => ({ space: space.id, user: m.user, person: m.user })),
        ),
      ];
      if (pendingCuts.length === 0) return false;

      const results = await Promise.all(
        pendingCuts.map(({ space, user: member }) =>
          del(withClient(`shares/members/${space}/${member}`)),
        ),
      );
      const failed = new Set(
        pendingCuts
          .filter((_, i) => !succeededOrGone(results[i]))
          .map(({ person }) => person),
      );
      forgetContacts(
        pendingCuts
          .map(({ person }) => person)
          .filter((person) => !failed.has(person)),
      );
      return true;
    },
    [getStored, user, del, forgetContacts],
  );

  const refresh = useCallback(async () => {
    if (!keyPair || !masterKey) return;

    const ticket = ++refreshTicket.current;
    let res = await get<ShareListWire>("shares");
    setListed(true);
    if (!res.success || !res.data) return;

    if (await cutChanged(res.data)) {
      res = await get<ShareListWire>("shares");
      if (!res.success || !res.data) return;
    }

    if (ticket !== refreshTicket.current) return;

    lastList.current = res.data;
    await applyList(res.data, ticket);
  }, [keyPair, masterKey, get, applyList, cutChanged]);

  const setupKeyPair = useEffectEvent(async () => {
    if (!enabled || !masterKey) return null;
    try {
      return await loadKeyPair(get, post, masterKey);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let current = true;
    setupKeyPair().then((pair) => {
      if (!current) return;

      setKeyPair(pair);
      if (!pair) setListed(true);
    });
    return () => {
      current = false;
      derived.current = new Map();
      lastSignature.current = "";
      lastList.current = null;
      setKeyPair(null);
      setOwned([]);
      setJoined([]);
      setInvites([]);
      setListed(false);
    };
  }, [enabled, masterKey]);

  const pullShares = useEffectEvent(() => refresh());

  useEffect(() => {
    if (!keyPair) return;

    const stops = [
      onStream("spaces", (message) => {
        if (!isOwnMessage(message)) pullShares();
      }),
      onStream("sync", pullShares),
    ];
    return () => stops.forEach((stop) => stop());
  }, [keyPair]);

  // pinning or unpinning a key changes which shares are trusted, so derive the list again
  const pinnedKeys = storage.get("shareContacts");
  const reapply = useEffectEvent(() => {
    if (lastList.current) applyList(lastList.current, refreshTicket.current);
    else pullShares();
  });

  useEffect(() => {
    if (keyPair) reapply();
  }, [keyPair, pinnedKeys]);

  const contacts = useMemo(() => {
    const fromShares = [
      ...owned.flatMap((space) =>
        space.members.map((m) => ({
          uuid: m.user,
          email: m.email,
          publicKey: m.publicKey,
        })),
      ),
      ...joined.map((space) => ({
        uuid: space.owner,
        email: space.ownerEmail,
        publicKey: space.ownerPublicKey,
      })),
    ];
    const saved = Object.entries(contactEmails.book).flatMap(([uuid, email]) =>
      pinnedKeys[uuid] ? [{ uuid, email, publicKey: pinnedKeys[uuid] }] : [],
    );
    // contacts that appear in a share cannot be removed on their own
    const shared = new Set(fromShares.map((contact) => contact.uuid));

    return [...fromShares, ...saved]
      .filter(
        (contact, i, all) =>
          all.findIndex((c) => c.uuid === contact.uuid) === i,
      )
      .map((contact) => ({ ...contact, removable: !shared.has(contact.uuid) }));
  }, [owned, joined, contactEmails.book, pinnedKeys]);

  const lookupContact = useCallback(
    async (email: string) => {
      const res = await post<Omit<Contact, "email">>("user/keys/lookup", {
        email,
      });
      if (res.success && res.data) return { ...res.data, email };
      if (res.code === "user_not_found") return null;
      if (res.code === "self") return "self";

      toast.error(t("serverErrors.internal_error"));
      return undefined;
    },
    [post],
  );

  const trustOf = useCallback(
    (contact: Contact): Trust => {
      const pinned = pinnedKeys[contact.uuid];
      if (!pinned) return "new";
      return pinned === contact.publicKey ? "same" : "changed";
    },
    [pinnedKeys],
  );

  const pinContact = useCallback(
    (contact: Contact) => {
      storage.set("shareContacts", {
        ...storage.get("shareContacts"),
        [contact.uuid]: contact.publicKey,
      });
      contactEmails.save({
        ...contactEmails.ref.current,
        [contact.uuid]: contact.email,
      });
    },
    [storage, contactEmails],
  );

  const nameOf = useCallback(
    (uuid: string, email: string) => contactNicknames.book[uuid] || email,
    [contactNicknames.book],
  );

  const setNickname = useCallback(
    (uuid: string, nickname: string) => {
      const next = { ...contactNicknames.ref.current };
      const trimmed = nickname.trim().slice(0, MAX_NICKNAME_LENGTH);
      if (trimmed) next[uuid] = trimmed;
      else delete next[uuid];
      contactNicknames.save(next);
    },
    [contactNicknames],
  );

  const runThenRefresh = useCallback(
    async (request: () => Promise<{ success: boolean; message?: string }>) => {
      const res = await request();
      if (!res.success) {
        toastFailure(res);
        return false;
      }

      await refresh();
      return true;
    },
    [refresh],
  );

  const createShare = useCallback<ShareContextValue["createShare"]>(
    async ({ kind, scope, target, contact, permission }) => {
      if (!masterKey || !keyPair) return null;

      const id = crypto.randomUUID();
      const raw = generateSpaceKey();
      const res = await post<{ id: string }>(withClient("shares/spaces"), {
        id,
        kind,
        scope,
        ownerKey: await encodeOwnerKey(raw, target, id, masterKey),
        members: [
          {
            user: contact.uuid,
            permission,
            wrappedKey: await wrapSpaceKey(
              raw,
              keyPair.privateKey,
              contact.publicKey,
              id,
            ),
          },
        ],
      });
      if (!res.success) {
        toastFailure(res);
        return null;
      }

      // inviting someone trusts the key that was just shown
      pinContact(contact);
      await refresh();
      return id;
    },
    [masterKey, keyPair, post, pinContact, refresh],
  );

  const addMember = useCallback<ShareContextValue["addMember"]>(
    async (space, contact, permission) => {
      if (!keyPair) return false;

      const res = await post(withClient("shares/members/add"), {
        space: space.id,
        user: contact.uuid,
        permission,
        wrappedKey: await wrapSpaceKey(
          space.raw,
          keyPair.privateKey,
          contact.publicKey,
          space.id,
        ),
      });
      if (!res.success) {
        toastFailure(res);
        return false;
      }

      pinContact(contact);
      await refresh();
      return true;
    },
    [keyPair, post, pinContact, refresh],
  );

  const setPermission = useCallback<ShareContextValue["setPermission"]>(
    (space, userId, permission) =>
      runThenRefresh(() =>
        post(withClient("shares/members/permission"), {
          space,
          user: userId,
          permission,
        }),
      ),
    [runThenRefresh, post],
  );

  const removeMember = useCallback<ShareContextValue["removeMember"]>(
    (space, userId) =>
      runThenRefresh(() =>
        del(withClient(`shares/members/${space}/${userId}`)),
      ),
    [runThenRefresh, del],
  );

  const deleteSpace = useCallback<ShareContextValue["deleteSpace"]>(
    (space) =>
      runThenRefresh(async () => {
        const res = await del(withClient(`shares/spaces/${space}`));
        return succeededOrGone(res) ? { success: true } : res;
      }),
    [runThenRefresh, del],
  );

  const respondToInvite = useCallback<ShareContextValue["respondToInvite"]>(
    (space, accept) =>
      runThenRefresh(() =>
        post(withClient(`shares/members/${accept ? "accept" : "decline"}`), {
          space,
        }),
      ),
    [runThenRefresh, post],
  );

  const value = useMemo<ShareContextValue>(
    () => ({
      enabled: !!keyPair,
      loaded: !enabled || listed,
      owned,
      joined,
      invites,
      contacts,
      nicknames: contactNicknames.book,
      nameOf,
      setNickname,
      publicKey: keyPair?.publicKey ?? null,
      shareRequest,
      openShare: setShareRequest,
      closeShare,
      refresh,
      lookupContact,
      trustOf,
      pinContact,
      removeContact,
      createShare,
      addMember,
      setPermission,
      removeMember,
      deleteSpace,
      respondToInvite,
    }),
    [
      keyPair,
      enabled,
      listed,
      owned,
      joined,
      invites,
      contacts,
      contactNicknames.book,
      nameOf,
      setNickname,
      shareRequest,
      closeShare,
      refresh,
      lookupContact,
      trustOf,
      pinContact,
      removeContact,
      createShare,
      addMember,
      setPermission,
      removeMember,
      deleteSpace,
      respondToInvite,
    ],
  );

  return (
    <ShareContext.Provider value={value}>{children}</ShareContext.Provider>
  );
}

// eslint-disable-next-line
export function useShares() {
  return useContext(ShareContext);
}
