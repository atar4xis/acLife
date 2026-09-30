import { useEffect, useRef } from "react";
import {
  useSettingsSelector,
  useSettingsStore,
} from "@/context/SettingsStoreContext";
import { useDeferredSliderValue } from "@/hooks/useDeferredSliderValue";
import { Field, FieldContent } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import type { StoreSettings } from "@/lib/settingsDefaults";
import SettingsLabel from "./SettingsLabel";
import { settingLabelId } from "./settingsData";

type NumericSettingKey = {
  [K in keyof StoreSettings]: StoreSettings[K] extends number ? K : never;
}[keyof StoreSettings];

export default function SettingsSlider({
  settingKey,
  min,
  max,
  step = 1,
  disabled,
  format = String,
  onCommit,
  onLiveChange,
}: {
  settingKey: NumericSettingKey;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  format?: (value: number) => string;
  // overrides saving the value to the setting itself
  onCommit?: (value: number) => void;
  // reports the value being shown in realtime
  onLiveChange?: (value: number) => void;
}) {
  const store = useSettingsStore();
  const value = useSettingsSelector(({ settings }) => settings[settingKey]);
  const slider = useDeferredSliderValue(
    value,
    onCommit ?? ((next) => store.setSetting(settingKey, next)),
  );

  const liveChange = useRef(onLiveChange);
  liveChange.current = onLiveChange;
  useEffect(() => liveChange.current?.(slider.value), [slider.value]);

  return (
    <Field>
      <FieldContent>
        <div className="flex items-center justify-between">
          <SettingsLabel settingKey={settingKey} />
          <span className="text-muted-foreground text-sm">
            {format(slider.value)}
          </span>
        </div>
      </FieldContent>
      <Slider
        aria-labelledby={settingLabelId(settingKey)}
        className="mt-1"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={[slider.value]}
        onValueChange={slider.onValueChange}
        onValueCommit={slider.onValueCommit}
      />
    </Field>
  );
}
