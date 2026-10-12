import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useSetting, type SettingValues } from "@/hooks/useSetting";
import type { SettingKey } from "@/lib/settingsDefaults";
import { settingLabelId } from "./settingsData";
import SettingsLabel from "./SettingsLabel";

type SwitchKey = {
  [K in SettingKey]: SettingValues[K] extends boolean ? K : never;
}[SettingKey];

export default function SettingsSwitch({
  settingKey,
  className,
  disabled,
}: {
  settingKey: SwitchKey;
  className?: string;
  disabled?: boolean;
}) {
  const { value, set } = useSetting(settingKey);

  return (
    <Field orientation="responsive" className={className}>
      <SettingsLabel settingKey={settingKey} />
      <Switch
        aria-labelledby={settingLabelId(settingKey)}
        checked={value}
        disabled={disabled}
        onCheckedChange={set}
      />
    </Field>
  );
}
