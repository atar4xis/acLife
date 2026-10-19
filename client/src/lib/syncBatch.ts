import type { APIResponse } from "@/types/API";
import type { SyncReply } from "@/types/Sync";

export const MAX_SYNC_PARTS = 32;

const BATCH_WINDOW_MS = 25;

// captured at import so fake timers do not stall batching
const realSetTimeout = setTimeout;

type Post = <T>(endpoint: string, body: unknown) => Promise<APIResponse<T>>;

type QueuedPart = {
  space: string | undefined;
  part: object;
  resolve: (res: APIResponse<unknown>) => void;
};

const postParts = async (
  post: Post,
  path: string,
  parts: object[],
): Promise<APIResponse<SyncReply>> => {
  try {
    return await post<SyncReply>(path, { parts });
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

const createBatcher = (post: Post) => {
  const queuedByPath = new Map<string, QueuedPart[]>();

  const flush = async (path: string) => {
    const entries = queuedByPath.get(path) ?? [];
    queuedByPath.delete(path);

    const thisRequest: QueuedPart[] = [];
    const deferred: QueuedPart[] = [];
    const spaces = new Set<string | undefined>();
    for (const entry of entries) {
      if (thisRequest.length < MAX_SYNC_PARTS && !spaces.has(entry.space)) {
        spaces.add(entry.space);
        thisRequest.push(entry);
      } else {
        deferred.push(entry);
      }
    }

    if (deferred.length > 0) {
      queuedByPath.set(path, deferred);
      realSetTimeout(() => void flush(path), 0);
    }

    const parts = thisRequest.map(({ space, part }) => ({ ...part, space }));
    const res = await postParts(post, path, parts);

    thisRequest.forEach((entry, i) => {
      const answer = res.data?.parts[i];
      entry.resolve(answer ?? { ...res, success: false, data: undefined });
    });
  };

  return <T>(path: string, space: string | undefined, part: object) =>
    new Promise<APIResponse<T>>((resolve) => {
      const entries = queuedByPath.get(path) ?? [];
      queuedByPath.set(path, entries);
      entries.push({ space, part, resolve: resolve as QueuedPart["resolve"] });
      if (entries.length === 1)
        realSetTimeout(() => void flush(path), BATCH_WINDOW_MS);
    });
};

const batchers = new WeakMap<Post, ReturnType<typeof createBatcher>>();

export const syncPart = <T>(
  post: Post,
  path: string,
  space: string | undefined,
  part: object,
) => {
  let batcher = batchers.get(post);
  if (!batcher) {
    batcher = createBatcher(post);
    batchers.set(post, batcher);
  }
  return batcher<T>(path, space, part);
};
