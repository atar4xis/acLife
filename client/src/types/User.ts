import type { KeyEnvelope } from "@/lib/crypt";

type OfflineUser = {
  type: "offline";
};

type OnlineUser = {
  type: "online";
  uuid: string;
  email: string;
  envelopes: KeyEnvelope[];
  subscription_status: string | null;
};

export type User = OnlineUser | OfflineUser;
