import { useEventList } from "@/context/CalendarContext";
import { useJournal } from "@/context/JournalContext";
import type { JournalItem } from "@/types/Journal";
import type {
  JoinedSpace,
  OwnedSpace,
  SpaceKind,
  SpaceScope,
} from "@/types/Share";
import { useTranslation } from "react-i18next";

export type SpaceDescription = {
  kind: SpaceKind;
  scope: SpaceScope;
  name: string;
  whole: boolean;
  item?: JournalItem;
};

export function useOwnedDescription() {
  const { t } = useTranslation();
  const { itemsById } = useJournal();
  const events = useEventList();

  return (space: OwnedSpace): SpaceDescription => {
    const { kind, scope } = space;
    if (kind === "calendar") {
      if (scope === "collection")
        return { kind, scope, name: t("shares.wholeCalendar"), whole: true };

      const event = events.find((e) => e.id === space.target);
      return {
        kind,
        scope,
        name: event?.title || t("shares.anEvent"),
        whole: false,
      };
    }
    if (space.target === null)
      return { kind, scope, name: t("shares.wholeJournal"), whole: true };

    const item = itemsById.get(space.target);
    return {
      kind,
      scope,
      name: item?.name ?? t("shares.aNote"),
      whole: false,
      item,
    };
  };
}

export function useJoinedDescription() {
  const { t } = useTranslation();
  const { itemsById } = useJournal();
  const events = useEventList();

  return (space: JoinedSpace): SpaceDescription => {
    const { kind, scope } = space;
    if (kind === "calendar") {
      if (scope === "collection")
        return { kind, scope, name: t("shares.wholeCalendar"), whole: true };

      const event = events.find((e) => e._shared?.space === space.id);
      return {
        kind,
        scope,
        name: event?.title || t("shares.anEvent"),
        whole: false,
      };
    }

    const items = [...itemsById.values()].filter(
      (item) => item._shared?.space === space.id,
    );
    // a note share shows the name of its one top-level item
    const roots = items.filter(
      (item) => !items.some((other) => other.id === item.parentId),
    );
    if (roots.length === 1)
      return { kind, scope, name: roots[0].name, whole: false, item: roots[0] };

    const whole = scope === "collection";
    return {
      kind,
      scope,
      name: t(whole ? "shares.wholeJournal" : "shares.aNote"),
      whole,
    };
  };
}
