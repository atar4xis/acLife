import { FieldTitle } from "@/components/ui/field";
import { useSetting } from "@/hooks/useSetting";
import type { SettingKey } from "@/lib/settingsDefaults";
import ResetToDefault from "./ResetToDefault";
import { settingLabelByKey } from "./settingsData";

export default function SettingsLabel({
  settingKey,
  onReset,
}: {
  settingKey: SettingKey;
  onReset?: () => void;
}) {
  const { value, defaultValue, set } = useSetting(settingKey);

  return (
    <div className="flex flex-auto items-center gap-1.5">
      <FieldTitle>{settingLabelByKey(settingKey)}</FieldTitle>
      {value !== defaultValue && (
        <ResetToDefault
          onClick={() => {
            onReset?.();
            set(defaultValue as never);
          }}
        />
      )}
    </div>
  );
}
