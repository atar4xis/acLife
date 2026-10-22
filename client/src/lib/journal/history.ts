import { canDeleteItem, canEditItem } from "@/lib/journal/shared";
import type { JournalItem } from "@/types/Journal";

const indexById = (items: JournalItem[]) =>
  new Map(items.map((item) => [item.id, item]));

export function moveItemsToSnapshot(
  currentItems: JournalItem[],
  fromSnapshot: JournalItem[],
  toSnapshot: JournalItem[],
  now: number,
) {
  const fromById = indexById(fromSnapshot);
  const toById = indexById(toSnapshot);
  const currentById = indexById(currentItems);

  const changedIds = new Set([
    ...toSnapshot
      .filter((item) => fromById.get(item.id) !== item)
      .map((item) => item.id),
    ...fromSnapshot
      .filter((item) => !toById.has(item.id))
      .map((item) => item.id),
  ]);

  const restoredById = new Map<string, JournalItem>();
  const removedIds = new Set<string>();
  for (const id of changedIds) {
    const wanted = toById.get(id);
    const existing = currentById.get(id);

    if (!wanted) {
      if (existing && canDeleteItem(existing)) removedIds.add(id);
    } else if (!existing) {
      const deletedByTheStep = !fromById.has(id);
      if (deletedByTheStep) restoredById.set(id, { ...wanted, updatedAt: now });
    } else if (canEditItem(existing)) {
      restoredById.set(id, {
        ...wanted,
        content: existing.content,
        updatedAt: now,
      });
    }
  }

  const keptItems = currentItems.filter((item) => !removedIds.has(item.id));
  const finalIds = new Set([
    ...keptItems.map((item) => item.id),
    ...restoredById.keys(),
  ]);
  const withExistingParent = (item: JournalItem) =>
    item.parentId === null || item._shared || finalIds.has(item.parentId)
      ? item
      : { ...item, parentId: null };

  const items = [
    ...keptItems.map((item) => {
      const restored = restoredById.get(item.id);
      return restored ? withExistingParent(restored) : item;
    }),
    ...[...restoredById.values()]
      .filter((item) => !currentById.has(item.id))
      .map(withExistingParent),
  ];
  return { items, removedIds: [...removedIds] };
}
