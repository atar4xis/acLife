import { FileText, Folder, FolderOpen, type LucideProps } from "lucide-react";
import { useIconMap, type IconMap } from "@/hooks/useIconMap";
import { cn } from "@/lib/utils";

const builtIn: Record<string, IconMap[keyof IconMap]> = {
  FileText,
  Folder,
  FolderOpen,
};

type LucideIconProps = Omit<LucideProps, "ref"> & { name: string };

function LazyIcon({ name, className, ...props }: LucideIconProps) {
  const Icon = useIconMap()?.[name as keyof IconMap];

  if (!Icon) return <span className={cn("inline-block", className)} />;
  return <Icon className={className} {...props} />;
}

export function LucideIcon({ name, ...props }: LucideIconProps) {
  const Icon = builtIn[name];

  if (Icon) return <Icon {...props} />;
  return <LazyIcon name={name} {...props} />;
}
