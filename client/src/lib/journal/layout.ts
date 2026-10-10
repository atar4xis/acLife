import type {
  DropZone,
  JournalDrag,
  LayoutNode,
  PaneNode,
  Workspace,
} from "@/types/Journal";

const EDGE_RATIO = 0.25;
const NEW_TAB_PREFIX = "new:";

export const isNewTab = (id: string) => id.startsWith(NEW_TAB_PREFIX);

const newPane = (tabs: string[] = []): PaneNode => ({
  kind: "pane",
  id: crypto.randomUUID(),
  tabs,
  active: tabs[0] ?? null,
});

export const createWorkspace = (): Workspace => {
  const pane = newPane();
  return { layout: pane, focused: pane.id };
};

export const panesOf = (node: LayoutNode): PaneNode[] =>
  node.kind === "pane" ? [node] : node.children.flatMap(panesOf);

const mapPane = (
  node: LayoutNode,
  id: string,
  fn: (pane: PaneNode) => PaneNode,
): LayoutNode => {
  if (node.kind === "pane") return node.id === id ? fn(node) : node;
  return {
    ...node,
    children: node.children.map((child) => mapPane(child, id, fn)),
  };
};

const mapPanes = (node: LayoutNode, fn: (pane: PaneNode) => PaneNode) =>
  panesOf(node).reduce((acc, pane) => mapPane(acc, pane.id, fn), node);

const prune = (node: LayoutNode): LayoutNode | null => {
  if (node.kind === "pane") return node.tabs.length > 0 ? node : null;

  const children = node.children
    .map(prune)
    .filter((child) => child !== null)
    .flatMap((child) =>
      child.kind === "split" && child.direction === node.direction
        ? child.children
        : [child],
    );
  if (children.length <= 1) return children[0] ?? null;
  return { ...node, children };
};

const settle = (workspace: Workspace, layout: LayoutNode): Workspace => {
  const pruned = prune(layout);
  if (!pruned) return createWorkspace();

  const panes = panesOf(pruned);
  const focused = panes.some((pane) => pane.id === workspace.focused)
    ? workspace.focused
    : panes[0].id;
  return { layout: pruned, focused };
};

export const neighborTab = (tabs: string[], id: string) => {
  const rest = tabs.filter((tab) => tab !== id);
  return rest[Math.min(tabs.indexOf(id), rest.length - 1)];
};

const withoutTab = (pane: PaneNode, id: string): PaneNode => {
  const tabs = pane.tabs.filter((tab) => tab !== id);
  if (pane.active !== id) return { ...pane, tabs };
  return { ...pane, tabs, active: neighborTab(pane.tabs, id) ?? null };
};

const withTab = (pane: PaneNode, id: string, index?: number): PaneNode => {
  if (pane.tabs.includes(id)) return { ...pane, active: id };
  const tabs = pane.tabs.toSpliced(index ?? pane.tabs.length, 0, id);
  return { ...pane, tabs, active: id };
};

export const openNote = (
  workspace: Workspace,
  id: string,
  newTab: boolean,
): Workspace => {
  const panes = panesOf(workspace.layout);
  const existing = panes.find((pane) => pane.tabs.includes(id));
  if (existing) {
    return {
      layout: mapPane(workspace.layout, existing.id, (pane) => ({
        ...pane,
        active: id,
      })),
      focused: existing.id,
    };
  }

  const target = panes.find((pane) => pane.id === workspace.focused)!;
  const layout = mapPane(workspace.layout, target.id, (pane) => {
    if (newTab || !pane.active) return withTab(pane, id);
    return {
      ...pane,
      tabs: pane.tabs.map((tab) => (tab === pane.active ? id : tab)),
      active: id,
    };
  });
  return { layout, focused: target.id };
};

export const addNewTab = (workspace: Workspace, paneId: string): Workspace => ({
  layout: mapPane(workspace.layout, paneId, (pane) =>
    withTab(pane, NEW_TAB_PREFIX + crypto.randomUUID()),
  ),
  focused: paneId,
});

export const activateTab = (
  workspace: Workspace,
  paneId: string,
  id: string,
): Workspace => ({
  layout: mapPane(workspace.layout, paneId, (pane) => ({
    ...pane,
    active: id,
  })),
  focused: paneId,
});

export const closeTab = (
  workspace: Workspace,
  paneId: string,
  id: string,
): Workspace =>
  settle(
    workspace,
    mapPane(workspace.layout, paneId, (pane) => withoutTab(pane, id)),
  );

export const setReading = (
  workspace: Workspace,
  paneId: string,
  reading: boolean,
): Workspace => ({
  ...workspace,
  layout: mapPane(workspace.layout, paneId, (pane) => ({ ...pane, reading })),
});

export const restoreWorkspace = (
  workspace: Workspace,
  exists: (id: string) => boolean,
): Workspace =>
  settle(
    workspace,
    mapPanes(workspace.layout, (pane) => {
      const tabs = pane.tabs.filter((id) => isNewTab(id) || exists(id));
      const active = tabs.includes(pane.active ?? "") ? pane.active : tabs[0];
      return { ...pane, tabs, active: active ?? null };
    }),
  );

export const closeNotes = (workspace: Workspace, ids: string[]): Workspace =>
  settle(
    workspace,
    mapPanes(workspace.layout, (pane) => ids.reduce(withoutTab, pane)),
  );

const wrapPane = (
  node: LayoutNode,
  targetId: string,
  zone: Exclude<DropZone, "center">,
  added: PaneNode,
): LayoutNode => {
  if (node.kind === "split") {
    return {
      ...node,
      children: node.children.map((child) =>
        wrapPane(child, targetId, zone, added),
      ),
    };
  }
  if (node.id !== targetId) return node;

  const before = zone === "left" || zone === "top";
  return {
    kind: "split",
    id: crypto.randomUUID(),
    direction: zone === "left" || zone === "right" ? "row" : "column",
    children: before ? [added, node] : [node, added],
  };
};

const shape = (node: LayoutNode): string =>
  node.kind === "pane"
    ? `[${node.tabs.join()}]`
    : `${node.direction}(${node.children.map(shape).join(" ")})`;

const applyDrop = (
  workspace: Workspace,
  drag: JournalDrag,
  paneId: string,
  zone: DropZone,
): Workspace => {
  let layout = workspace.layout;
  if (drag.fromPane) {
    layout = mapPane(layout, drag.fromPane, (pane) =>
      withoutTab(pane, drag.id),
    );
  }

  let focused = paneId;
  if (zone === "center") {
    layout = mapPane(layout, paneId, (pane) => withTab(pane, drag.id));
  } else {
    const added = newPane([drag.id]);
    layout = wrapPane(layout, paneId, zone, added);
    focused = added.id;
  }
  return settle({ ...workspace, focused }, layout);
};

export const canDrop = (
  workspace: Workspace,
  drag: JournalDrag,
  paneId: string,
  zone: DropZone,
): boolean => {
  if (drag.fromPane === paneId) {
    const pane = panesOf(workspace.layout).find((p) => p.id === paneId);
    return zone !== "center" && (pane?.tabs.length ?? 0) > 1;
  }
  return (
    !drag.fromPane ||
    shape(applyDrop(workspace, drag, paneId, zone).layout) !==
      shape(workspace.layout)
  );
};

export const dropOnPane = (
  workspace: Workspace,
  drag: JournalDrag,
  paneId: string,
  zone: DropZone,
): Workspace =>
  canDrop(workspace, drag, paneId, zone)
    ? applyDrop(workspace, drag, paneId, zone)
    : workspace;

export const dropOnTabs = (
  workspace: Workspace,
  drag: JournalDrag,
  paneId: string,
  index: number,
): Workspace => {
  const pane = panesOf(workspace.layout).find((p) => p.id === paneId)!;
  const from = drag.fromPane === paneId ? pane.tabs.indexOf(drag.id) : -1;
  const at = from !== -1 && from < index ? index - 1 : index;

  let layout = workspace.layout;
  if (drag.fromPane) {
    layout = mapPane(layout, drag.fromPane, (p) => withoutTab(p, drag.id));
  }
  layout = mapPane(layout, paneId, (p) => withTab(p, drag.id, at));
  return settle({ ...workspace, focused: paneId }, layout);
};

export const dropZone = (
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): DropZone => {
  const dx = (x - rect.left) / rect.width;
  const dy = (y - rect.top) / rect.height;
  const edges: [DropZone, number][] = [
    ["left", dx],
    ["right", 1 - dx],
    ["top", dy],
    ["bottom", 1 - dy],
  ];
  const [zone, distance] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
  return distance < EDGE_RATIO ? zone : "center";
};

const SPLIT_ZONES = ["left", "right", "top", "bottom"] as const;

export const moveOptions = (
  workspace: Workspace,
  drag: JournalDrag,
  anchorPane: string,
) => ({
  zones: SPLIT_ZONES.filter((zone) =>
    canDrop(workspace, drag, anchorPane, zone),
  ),
  panes: panesOf(workspace.layout).flatMap((pane, index) =>
    pane.id === drag.fromPane ? [] : [{ id: pane.id, number: index + 1 }],
  ),
});
