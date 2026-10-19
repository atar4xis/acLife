const PREFIX = "acLifeShared-";

export const sharedCacheName = (space: string) => PREFIX + space;

// drops the caches of spaces the user no longer belongs to
export const pruneSharedCaches = async (keep: Set<string>) => {
  const databases = (await indexedDB.databases?.()) ?? [];
  for (const { name } of databases) {
    if (name?.startsWith(PREFIX) && !keep.has(name.slice(PREFIX.length)))
      indexedDB.deleteDatabase(name);
  }
};
