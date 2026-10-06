import { readJSON } from "@/lib/utils";

const KEY = "acl-description-sizes";

export type DescriptionSize = { width: number; height?: number };

export const DEFAULT_DESCRIPTION_SIZE = { width: 360 };

const readAll = () => readJSON<Record<string, DescriptionSize>>(KEY, {});

export const getDescriptionSize = (id: string): DescriptionSize | undefined =>
  readAll()[id];

export const saveDescriptionSize = (id: string, size: DescriptionSize) =>
  localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [id]: size }));

export function deleteDescriptionSizes(ids: string[]) {
  const { ...sizes } = readAll();
  if (!ids.some((id) => id in sizes)) return;
  for (const id of ids) delete sizes[id];
  localStorage.setItem(KEY, JSON.stringify(sizes));
}
