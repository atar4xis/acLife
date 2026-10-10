export type EncryptedRecord = {
  id: string;
  data: string;
  updatedAt: number;
};

export type CachedRecord = {
  id: string;
  ts: number;
};

export type SyncDiff<T> = {
  updated: T[];
  deleted: string[];
  added: T[];
};

export type RecordChange =
  | { type: "added" | "updated"; record: EncryptedRecord }
  | { type: "deleted"; id: string };
