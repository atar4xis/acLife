type PushNotificationEvent = {
  type: "notification";
  title: string;
  body: string;
};

type PushSyncEvent = {
  type: "sync";
  originClientId: string;
};

type PushSettingsEvent = {
  type: "settings";
  originClientId: string;
};

export type PushEvent =
  PushSyncEvent | PushSettingsEvent | PushNotificationEvent;
