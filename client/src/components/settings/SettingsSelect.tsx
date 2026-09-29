import type { ComponentProps, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SettingsSelect({
  triggerClassName = "w-[160px]",
  labelledBy,
  placeholder,
  footer,
  children,
  ...props
}: ComponentProps<typeof Select> & {
  triggerClassName?: string;
  labelledBy?: string;
  placeholder?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 @md/field-group:items-end">
      <Select {...props}>
        <SelectTrigger
          className={triggerClassName}
          aria-labelledby={labelledBy}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
      {footer}
    </div>
  );
}
