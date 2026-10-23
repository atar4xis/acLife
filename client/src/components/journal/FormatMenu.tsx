import { redo, selectAll, undo } from "@codemirror/commands";
import type { Command, EditorView } from "@codemirror/view";
import {
  ClipboardPaste,
  Copy,
  Heading,
  Redo2,
  Scissors,
  TextSelect,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  type FormatAction,
  primaryActions,
  secondaryActions,
} from "@/components/journal/formatActions";
import {
  copySelection,
  cutSelection,
  pasteClipboard,
} from "@/lib/journal/editCommands";
import { activeFormats, disabledFormats } from "@/lib/journal/activeFormats";
import { formatCommands, HEADING_LEVELS } from "@/lib/journal/formatKeymap";

function MenuItems({ view }: { view: EditorView }) {
  const { t } = useTranslation();
  const hasSelection = !view.state.selection.main.empty;
  const disabled = disabledFormats(activeFormats(view.state));

  const actionItem = (
    label: string,
    Icon: LucideIcon,
    command: Command,
    isDisabled = false,
  ) => (
    <ContextMenuItem
      key={label}
      disabled={isDisabled}
      onSelect={() => command(view)}
    >
      <Icon />
      {t(label)}
    </ContextMenuItem>
  );

  const actionItems = (actions: FormatAction[]) =>
    actions.map(({ label, icon, command }) =>
      actionItem(
        `journal.format.${label}`,
        icon,
        command,
        disabled.includes(label),
      ),
    );

  return (
    <>
      {actionItem("journal.edit.cut", Scissors, cutSelection, !hasSelection)}
      {actionItem("journal.edit.copy", Copy, copySelection, !hasSelection)}
      {actionItem("journal.edit.paste", ClipboardPaste, pasteClipboard)}
      {actionItem("journal.edit.selectAll", TextSelect, selectAll)}
      <ContextMenuSeparator />
      {actionItem("journal.edit.undo", Undo2, undo)}
      {actionItem("journal.edit.redo", Redo2, redo)}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Type />
          {t("journal.format.menu")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {actionItems(primaryActions)}
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={disabled.includes("heading1")}>
              <Heading />
              {t("journal.format.heading")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {HEADING_LEVELS.map((level) => (
                <ContextMenuItem
                  key={level}
                  disabled={disabled.includes(`heading${level}`)}
                  onSelect={() => formatCommands.heading(level)(view)}
                >
                  {t("journal.format.headingLevel", { level })}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {actionItems(secondaryActions)}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
}

export default function FormatMenu({
  viewRef,
}: {
  viewRef: RefObject<EditorView | null>;
}) {
  return (
    <ContextMenuContent
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        viewRef.current?.focus();
      }}
    >
      <MenuItems view={viewRef.current!} />
    </ContextMenuContent>
  );
}
