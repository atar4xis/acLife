import { t } from "@/i18n";
import { mayDelete, mayWrite } from "@/lib/shareInfo";
import type { JournalItem } from "@/types/Journal";
import type { SharedInfo } from "@/types/Share";

const SHARED_ROOT_PREFIX = "shared:";

export const sharedRootId = (owner: string) => SHARED_ROOT_PREFIX + owner;

export const isOwnItem = (item: JournalItem) => !item._shared && !item._virtual;

export const haveSameItems = (a: JournalItem[], b: JournalItem[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

export const canEditItem = (item: JournalItem) =>
  !item._virtual && mayWrite(item._shared);

export const canDeleteItem = (item: JournalItem) =>
  !item._virtual && mayDelete(item._shared);

export const canCreateIn = (parent: JournalItem | undefined) =>
  !parent || (!parent._virtual && canDeleteItem(parent));

export const canMoveInto = (item: JournalItem, parent: JournalItem | null) => {
  if (!canDeleteItem(item)) return false;
  if (!item._shared) return !parent?._shared && !parent?._virtual;
  return parent?._shared?.space === item._shared.space;
};

export const coveredItems = (
  items: JournalItem[],
  target: string | null,
  scope: "item" | "collection",
) => {
  const own = items.filter(isOwnItem);
  if (target === null) return own;

  const covered = new Set([target]);
  if (scope === "collection") {
    const children = Map.groupBy(own, (item) => item.parentId);
    for (const id of covered)
      for (const child of children.get(id) ?? []) covered.add(child.id);
  }
  return own.filter((item) => covered.has(item.id));
};

export const admitMirrored = (
  items: JournalItem[],
  target: string | null,
  scope: "item" | "collection",
  incoming: JournalItem[],
) => {
  const own = new Map(items.filter(isOwnItem).map((item) => [item.id, item]));
  const foreignIds = new Set(
    items.filter((item) => !isOwnItem(item)).map((item) => item.id),
  );
  const admittedIds = new Set(
    coveredItems(Array.from(own.values()), target, scope).map(
      (item) => item.id,
    ),
  );
  const coveredIds = new Set(admittedIds);

  const isAdmissible = (item: JournalItem) => {
    if (foreignIds.has(item.id)) return false;

    const local = own.get(item.id);
    if (local) {
      return (
        coveredIds.has(item.id) &&
        (item.parentId === local.parentId ||
          (item.parentId !== null && admittedIds.has(item.parentId)))
      );
    }
    if (scope === "item") return false;
    return item.parentId === null
      ? target === null
      : admittedIds.has(item.parentId);
  };

  const admitted: JournalItem[] = [];
  let remaining = incoming;
  let progressed = true;
  // admitting an item can make its children admissible, so repeat until nothing new gets in
  while (progressed) {
    const accepted = remaining.filter(isAdmissible);
    progressed = accepted.length > 0;
    for (const item of accepted) admittedIds.add(item.id);
    admitted.push(...accepted);
    remaining = remaining.filter((item) => !admittedIds.has(item.id));
  }
  return admitted;
};

export const admitJoined = (
  items: JournalItem[],
  space: string,
  incoming: JournalItem[],
) => {
  const foreign = new Set(
    items
      .filter((item) => item._shared?.space !== space)
      .map((item) => item.id),
  );
  return incoming.filter((item) => !foreign.has(item.id));
};

export const toSharedItem = (item: JournalItem, info: SharedInfo) => ({
  ...item,
  _shared: info,
});

type TimeSpan = { createdAt: number; updatedAt: number };

const virtualRoot = (
  owner: string,
  name: string,
  span: TimeSpan,
): JournalItem => ({
  id: sharedRootId(owner),
  parentId: null,
  type: "folder",
  name: t("journal.sharedBy", { email: name }),
  content: "",
  createdAt: span.createdAt,
  updatedAt: span.updatedAt,
  icon: "Users",
  _virtual: true,
});

const placedCopies = new WeakMap<JournalItem, Map<string, JournalItem>>();

const withParent = (item: JournalItem, parentId: string) => {
  const cache = placedCopies.get(item) ?? new Map<string, JournalItem>();
  placedCopies.set(item, cache);

  const cached = cache.get(parentId);
  if (cached) return cached;

  const placed = { ...item, parentId };
  cache.set(parentId, placed);
  return placed;
};

// shared items without a shared parent are shown under one folder per owner
export const placeShared = (
  items: JournalItem[],
  names: ReadonlyMap<string, string>,
) => {
  const shared = new Set(
    items.filter((item) => item._shared).map((item) => item.id),
  );
  if (shared.size === 0) return items;

  const owners = new Map<string, TimeSpan>();
  const placed = items.map((item) => {
    if (!item._shared) return item;
    if (item.parentId && shared.has(item.parentId)) return item;

    const span = owners.get(item._shared.owner);
    owners.set(item._shared.owner, {
      createdAt: Math.min(span?.createdAt ?? Infinity, item.createdAt),
      updatedAt: Math.max(span?.updatedAt ?? 0, item.updatedAt),
    });
    return withParent(item, sharedRootId(item._shared.owner));
  });

  const roots = Array.from(owners, ([owner, span]) =>
    virtualRoot(owner, names.get(owner) ?? "", span),
  );
  return [...placed, ...roots];
};
