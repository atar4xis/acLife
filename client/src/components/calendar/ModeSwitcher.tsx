import { memo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { ViewMode } from "@/types/calendar/ViewMode";

type ModeSwitcherParams = {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
};

export default memo(function ModeSwitcher({
  mode,
  setMode,
}: ModeSwitcherParams) {
  return (
    <Select value={mode} onValueChange={setMode}>
      <SelectTrigger className="mr-4 md:mr-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="day">Day</SelectItem>
        <SelectItem value="week">Week</SelectItem>
      </SelectContent>
    </Select>
  );
});
