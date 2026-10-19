import SpaceIcon from "@/components/sharing/SpaceIcon";
import type { SpaceDescription } from "@/hooks/useSpaceDescription";

export default function SpaceName({
  description,
}: {
  description: SpaceDescription;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SpaceIcon {...description} />
      <span className="truncate text-sm font-medium">{description.name}</span>
    </span>
  );
}
