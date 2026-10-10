import { DEFAULT_JOURNAL, descendantIds } from "@/lib/journal/item";
import {
  activateTab,
  addNewTab,
  closeNotes,
  closeTab,
  createWorkspace,
  dropOnPane,
  dropOnTabs,
  openNote,
  setReading,
} from "@/lib/journal/layout";
import type { JournalAction, JournalItem, JournalState } from "@/types/Journal";

export const createJournalState = (): JournalState => ({
  ...DEFAULT_JOURNAL,
  workspace: createWorkspace(),
  expanded: new Set(),
  splitSizes: {},
});

const updateItem = (
  state: JournalState,
  id: string,
  changes: Partial<JournalItem>,
): JournalState => ({
  ...state,
  items: state.items.map((item) =>
    item.id === id ? { ...item, ...changes } : item,
  ),
});

const expand = (state: JournalState, id: string | null) =>
  id ? new Set(state.expanded).add(id) : state.expanded;

const closeItems = (state: JournalState, removed: ReadonlySet<string>) => ({
  expanded: new Set(
    Array.from(state.expanded).filter((id) => !removed.has(id)),
  ),
  workspace: closeNotes(state.workspace, Array.from(removed)),
});

export function journalReducer(
  state: JournalState,
  action: JournalAction,
): JournalState {
  switch (action.type) {
    case "hydrate":
      return { ...state, ...action.state };
    case "addItem":
      return {
        ...state,
        items: [
          ...state.items,
          {
            id: action.id,
            parentId: action.parentId,
            type: action.kind,
            name: action.name,
            content: "",
            createdAt: action.now,
            updatedAt: action.now,
          },
        ],
        expanded: expand(state, action.parentId),
      };
    case "renameItem":
      return updateItem(state, action.id, {
        name: action.name,
        updatedAt: action.now,
      });
    case "setContent":
      return updateItem(state, action.id, {
        content: action.content,
        updatedAt: action.now,
      });
    case "moveItem":
      return {
        ...updateItem(state, action.id, {
          parentId: action.parentId,
          updatedAt: action.now,
        }),
        expanded: expand(state, action.parentId),
      };
    case "removeItem": {
      const removed = new Set(descendantIds(state.items, action.id));
      return {
        ...state,
        items: state.items.filter((item) => !removed.has(item.id)),
        ...closeItems(state, removed),
      };
    }
    case "applyRemote": {
      const upserts = new Map(action.upserts.map((item) => [item.id, item]));
      const removed = new Set(action.deletedIds);
      const known = new Set(state.items.map((item) => item.id));
      return {
        ...state,
        items: [
          ...state.items
            .filter((item) => !removed.has(item.id))
            .map((item) => {
              const remote = upserts.get(item.id);
              return remote && remote.updatedAt > item.updatedAt
                ? remote
                : item;
            }),
          ...action.upserts.filter((item) => !known.has(item.id)),
        ],
        ...(removed.size > 0 && closeItems(state, removed)),
      };
    }
    case "setSort":
      return { ...state, sort: action.sort };
    case "toggleFolder": {
      const expanded = new Set(state.expanded);
      if (!expanded.delete(action.id)) expanded.add(action.id);
      return { ...state, expanded };
    }
    case "setAllExpanded":
      return {
        ...state,
        expanded: new Set(
          action.expanded
            ? state.items
                .filter((item) => item.type === "folder")
                .map((item) => item.id)
            : [],
        ),
      };
    case "setSplitSizes":
      return {
        ...state,
        splitSizes: { ...state.splitSizes, [action.key]: action.sizes },
      };
    case "setReading":
      return {
        ...state,
        workspace: setReading(state.workspace, action.paneId, action.reading),
      };
    case "addTab":
      return { ...state, workspace: addNewTab(state.workspace, action.paneId) };
    case "openNote":
      return {
        ...state,
        workspace: openNote(state.workspace, action.id, action.newTab),
      };
    case "activateTab":
      return {
        ...state,
        workspace: activateTab(state.workspace, action.paneId, action.id),
      };
    case "closeTab":
      return {
        ...state,
        workspace: closeTab(state.workspace, action.paneId, action.id),
      };
    case "focusPane":
      return state.workspace.focused === action.paneId
        ? state
        : {
            ...state,
            workspace: { ...state.workspace, focused: action.paneId },
          };
    case "dropOnPane":
      return {
        ...state,
        workspace: dropOnPane(
          state.workspace,
          action.drag,
          action.paneId,
          action.zone,
        ),
      };
    case "dropOnTabs":
      return {
        ...state,
        workspace: dropOnTabs(
          state.workspace,
          action.drag,
          action.paneId,
          action.index,
        ),
      };
  }
}
