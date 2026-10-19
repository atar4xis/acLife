export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}

// runs only the latest task passed while one is waiting in the queue
export function createCoalescer(queue: ReturnType<typeof createSerialQueue>) {
  let latest: () => Promise<unknown>;
  let waiting: Promise<unknown> | null = null;

  return <T>(task: () => Promise<T>) => {
    latest = task;
    waiting ??= queue(() => {
      waiting = null;
      return latest();
    });
    return waiting as Promise<T>;
  };
}
