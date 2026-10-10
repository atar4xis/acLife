import type {
  JournalData,
  JournalItem,
  JournalSort,
  JournalTreeNode,
} from "@/types/Journal";

export const JOURNAL_SORT_GROUPS: JournalSort[][] = [
  ["name-asc", "name-desc"],
  ["modified-desc", "modified-asc"],
  ["created-desc", "created-asc"],
];

export const DEFAULT_JOURNAL: JournalData = {
  items: [],
  sort: "name-asc",
};

const compare = (sort: JournalSort) => {
  const [field, direction] = sort.split("-");
  const sign = direction === "asc" ? 1 : -1;

  return (a: JournalItem, b: JournalItem) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    if (field === "name")
      return sign * a.name.localeCompare(b.name, undefined, { numeric: true });
    const key = field === "modified" ? "updatedAt" : "createdAt";
    return sign * (a[key] - b[key]);
  };
};

export const buildTree = (
  items: JournalItem[],
  sort: JournalSort,
): JournalTreeNode[] => {
  const nodes = new Map(
    items.map((item) => [item.id, { item, children: [] } as JournalTreeNode]),
  );
  const roots: JournalTreeNode[] = [];

  const inCycle = (item: JournalItem) => {
    const seen = new Set<string>();
    for (
      let current = nodes.get(item.parentId ?? "")?.item;
      current && !seen.has(current.id);
      current = nodes.get(current.parentId ?? "")?.item
    ) {
      if (current.id === item.id) return true;
      seen.add(current.id);
    }
    return false;
  };

  for (const node of nodes.values()) {
    const parent =
      node.item.parentId &&
      !inCycle(node.item) &&
      nodes.get(node.item.parentId);
    (parent ? parent.children : roots).push(node);
  }

  const order = compare(sort);
  const sortLevel = (level: JournalTreeNode[]) => {
    level.sort((a, b) => order(a.item, b.item));
    level.forEach((node) => sortLevel(node.children));
  };
  sortLevel(roots);

  return roots;
};

export const filterTree = (
  nodes: JournalTreeNode[],
  query: string,
): JournalTreeNode[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;

  return nodes.flatMap((node) => {
    const children = filterTree(node.children, needle);
    const matches =
      node.item.name.toLowerCase().includes(needle) ||
      node.item.content.toLowerCase().includes(needle);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
};

export const toOutline = (
  previous: JournalItem[],
  items: JournalItem[],
  byModified: boolean,
): JournalItem[] => {
  const known = new Map(previous.map((item) => [item.id, item]));
  const outline = items.map((item) => {
    const old = known.get(item.id);
    const same =
      old &&
      old.parentId === item.parentId &&
      old.type === item.type &&
      old.name === item.name &&
      old.createdAt === item.createdAt &&
      (!byModified || old.updatedAt === item.updatedAt);
    return same ? old : { ...item, content: "" };
  });
  return outline.length === previous.length &&
    outline.every((item, i) => item === previous[i])
    ? previous
    : outline;
};

export const descendantIds = (items: JournalItem[], id: string): string[] => {
  const found = [id];
  for (const current of found) {
    for (const item of items) {
      if (item.parentId === current && !found.includes(item.id))
        found.push(item.id);
    }
  }
  return found;
};

export const canMoveItem = (
  items: JournalItem[],
  item: JournalItem,
  parentId: string | null,
) =>
  item.parentId !== parentId &&
  !(parentId && descendantIds(items, item.id).includes(parentId));

export type MoveTarget = { folder: JournalItem | null; depth: number };

export const moveTargets = (
  items: JournalItem[],
  sort: JournalSort,
  item: JournalItem,
): MoveTarget[] => {
  const folders = (nodes: JournalTreeNode[], depth: number): MoveTarget[] =>
    nodes.flatMap(({ item: folder, children }) =>
      folder.type === "folder"
        ? [{ folder, depth }, ...folders(children, depth + 1)]
        : [],
    );

  return [
    { folder: null, depth: 0 },
    ...folders(buildTree(items, sort), 1),
  ].filter(({ folder }) => canMoveItem(items, item, folder?.id ?? null));
};

export type TreeRow = { item: JournalItem; depth: number; open: boolean };

export const isFolderOpen = (
  item: JournalItem,
  expanded: ReadonlySet<string>,
  searching: boolean,
) => item.type === "folder" && (searching || expanded.has(item.id));

export const visibleRows = (
  nodes: JournalTreeNode[],
  expanded: ReadonlySet<string>,
  searching: boolean,
  depth = 0,
): TreeRow[] =>
  nodes.flatMap(({ item, children }) => {
    const open = isFolderOpen(item, expanded, searching);
    return [
      { item, depth, open },
      ...(open ? visibleRows(children, expanded, searching, depth + 1) : []),
    ];
  });

export const MAX_JOURNAL_NAME_LENGTH = 100;
export const MAX_JOURNAL_CONTENT_LENGTH = 128_000;
