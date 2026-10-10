import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

export type MenuParts = {
  Label: React.ComponentType<
    Pick<
      React.ComponentProps<typeof ContextMenuLabel>,
      "className" | "children"
    >
  >;
  Item: React.ComponentType<
    Pick<
      React.ComponentProps<typeof ContextMenuItem>,
      "onSelect" | "style" | "children"
    >
  >;
  Sub: React.ComponentType<
    Pick<React.ComponentProps<typeof ContextMenuSub>, "children">
  >;
  SubTrigger: React.ComponentType<
    Pick<React.ComponentProps<typeof ContextMenuSubTrigger>, "children">
  >;
  SubContent: React.ComponentType<
    Pick<React.ComponentProps<typeof ContextMenuSubContent>, "children">
  >;
};

export const CONTEXT_PARTS: MenuParts = {
  Label: ContextMenuLabel,
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

export const DROPDOWN_PARTS: MenuParts = {
  Label: DropdownMenuLabel,
  Item: DropdownMenuItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};
