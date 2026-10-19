import { t as translate } from "@/i18n";
import { useJournalPersistence } from "@/hooks/journal/useJournalPersistence";
import { useJournalSync } from "@/hooks/journal/useJournalSync";
import JournalSharing from "@/components/journal/JournalSharing";
import { useSettingsStore } from "@/context/SettingsStoreContext";
import { useShares } from "@/context/ShareContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { EMPTY_ARRAY } from "@/lib/constants";
import {
  itemStyle,
  MODIFIED_SORT_SETTLE_MS,
  noteName,
  toOutline,
} from "@/lib/journal/item";
import { isNewTab } from "@/lib/journal/layout";
import { isOwnItem, placeShared, haveSameItems } from "@/lib/journal/shared";
import { createJournalState, journalReducer } from "@/reducers/journalReducer";
import type { WithChildren } from "@/types/Props";
import type {
  DropZone,
  ItemStyle,
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

type JournalContextValue = Omit<JournalState, "removed"> & {
  drag: JournalDrag | null;
  acceptedDrag: JournalDrag | null;
  loadFailed: boolean;
  loaded: boolean;
  itemsById: ReadonlyMap<string, JournalItem>;
};

type JournalActions = {
  setSplitSizes: (key: string, sizes: number[]) => void;
  setReading: (paneId: string, reading: boolean) => void;
  setSource: (paneId: string, source: boolean) => void;
  setSort: (sort: JournalSort) => void;
  importItems: (upserts: JournalItem[]) => void;
  addItem: (type: JournalItem["type"], parentId: string | null) => string;
  addTab: (paneId: string) => void;
  renameItem: (id: string, name: string) => void;
  customizeItem: (id: string, name: string, style: ItemStyle) => void;
  removeItem: (id: string) => void;
  setContent: (id: string, content: string) => void;
  moveItem: (id: string, parentId: string | null) => void;
  openNote: (id: string, newTab?: boolean) => void;
  activateTab: (paneId: string, id: string) => void;
  closeTab: (paneId: string, id: string) => void;
  closeTabs: (ids: string[]) => void;
  splitTab: (paneId: string, id: string, zone: "right" | "bottom") => void;
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
const JournalOwnItemsContext = createContext<JournalItem[] | null>(null);
const JournalSavingContext = createContext(false);

export function JournalProvider({ children }: WithChildren) {
  const [state, dispatch] = useReducer(
    journalReducer,
    undefined,
    createJournalState,
  );
  const settingsStore = useSettingsStore();
  const [drag, setDrag] = useState<JournalDrag | null>(null);
  const dragRef = useRef<JournalDrag | null>(null);

  // sync only sees the own items, shared ones come from their spaces
  const latestOwnItems = useMemo(
    () => state.items.filter(isOwnItem),
    [state.items],
  );
  const [ownItems, setOwnItems] = useState(latestOwnItems);
  if (!haveSameItems(ownItems, latestOwnItems)) setOwnItems(latestOwnItems);
  const { failed: loadFailed, loaded } = useJournalPersistence({
    state,
    ownItems,
    dispatch,
  });
  const saving = useJournalSync({ items: ownItems, loaded, dispatch });
  const { joined, nameOf } = useShares();
  const ownerNames = useMemo(
    () =>
      new Map(
        joined.map((space) => [
          space.owner,
          nameOf(space.owner, space.ownerEmail),
        ]),
      ),
    [joined, nameOf],
  );
  // shared items are grouped under one fake folder per owner for display only
  const displayItems = useMemo(
    () => placeShared(state.items, ownerNames),
    [state.items, ownerNames],
  );

  const actions = useMemo<JournalActions>(() => {
    const setDragging = (next: JournalDrag | null) => {
      dragRef.current = next;
      setDrag(next);
    };

    return {
      setSort: (sort) => dispatch({ type: "setSort", sort }),
      importItems: (upserts) => dispatch({ type: "importItems", upserts }),
      addItem: (kind, parentId) => {
        const settings = settingsStore.getSnapshot();
        const id = crypto.randomUUID();
        dispatch({
          type: "addItem",
          id,
          kind,
          parentId:
            parentId ??
            (kind === "note" ? settings.journalNoteFolder || null : null),
          name:
            kind === "note"
              ? noteName(settings.journalNoteName)
              : translate("journal.untitledFolder"),
          style: itemStyle(kind, settings),
          now: Date.now(),
        });
        return id;
      },
      setSplitSizes: (key, sizes) =>
        dispatch({ type: "setSplitSizes", key, sizes }),
      setReading: (paneId, reading) =>
        dispatch({ type: "setReading", paneId, reading }),
      setSource: (paneId, source) =>
        dispatch({ type: "setSource", paneId, source }),
      addTab: (paneId) => dispatch({ type: "addTab", paneId }),
      renameItem: (id, name) =>
        dispatch({ type: "renameItem", id, name, now: Date.now() }),
      customizeItem: (id, name, style) =>
        dispatch({ type: "customizeItem", id, name, style, now: Date.now() }),
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
      closeTabs: (ids) => dispatch({ type: "closeTabs", ids }),
      splitTab: (paneId, id, zone) =>
        dispatch({ type: "splitTab", paneId, id, zone }),
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
  }, [settingsStore]);

  const { sort, workspace, expanded, splitSizes } = state;
  const [outline, setOutline] = useState<JournalItem[]>(EMPTY_ARRAY);
  const settledItems = useDebouncedValue(state.items, MODIFIED_SORT_SETTLE_MS);
  const outlineItems = toOutline(
    outline,
    displayItems,
    sort.startsWith("modified-") && settledItems === state.items,
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
      loaded,
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
      loaded,
      itemsById,
    ],
  );

  return (
    <JournalActionsContext.Provider value={actions}>
      <JournalItemsContext.Provider value={state.items}>
        <JournalOwnItemsContext.Provider value={ownItems}>
          <JournalSavingContext.Provider value={saving}>
            <JournalContext.Provider value={value}>
              <JournalSharing
                items={state.items}
                removed={state.removed}
                loaded={loaded}
                dispatch={dispatch}
              />
              {children}
            </JournalContext.Provider>
          </JournalSavingContext.Provider>
        </JournalOwnItemsContext.Provider>
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

// eslint-disable-next-line
export function useOwnJournalItems() {
  const items = useContext(JournalOwnItemsContext);
  if (!items)
    throw new Error("useOwnJournalItems must be used within a JournalProvider");
  return items;
}

// eslint-disable-next-line
export function useJournalSaving() {
  return useContext(JournalSavingContext);
}
