import type { EncryptedRecord, SyncDiff } from "@/types/Sync";

export type JournalItem = {
  id: string;
  parentId: string | null;
  type: "folder" | "note";
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type JournalSort =
  | "name-asc"
  | "name-desc"
  | "modified-desc"
  | "modified-asc"
  | "created-desc"
  | "created-asc";

export type JournalData = {
  items: JournalItem[];
  sort: JournalSort;
};

export type JournalTreeNode = {
  item: JournalItem;
  children: JournalTreeNode[];
};

export type PaneNode = {
  kind: "pane";
  id: string;
  tabs: string[];
  active: string | null;
  reading?: boolean;
};

type SplitNode = {
  kind: "split";
  id: string;
  direction: "row" | "column";
  children: LayoutNode[];
};

export type LayoutNode = PaneNode | SplitNode;

export type Workspace = {
  layout: LayoutNode;
  focused: string;
};

export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export type JournalDrag = {
  id: string;
  fromPane?: string;
};

export type JournalLayoutState = {
  workspace: Workspace;
  splitSizes: Record<string, number[]>;
  expanded: string[];
};

export type JournalState = JournalData & {
  workspace: Workspace;
  expanded: ReadonlySet<string>;
  splitSizes: Record<string, number[]>;
};

export type JournalAction =
  | { type: "hydrate"; state: Partial<JournalState> }
  | {
      type: "addItem";
      id: string;
      kind: JournalItem["type"];
      name: string;
      parentId: string | null;
      now: number;
    }
  | { type: "renameItem"; id: string; name: string; now: number }
  | { type: "setContent"; id: string; content: string; now: number }
  | { type: "moveItem"; id: string; parentId: string | null; now: number }
  | { type: "removeItem"; id: string }
  | { type: "applyRemote"; upserts: JournalItem[]; deletedIds: string[] }
  | { type: "setSort"; sort: JournalSort }
  | { type: "toggleFolder"; id: string }
  | { type: "setAllExpanded"; expanded: boolean }
  | { type: "setSplitSizes"; key: string; sizes: number[] }
  | { type: "setReading"; paneId: string; reading: boolean }
  | { type: "addTab"; paneId: string }
  | { type: "openNote"; id: string; newTab: boolean }
  | { type: "activateTab"; paneId: string; id: string }
  | { type: "closeTab"; paneId: string; id: string }
  | { type: "focusPane"; paneId: string }
  | { type: "dropOnPane"; drag: JournalDrag; paneId: string; zone: DropZone }
  | { type: "dropOnTabs"; drag: JournalDrag; paneId: string; index: number };

export type JournalHashResponse = {
  match: boolean;
  table?: string;
};

export type JournalSyncResponse = SyncDiff<EncryptedRecord> & {
  remaining: string[];
};
