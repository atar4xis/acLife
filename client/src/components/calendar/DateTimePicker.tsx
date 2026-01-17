import { CalendarIcon } from "lucide-react";
import { DateTime } from "luxon";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";

type DateTimePickerProps = {
  value: Date | undefined;
  onChange: (val: Date | undefined) => void;
};

export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);

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
              DateTime.fromJSDate(value).toFormat("dd LLL yyyy")
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(date) => {
              if (!date) return;

              let newDate = new Date(date);

              // preserve the old time
              if (value) {
                newDate.setHours(value.getHours(), value.getMinutes());
              }

              onChange(newDate);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      <Input
        type="time"
        step="60"
        value={value ? DateTime.fromJSDate(value).toFormat("HH:mm") : ""}
        onChange={(e) => {
          if (!value) return;
          const [hours, minutes] = e.target.value.split(":").map(Number);
          const newDate = new Date(value);
          newDate.setHours(hours, minutes);
          onChange(newDate);
        }}
        className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
      />
    </div>
  );
}
