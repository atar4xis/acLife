type PushNotificationEvent = {
  type: "notification";
  title: string;
  body: string;
};

type PushSyncEvent = {
  type: "sync";
  originClientId: string;
};

export type PushEvent = PushSyncEvent | PushNotificationEvent;
