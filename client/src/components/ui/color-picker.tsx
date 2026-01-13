"use client";

import { forwardRef, useMemo, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { cn } from "@/lib/utils";
import { useForwardedRef } from "@/lib/use-forwarded-ref";
import type { ButtonProps } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

interface ColorPickerProps {
  value: string;
  presetColors: string[];
  onChange: (value: string) => void;
  onBlur?: () => void;
}

const SwatchesPicker = ({
  onChange,
  presetColors,
}: {
  onChange: (color: string) => void;
  presetColors: string[];
}) => {
  return (
    <div className="flex flex-col flex-wrap gap-1">
      {presetColors.map((presetColor: string) => (
        <button
          key={presetColor}
          className="p-3 rounded opacity-90 hover:opacity-100"
          style={{ background: presetColor }}
          onClick={() => onChange(presetColor)}
        />
      ))}
    </div>
  );
};

const ColorPicker = forwardRef<
  HTMLInputElement,
  Omit<ButtonProps, "value" | "onChange" | "onBlur"> &
    ColorPickerProps &
    ButtonProps
>(
  (
    {
      disabled,
      value,
      presetColors,
      onChange,
      onBlur,
      name,
      className,
      size,
      ...props
    },
    forwardedRef,
  ) => {
    const ref = useForwardedRef(forwardedRef);
    const [open, setOpen] = useState(false);

    const parsedValue = useMemo(() => {
      return value || "#FFFFFF";
    }, [value]);

    return (
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild disabled={disabled} onBlur={onBlur}>
          <Button
            {...props}
            className={cn("block", className)}
            name={name}
            onClick={() => {
              setOpen(true);
            }}
            size={size}
            style={{
              backgroundColor: parsedValue,
            }}
            variant="outline"
          >
            <div />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full">
          <div className="flex gap-4">
            <div>
              <HexColorPicker
                style={{ width: "auto" }}
                color={parsedValue}
                onChange={onChange}
              />
              <Input
                className="mt-5"
                maxLength={7}
                onChange={(e) => {
                  onChange(e?.currentTarget?.value);
                }}
                ref={ref}
                value={parsedValue}
              />
            </div>
            <SwatchesPicker
              onChange={(e) => {
                onChange(e);
                setOpen(false);
              }}
              presetColors={presetColors}
            />
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);
ColorPicker.displayName = "ColorPicker";

export { ColorPicker };
