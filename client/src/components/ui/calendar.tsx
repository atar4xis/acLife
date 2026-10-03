import * as React from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
} from "react-day-picker";

import { useTranslation } from "react-i18next";
import { dayPickerLocale } from "@/i18n/dayPicker";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

const defaultClassNames = getDefaultClassNames();

const defaultComponents: NonNullable<
  React.ComponentProps<typeof DayPicker>["components"]
> = {
  Root: ({ className, rootRef, ...props }) => {
    return (
      <div
        data-slot="calendar"
        ref={rootRef}
        className={cn(className)}
        {...props}
      />
    );
  },
  Chevron: ({ className, orientation, ...props }) => {
    if (orientation === "left") {
      return (
        <ChevronLeftIcon
          className={cn("size-4 rtl:-scale-x-100", className)}
          {...props}
        />
      );
    }

    if (orientation === "right") {
      return (
        <ChevronRightIcon
          className={cn("size-4 rtl:-scale-x-100", className)}
          {...props}
        />
      );
    }

    return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
  },
  DayButton: CalendarDayButton,
  WeekNumber: ({ children, ...props }) => {
    return (
      <td {...props}>
        <div className="flex size-(--cell-size) items-center justify-center text-center">
          {children}
        </div>
      </td>
    );
  },
};

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const { showWeekNumber } = props;
  const { i18n } = useTranslation();

  const mergedFormatters = React.useMemo(
    () => ({
      formatMonthDropdown: (date: Date) =>
        date.toLocaleString(i18n.language, { month: "short" }),
      ...formatters,
    }),
    [formatters, i18n.language],
  );

  const mergedClassNames = React.useMemo(
    () => ({
      root: cn("w-fit", defaultClassNames.root),
      months: cn(
        "flex gap-4 flex-col md:flex-row relative",
        defaultClassNames.months,
      ),
      month: cn("flex flex-col w-full gap-4", defaultClassNames.month),
      nav: cn(
        "flex items-center gap-1 w-full absolute top-0 inset-x-0 justify-between",
        defaultClassNames.nav,
      ),
      button_previous: cn(
        buttonVariants({ variant: buttonVariant }),
        "size-(--cell-size) aria-disabled:opacity-50 p-0 select-none",
        defaultClassNames.button_previous,
      ),
      button_next: cn(
        buttonVariants({ variant: buttonVariant }),
        "size-(--cell-size) aria-disabled:opacity-50 p-0 select-none",
        defaultClassNames.button_next,
      ),
      month_caption: cn(
        "flex items-center justify-center h-(--cell-size) w-full px-(--cell-size)",
        defaultClassNames.month_caption,
      ),
      dropdowns: cn(
        "w-full flex items-center text-sm font-medium justify-center h-(--cell-size) gap-1.5",
        defaultClassNames.dropdowns,
      ),
      dropdown_root: cn(
        "relative has-focus:border-ring has-focus:ring-1 has-focus:ring-ring border border-input shadow-xs rounded-md",
        defaultClassNames.dropdown_root,
      ),
      dropdown: cn(
        "absolute bg-popover inset-0 opacity-0",
        defaultClassNames.dropdown,
      ),
      caption_label: cn(
        "select-none font-medium",
        captionLayout === "label"
          ? "text-sm"
          : "rounded-md ps-2 pe-1 flex items-center gap-1 text-sm h-8 [&>svg]:text-muted-foreground [&>svg]:size-3.5",
        defaultClassNames.caption_label,
      ),
      month_grid: cn("w-full border-collapse"),
      weekdays: cn("flex", defaultClassNames.weekdays),
      weekday: cn(
        "text-muted-foreground rounded-md flex-1 font-normal text-[0.8rem] select-none",
        defaultClassNames.weekday,
      ),
      week: cn("flex w-full mt-2", defaultClassNames.week),
      week_number_header: cn(
        "select-none w-(--cell-size)",
        defaultClassNames.week_number_header,
      ),
      week_number: cn(
        "text-[0.8rem] select-none text-muted-foreground",
        defaultClassNames.week_number,
      ),
      day: cn(
        "relative w-full h-full p-0 text-center [&:last-child[data-selected=true]_button]:rounded-e-md group/day aspect-square select-none",
        showWeekNumber
          ? "[&:nth-child(2)[data-selected=true]_button]:rounded-s-md"
          : "[&:first-child[data-selected=true]_button]:rounded-s-md",
        defaultClassNames.day,
      ),
      range_start: cn("rounded-s-md bg-accent", defaultClassNames.range_start),
      range_middle: cn("rounded-none", defaultClassNames.range_middle),
      range_end: cn("rounded-e-md bg-accent", defaultClassNames.range_end),
      today: cn(
        "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
        defaultClassNames.today,
      ),
      outside: cn(
        "text-muted-foreground aria-selected:text-muted-foreground",
        defaultClassNames.outside,
      ),
      disabled: cn(
        "text-muted-foreground opacity-50",
        defaultClassNames.disabled,
      ),
      hidden: cn("invisible", defaultClassNames.hidden),
      ...classNames,
    }),
    [buttonVariant, captionLayout, showWeekNumber, classNames],
  );

  const mergedComponents = React.useMemo(
    () => ({ ...defaultComponents, ...components }),
    [components],
  );

  return (
    <DayPicker
      dir={i18n.dir()}
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3 [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        className,
      )}
      captionLayout={captionLayout}
      formatters={mergedFormatters}
      classNames={mergedClassNames}
      components={mergedComponents}
      locale={dayPickerLocale(i18n.language)}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-1 group-data-[focused=true]/day:ring-ring dark:hover:text-accent-foreground flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 data-[range-end=true]:rounded-md data-[range-end=true]:rounded-e-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md data-[range-start=true]:rounded-s-md [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
