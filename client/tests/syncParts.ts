type Post = (endpoint: string, body: never) => unknown;

const SYNC_PATHS = ["journal/sync", "calendar/events/sync"];

export const syncRequests: { endpoint: string; spaces: (string | undefined)[] }[] = [];

export const withParts =
  (post: Post) => async (endpoint: string, body: unknown) => {
    if (!SYNC_PATHS.includes(endpoint)) return post(endpoint, body as never);

    const { parts } = body as { parts: { space?: string }[] };
    syncRequests.push({ endpoint, spaces: parts.map((part) => part.space) });
    const replies = await Promise.all(
      parts.map(({ space, ...part }) =>
        post(space ? `shares/sync?space=${space}` : endpoint, part as never),
      ),
    );
    return { success: true, data: { parts: replies } };
  };
