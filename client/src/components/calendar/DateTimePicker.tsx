import { CalendarIcon } from "lucide-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { useWeekStart } from "@/hooks/useWeekStart";
import { toPickerDate } from "@/lib/calendar/date";

type DateTimePickerProps = {
  value: Date | undefined;
  onChange: (val: Date | undefined) => void;
};

export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
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
            className="data-[empty=true]:text-muted-foreground justify-start text-left font-normal"
          >
            <CalendarIcon />
            {value ? (
              zoned!.toFormat("dd LLL yyyy")
            ) : (
              <span>Pick a date</span>
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

      <Input
        type="time"
        step="60"
        value={zoned ? zoned.toFormat("HH:mm") : ""}
        onChange={(e) => {
          if (!zoned) return;
          const [hour, minute] = e.target.value.split(":").map(Number);
          onChange(zoned.set({ hour, minute }).toJSDate());
        }}
        className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
      />
    </div>
  );
}
