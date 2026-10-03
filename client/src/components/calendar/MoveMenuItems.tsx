import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import { MoveIcon } from "lucide-react";
import type { CalendarEvent } from "@/types/calendar/Event";
import { useCalendarActions, useEventList } from "@/context/CalendarContext";
import { useSelectedEvents } from "@/hooks/useSelection";
import { eventKey } from "@/lib/calendar/event";
import { isChainParent } from "@/lib/calendar/recurrence";
import {
  getMovedEvent,
  findFreeSlotForEvent,
  MOVE_MINUTE_STEPS,
  MOVE_HOUR_STEPS,
  MOVE_UNIT_STEPS,
} from "@/lib/calendar/moveHelpers";
import { fmt } from "@/i18n";
import { useTranslation } from "react-i18next";

/* shared shape between shadcn's DropdownMenu* and ContextMenu* primitives,
   so this menu can be rendered inside either one without duplicating markup */
export type MoveMenuKit = {
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ children?: ReactNode; className?: string }>;
  SubContent: ComponentType<{ children?: ReactNode }>;
  Item: ComponentType<{ children?: ReactNode; onClick?: () => void }>;
  Separator: ComponentType;
};

export function MoveMenuItems({
  event,
  onMove,
  menu,
}: {
  event: CalendarEvent;
  onMove: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  menu: MoveMenuKit;
}) {
  const { t } = useTranslation();
  const calendarEvents = useEventList();
  const { selection } = useCalendarActions();
  const selectedEvents = useSelectedEvents(selection);
  const clearSelection = selection.clear;
  const { Sub, SubTrigger, SubContent, Item, Separator } = menu;

  const batch =
    selectedEvents.size > 1 && selectedEvents.has(eventKey(event))
      ? [
          event,
          ...Array.from(selectedEvents.entries())
            .filter(([key]) => key !== eventKey(event))
            .map(([, ev]) => ev),
        ].sort((a, b) => Number(isChainParent(a)) - Number(isChainParent(b)))
      : [event];

  const moveBy = (
    direction: "forward" | "backward",
    unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years",
    amount: number,
  ) => {
    for (const ev of batch) {
      onMove(ev, getMovedEvent(ev, direction, unit, amount));
    }

    if (batch.length > 1) clearSelection();
  };

  const moveToFreeSlot = (direction: "forward" | "backward") => {
    const slot = findFreeSlotForEvent(calendarEvents, event, direction);
    if (!slot) return toast.error(t("move.noFreeSlot"));

    const shift = slot.start.diff(event.start);
    for (const ev of batch) {
      onMove(ev, {
        ...ev,
        start: ev.start.plus(shift),
        end: ev.end.plus(shift),
      });
    }

    if (batch.length > 1) clearSelection();

    const sameDay = slot.start.hasSame(slot.end, "day");
    toast.success(
      t("move.movedTo", {
        start: slot.start.toFormat(fmt("dateTimeShort")),
        end: slot.end.toFormat(sameDay ? fmt("time") : fmt("dateTimeShort")),
      }),
    );
  };

  return (
    <Sub>
      <SubTrigger className="gap-2">
        <MoveIcon />
        {t("move.title")}
      </SubTrigger>
      <SubContent>
        <Sub>
          <SubTrigger>{t("move.forward")}</SubTrigger>
          <SubContent>
            {MOVE_MINUTE_STEPS.map((minutes) => (
              <Item
                key={`fwd-min-${minutes}`}
                onClick={() => moveBy("forward", "minutes", minutes)}
              >
                {t("move.minutes", { count: minutes })}
              </Item>
            ))}
            {MOVE_HOUR_STEPS.map((hours) => (
              <Item
                key={`fwd-hour-${hours}`}
                onClick={() => moveBy("forward", "hours", hours)}
              >
                {t("move.hours", { count: hours })}
              </Item>
            ))}
          </SubContent>
        </Sub>

        <Sub>
          <SubTrigger>{t("move.backward")}</SubTrigger>
          <SubContent>
            {MOVE_MINUTE_STEPS.map((minutes) => (
              <Item
                key={`bwd-min-${minutes}`}
                onClick={() => moveBy("backward", "minutes", minutes)}
              >
                {t("move.minutes", { count: minutes })}
              </Item>
            ))}
            {MOVE_HOUR_STEPS.map((hours) => (
              <Item
                key={`bwd-hour-${hours}`}
                onClick={() => moveBy("backward", "hours", hours)}
              >
                {t("move.hours", { count: hours })}
              </Item>
            ))}
          </SubContent>
        </Sub>

        <Sub>
          <SubTrigger>{t("move.next")}</SubTrigger>
          <SubContent>
            {MOVE_UNIT_STEPS.map((unit) => (
              <Item
                key={`next-${unit}`}
                onClick={() => moveBy("forward", unit, 1)}
              >
                {t(`move.unit.${unit}`)}
              </Item>
            ))}
          </SubContent>
        </Sub>

        <Sub>
          <SubTrigger>{t("move.previous")}</SubTrigger>
          <SubContent>
            {MOVE_UNIT_STEPS.map((unit) => (
              <Item
                key={`prev-${unit}`}
                onClick={() => moveBy("backward", unit, 1)}
              >
                {t(`move.unit.${unit}`)}
              </Item>
            ))}
          </SubContent>
        </Sub>

        <Separator />

        <Item onClick={() => moveToFreeSlot("forward")}>
          {t("move.nextFree")}
        </Item>
        <Item onClick={() => moveToFreeSlot("backward")}>
          {t("move.previousFree")}
        </Item>
      </SubContent>
    </Sub>
  );
}
