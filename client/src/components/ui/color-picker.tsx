"use client";

import { useMemo, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { cn } from "@/lib/utils";
import type { ButtonProps } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ColorPickerProps {
  value: string;
  presetColors?: string[];
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
    <div className="grid grid-flow-col grid-rows-[repeat(9,1fr)] gap-1">
      {presetColors.map((presetColor: string) => (
        <button
          key={presetColor}
          className="rounded p-3 opacity-90 hover:opacity-100"
          style={{ background: presetColor }}
          onClick={() => onChange(presetColor)}
        />
      ))}
    </div>
  );
};

const ColorPicker = ({
  disabled,
  value,
  presetColors,
  onChange,
  onBlur,
  name,
  className,
  size,
  ...props
}: Omit<ButtonProps, "value" | "onChange" | "onBlur"> & ColorPickerProps) => {
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
            <HexColorInput
              className="border-input mt-5 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
              color={parsedValue}
              onChange={onChange}
              prefixed
            />
          </div>
          {presetColors && presetColors.length > 0 && (
            <SwatchesPicker
              onChange={(e) => {
                onChange(e);
                setOpen(false);
              }}
              presetColors={presetColors}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export { ColorPicker };
