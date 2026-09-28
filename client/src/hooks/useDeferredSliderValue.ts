import { useEffect, useState } from "react";

export function useDeferredSliderValue(
  value: number,
  onCommit: (value: number) => void,
) {
  const [dragValue, setDragValue] = useState<number | null>(null);

  useEffect(() => {
    setDragValue(null);
  }, [value]);

  return {
    value: dragValue ?? value,
    onValueChange: ([next]: number[]) => setDragValue(next),
    onValueCommit: ([next]: number[]) => onCommit(next),
  };
}
