type OfflineUser = {
  type: "offline";
};

type OnlineUser = {
  type: "online";
  uuid: string;
  email: string;
  salt: string;
  challenge: string;
  subscription_status: string | null;
};

export type User = OnlineUser | OfflineUser;
