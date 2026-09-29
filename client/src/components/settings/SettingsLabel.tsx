import { FieldTitle } from "@/components/ui/field";
import { useSetting } from "@/hooks/useSetting";
import type { SettingKey } from "@/lib/settingsDefaults";
import { isSyncable } from "@/lib/settingsSync";
import ResetToDefault from "./ResetToDefault";
import { settingLabelByKey, settingLabelId } from "./settingsData";
import SyncToggle from "./SyncToggle";

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
      <FieldTitle id={settingLabelId(settingKey)}>
        {settingLabelByKey(settingKey)}
      </FieldTitle>
      {isSyncable(settingKey) && <SyncToggle settingKey={settingKey} />}
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
