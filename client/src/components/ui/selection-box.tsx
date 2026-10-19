import type { SelectionBoxStyle } from "@/hooks/useSelectionBox";

export default function SelectionBox({
  box,
}: {
  box: SelectionBoxStyle | null;
}) {
  if (!box) return null;

  return (
    <div
      aria-hidden="true"
      className="selection-box fixed z-20 pointer-events-none border border-primary bg-primary/20"
      style={box}
    />
  );
}
