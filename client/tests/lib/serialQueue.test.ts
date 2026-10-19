import { describe, expect, it, vi } from "vitest";
import { createCoalescer, createSerialQueue } from "../../src/lib/serialQueue.ts";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

describe("createCoalescer", () => {
  it("runs one task for requests made while it waits in the queue", async () => {
    const queue = createSerialQueue();
    const coalesce = createCoalescer(queue);
    const blocker = gate();
    const first = queue(() => blocker.opened);

    const task = vi.fn(async () => "done");
    const results = [coalesce(task), coalesce(task), coalesce(task)];
    blocker.open();
    await first;

    expect(await Promise.all(results)).toEqual(["done", "done", "done"]);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs the most recent task", async () => {
    const queue = createSerialQueue();
    const coalesce = createCoalescer(queue);
    const blocker = gate();
    void queue(() => blocker.opened);

    const stale = vi.fn(async () => "stale");
    const latest = vi.fn(async () => "latest");
    const results = [coalesce(stale), coalesce(latest)];
    blocker.open();

    expect(await Promise.all(results)).toEqual(["latest", "latest"]);
    expect(stale).not.toHaveBeenCalled();
  });

  it("queues one follow-up when asked again while the task runs", async () => {
    const queue = createSerialQueue();
    const coalesce = createCoalescer(queue);
    const running = gate();
    let runs = 0;
    const task = async () => {
      runs++;
      await running.opened;
    };

    const first = coalesce(task);
    await vi.waitFor(() => expect(runs).toBe(1));
    const second = coalesce(task);
    const third = coalesce(task);
    running.open();
    await Promise.all([first, second, third]);

    expect(runs).toBe(2);
  });

  it("keeps working after a task fails", async () => {
    const queue = createSerialQueue();
    const coalesce = createCoalescer(queue);

    await expect(coalesce(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await coalesce(async () => "ok")).toBe("ok");
  });
});
