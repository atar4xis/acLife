import type { ComponentProps, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SettingsSelect({
  triggerClassName = "w-full @md:w-55",
  labelledBy,
  placeholder,
  footer,
  action,
  children,
  ...props
}: ComponentProps<typeof Select> & {
  triggerClassName?: string;
  labelledBy?: string;
  placeholder?: string;
  footer?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 @md/field-group:items-end">
      <div className="flex items-center gap-2">
        <Select {...props}>
          <SelectTrigger
            className={triggerClassName}
            aria-labelledby={labelledBy}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>{children}</SelectContent>
        </Select>
        {action}
      </div>
      {footer}
    </div>
  );
}
