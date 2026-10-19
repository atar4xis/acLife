import type { SpaceKeys } from "@/lib/shareCrypto";

export type SpaceKind = "calendar" | "journal";
export type SpaceScope = "item" | "collection";
export type Permission = "read" | "write";

export type ShareMember = {
  user: string;
  email: string;
  publicKey: string;
  permission: Permission;
  status: "pending" | "accepted";
};

type OwnedShareWire = {
  id: string;
  kind: SpaceKind;
  scope: SpaceScope;
  ownerKey: string;
  keyVersion: number;
  members: ShareMember[];
};

export type ReceivedShare = {
  id: string;
  owner: string;
  ownerEmail: string;
  ownerPublicKey: string;
  kind: SpaceKind;
  scope: SpaceScope;
  permission: Permission;
  status: "pending" | "accepted";
  wrappedKey: string;
  keyVersion: number;
};

export type ShareListWire = {
  owned: OwnedShareWire[];
  received: ReceivedShare[];
};

export type OwnedSpace = {
  id: string;
  kind: SpaceKind;
  scope: SpaceScope;
  target: string | null;
  members: ShareMember[];
  raw: Uint8Array<ArrayBuffer>;
  keys: SpaceKeys;
};

export type JoinedSpace = {
  id: string;
  owner: string;
  ownerEmail: string;
  ownerPublicKey: string;
  kind: SpaceKind;
  scope: SpaceScope;
  permission: Permission;
  keys: SpaceKeys;
};

export type Contact = {
  uuid: string;
  email: string;
  publicKey: string;
};

export type SavedContact = Contact & { removable: boolean };

export type SharedInfo = {
  space: string;
  owner: string;
  scope: SpaceScope;
  permission: Permission;
};

export type Trust = "new" | "same" | "changed";

export type Candidate = { contact: Contact; trust: Trust };
