import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Permission } from "@/types/Share";
import { useTranslation } from "react-i18next";

export default function PermissionSelect({
  value,
  onChange,
  label,
}: {
  value: Permission;
  onChange: (permission: Permission) => void;
  label: string;
}) {
  const { t } = useTranslation();

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as Permission)}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="read">{t("shares.canView")}</SelectItem>
        <SelectItem value="write">{t("shares.canEdit")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
