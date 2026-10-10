import { t as translate } from "@/i18n";
import { useJournalPersistence } from "@/hooks/journal/useJournalPersistence";
import { useJournalSync } from "@/hooks/journal/useJournalSync";
import { EMPTY_ARRAY } from "@/lib/constants";
import { toOutline } from "@/lib/journal/item";
import { isNewTab } from "@/lib/journal/layout";
import { createJournalState, journalReducer } from "@/reducers/journalReducer";
import type { WithChildren } from "@/types/Props";
import type {
  DropZone,
  JournalDrag,
  JournalItem,
  JournalSort,
  JournalState,
} from "@/types/Journal";
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

type JournalContextValue = JournalState & {
  drag: JournalDrag | null;
  acceptedDrag: JournalDrag | null;
  loadFailed: boolean;
  itemsById: ReadonlyMap<string, JournalItem>;
};

type JournalActions = {
  setSplitSizes: (key: string, sizes: number[]) => void;
  setReading: (paneId: string, reading: boolean) => void;
  setSort: (sort: JournalSort) => void;
  addItem: (type: JournalItem["type"], parentId: string | null) => string;
  addTab: (paneId: string) => void;
  renameItem: (id: string, name: string) => void;
  removeItem: (id: string) => void;
  setContent: (id: string, content: string) => void;
  moveItem: (id: string, parentId: string | null) => void;
  openNote: (id: string, newTab?: boolean) => void;
  activateTab: (paneId: string, id: string) => void;
  closeTab: (paneId: string, id: string) => void;
  focusPane: (paneId: string) => void;
  startDrag: (drag: JournalDrag) => void;
  endDrag: () => void;
  dropOnPane: (paneId: string, zone: DropZone, drag?: JournalDrag) => void;
  dropOnTabs: (paneId: string, index: number) => void;
  toggleFolder: (id: string) => void;
  setAllExpanded: (expanded: boolean) => void;
};

const JournalContext = createContext<JournalContextValue | null>(null);
const JournalActionsContext = createContext<JournalActions | null>(null);
const JournalItemsContext = createContext<JournalItem[] | null>(null);

export function JournalProvider({ children }: WithChildren) {
  const [state, dispatch] = useReducer(
    journalReducer,
    undefined,
    createJournalState,
  );
  const [drag, setDrag] = useState<JournalDrag | null>(null);
  const dragRef = useRef<JournalDrag | null>(null);

  const { failed: loadFailed, loaded } = useJournalPersistence({
    state,
    dispatch,
  });
  useJournalSync({ items: state.items, loaded, dispatch });

  const actions = useMemo<JournalActions>(() => {
    const setDragging = (next: JournalDrag | null) => {
      dragRef.current = next;
      setDrag(next);
    };

    return {
      setSort: (sort) => dispatch({ type: "setSort", sort }),
      addItem: (kind, parentId) => {
        const id = crypto.randomUUID();
        dispatch({
          type: "addItem",
          id,
          kind,
          parentId,
          name: translate(
            kind === "note" ? "journal.untitledNote" : "journal.untitledFolder",
          ),
          now: Date.now(),
        });
        return id;
      },
      setSplitSizes: (key, sizes) =>
        dispatch({ type: "setSplitSizes", key, sizes }),
      setReading: (paneId, reading) =>
        dispatch({ type: "setReading", paneId, reading }),
      addTab: (paneId) => dispatch({ type: "addTab", paneId }),
      renameItem: (id, name) =>
        dispatch({ type: "renameItem", id, name, now: Date.now() }),
      removeItem: (id) => dispatch({ type: "removeItem", id }),
      setContent: (id, content) =>
        dispatch({ type: "setContent", id, content, now: Date.now() }),
      moveItem: (id, parentId) =>
        dispatch({ type: "moveItem", id, parentId, now: Date.now() }),
      openNote: (id, newTab = false) =>
        dispatch({ type: "openNote", id, newTab }),
      activateTab: (paneId, id) =>
        dispatch({ type: "activateTab", paneId, id }),
      closeTab: (paneId, id) => dispatch({ type: "closeTab", paneId, id }),
      focusPane: (paneId) => dispatch({ type: "focusPane", paneId }),
      startDrag: (payload) => setTimeout(() => setDragging(payload)),
      endDrag: () => setDragging(null),
      dropOnPane: (paneId, zone, payload) => {
        const drag = payload ?? dragRef.current;
        if (!drag) return;
        dispatch({ type: "dropOnPane", drag, paneId, zone });
        setDragging(null);
      },
      dropOnTabs: (paneId, index) => {
        if (!dragRef.current) return;
        dispatch({ type: "dropOnTabs", drag: dragRef.current, paneId, index });
        setDragging(null);
      },
      toggleFolder: (id) => dispatch({ type: "toggleFolder", id }),
      setAllExpanded: (expanded) =>
        dispatch({ type: "setAllExpanded", expanded }),
    };
  }, []);

  const { sort, workspace, expanded, splitSizes } = state;
  const [outline, setOutline] = useState<JournalItem[]>(EMPTY_ARRAY);
  const outlineItems = toOutline(
    outline,
    state.items,
    sort.startsWith("modified-"),
  );
  if (outlineItems !== outline) setOutline(outlineItems);

  const itemsById = useMemo(
    () => new Map(outlineItems.map((item) => [item.id, item])),
    [outlineItems],
  );
  const acceptedDrag =
    drag && (itemsById.get(drag.id)?.type === "note" || isNewTab(drag.id))
      ? drag
      : null;
  const value = useMemo<JournalContextValue>(
    () => ({
      items: outlineItems,
      sort,
      workspace,
      expanded,
      splitSizes,
      drag,
      acceptedDrag,
      loadFailed,
      itemsById,
    }),
    [
      outlineItems,
      sort,
      workspace,
      expanded,
      splitSizes,
      drag,
      acceptedDrag,
      loadFailed,
      itemsById,
    ],
  );

  return (
    <JournalActionsContext.Provider value={actions}>
      <JournalItemsContext.Provider value={state.items}>
        <JournalContext.Provider value={value}>
          {children}
        </JournalContext.Provider>
      </JournalItemsContext.Provider>
    </JournalActionsContext.Provider>
  );
}

// eslint-disable-next-line
export function useJournalActions() {
  const context = useContext(JournalActionsContext);
  if (!context)
    throw new Error("useJournalActions must be used within a JournalProvider");
  return context;
}

// eslint-disable-next-line
export function useJournal() {
  const state = useContext(JournalContext);
  const actions = useJournalActions();
  if (!state)
    throw new Error("useJournal must be used within a JournalProvider");
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

// eslint-disable-next-line
export function useJournalItems() {
  const items = useContext(JournalItemsContext);
  if (!items)
    throw new Error("useJournalItems must be used within a JournalProvider");
  return items;
}
