import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJournalSave } from "../../src/hooks/journal/useJournalSave";

const key = {} as CryptoKey;

const setup = (
  save: (value: string, key: CryptoKey) => Promise<void>,
  initial: { value: string; loaded: boolean; masterKey: CryptoKey | null } = {
    value: "a",
    loaded: true,
    masterKey: key,
  },
) =>
  renderHook(
    (props) =>
      useJournalSave(props.value, props.masterKey, props.loaded, save),
    { initialProps: initial },
  );

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useJournalSave", () => {
  it("saves the latest value once after the debounce", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = setup(save);

    await act(() => vi.advanceTimersByTimeAsync(299));
    view.rerender({ value: "b", loaded: true, masterKey: key });
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(save).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("b", key);
  });

  it("does not save again when nothing changed", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = setup(save);

    await act(() => vi.advanceTimersByTimeAsync(300));
    view.unmount();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending value on unmount", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = setup(save);

    view.unmount();

    expect(save).toHaveBeenCalledWith("a", key);
  });

  it("saves nothing before the data is loaded or without a key", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const unloaded = setup(save, { value: "a", loaded: false, masterKey: key });
    const locked = setup(save, { value: "a", loaded: true, masterKey: null });

    await act(() => vi.advanceTimersByTimeAsync(1000));
    unloaded.unmount();
    locked.unmount();

    expect(save).not.toHaveBeenCalled();
  });

  it("toasts when saving fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("nope"));
    setup(save);

    await act(() => vi.advanceTimersByTimeAsync(300));

    expect(toast.error).toHaveBeenCalledWith("Could not save the journal.");
  });
});
