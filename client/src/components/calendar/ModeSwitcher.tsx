import { memo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { ViewMode } from "@/types/calendar/ViewMode";
import { useTranslation } from "react-i18next";

type ModeSwitcherParams = {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
};

export default memo(function ModeSwitcher({
  mode,
  setMode,
}: ModeSwitcherParams) {
  const { t } = useTranslation();
  return (
    <Select value={mode} onValueChange={setMode}>
      <SelectTrigger className="me-4 md:me-0" aria-label={t("view.mode")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="day">{t("view.day")}</SelectItem>
        <SelectItem value="week">{t("view.week")}</SelectItem>
      </SelectContent>
    </Select>
  );
});
