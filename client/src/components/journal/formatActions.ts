import type { Command } from "@codemirror/view";
import {
  Bold,
  Code,
  FileCode,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  type LucideIcon,
} from "lucide-react";
import { formatCommands } from "@/lib/journal/formatKeymap";

export type FormatAction = {
  label: string;
  icon: LucideIcon;
  command: Command;
};

export const primaryActions: FormatAction[] = [
  { label: "bold", icon: Bold, command: formatCommands.bold },
  { label: "italic", icon: Italic, command: formatCommands.italic },
  {
    label: "strikethrough",
    icon: Strikethrough,
    command: formatCommands.strikethrough,
  },
  { label: "code", icon: Code, command: formatCommands.code },
  { label: "link", icon: Link, command: formatCommands.link },
];

export const secondaryActions: FormatAction[] = [
  { label: "bulletList", icon: List, command: formatCommands.bulletList },
  {
    label: "numberedList",
    icon: ListOrdered,
    command: formatCommands.numberedList,
  },
  { label: "taskList", icon: ListChecks, command: formatCommands.taskList },
  { label: "quote", icon: Quote, command: formatCommands.quote },
  { label: "codeBlock", icon: FileCode, command: formatCommands.codeBlock },
];
