import { CalendarIcon } from "lucide-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { useWeekStart } from "@/hooks/useWeekStart";
import { toPickerDate } from "@/lib/calendar/date";
import { fmt } from "@/i18n";
import { useTranslation } from "react-i18next";

type DateTimePickerProps = {
  value: Date | undefined;
  onChange: (val: Date | undefined) => void;
  label?: string;
  dateOnly?: boolean;
};

export function DateTimePicker({
  value,
  onChange,
  label,
  dateOnly,
}: DateTimePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { dayPickerWeekStart } = useWeekStart();
  const zoned = value && DateTime.fromJSDate(value);
  const pickerDate = zoned && toPickerDate(zoned);

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            data-empty={!value}
            className={cn(
              "data-[empty=true]:text-muted-foreground justify-start text-start font-normal",
              dateOnly && "flex-1",
            )}
          >
            <CalendarIcon />
            {value ? (
              zoned!.toFormat(fmt("date"))
            ) : (
              <span>{t("picker.pickDate")}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={pickerDate}
            defaultMonth={pickerDate}
            today={toPickerDate(DateTime.now())}
            weekStartsOn={dayPickerWeekStart}
            onSelect={(date) => {
              if (!date) return;

              // preserve the old time
              onChange(
                DateTime.fromObject({
                  year: date.getFullYear(),
                  month: date.getMonth() + 1,
                  day: date.getDate(),
                  hour: zoned?.hour ?? 0,
                  minute: zoned?.minute ?? 0,
                }).toJSDate(),
              );
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {!dateOnly && (
        <Input
          type="time"
          step="60"
          aria-label={label && t("picker.time", { label })}
          value={zoned ? zoned.toFormat("HH:mm") : ""}
          onChange={(e) => {
            if (!zoned) return;
            const [hour, minute] = e.target.value.split(":").map(Number);
            onChange(zoned.set({ hour, minute }).toJSDate());
          }}
          className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        />
      )}
    </div>
  );
}
