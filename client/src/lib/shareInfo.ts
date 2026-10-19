import type { JoinedSpace, SharedInfo } from "@/types/Share";

export const toSharedInfo = (space: JoinedSpace): SharedInfo => ({
  space: space.id,
  owner: space.owner,
  scope: space.scope,
  permission: space.permission,
});

export const mayWrite = (info: SharedInfo | undefined) =>
  !info || info.permission === "write";

export const mayDelete = (info: SharedInfo | undefined) =>
  !info || (info.permission === "write" && info.scope === "collection");
