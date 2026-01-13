import type { StorageAdapter } from "@/types/Storage";

export function indexedDBAdapter<T extends object>(
  dbName: string,
  storeName: string,
  initial: T,
): StorageAdapter<T> {
  const openDB = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const putItem = async (db: IDBDatabase, value: T) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      store.put(value, "data");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  const getItem = async (db: IDBDatabase): Promise<T | null> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get("data");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });

  const removeItem = async (db: IDBDatabase) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      store.delete("data");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  return {
    load() {
      openDB().then((db) =>
        getItem(db).then((res) => {
          if (res) Object.assign(initial, res);
        }),
      );
      return initial;
    },
    save(state) {
      openDB().then((db) => putItem(db, state));
    },
    remove() {
      openDB().then((db) => removeItem(db));
    },
    clear() {
      openDB().then((db) => removeItem(db));
    },
  };
}
