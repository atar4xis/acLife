import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StreamService from "../../src/components/StreamService";
import { CLIENT_ID } from "../../src/lib/clientId";
import { onStream } from "../../src/lib/stream";

type MockUser = { type: string; subscription_status?: string } | null;

let mockUser: MockUser = { type: "online" };
let mockMeta: object | null = null;

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: mockUser }),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({ url: "http://mock-api", serverMeta: mockMeta }),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CLOSED = 2;
  readyState = 1;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, (ev: MessageEvent<string>) => void> = {};

  constructor(
    public url: string,
    public init: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: MessageEvent<string>) => void) {
    this.listeners[type] = cb;
  }

  close() {
    this.closed = true;
  }

  seq = 0;

  hello(seq: number) {
    this.seq = seq;
    this.listeners.hello(
      new MessageEvent("hello", { data: JSON.stringify({ type: "hello", seq }) }),
    );
  }

  send(type: string, data: object, seq = ++this.seq) {
    this.seq = seq;
    this.listeners[type](
      new MessageEvent(type, { data: JSON.stringify({ ...data, seq }) }),
    );
  }
}

describe("event stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUser = { type: "online" };
    mockMeta = null;
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens one credentialed stream for online users", () => {
    render(<StreamService />);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("http://mock-api/stream");
    expect(FakeEventSource.instances[0].init).toEqual({ withCredentials: true });
  });

  it("stays closed for offline users", () => {
    mockUser = { type: "offline" };
    render(<StreamService />);

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("closes the stream when the user logs out", () => {
    const { rerender } = render(<StreamService />);

    mockUser = null;
    rerender(<StreamService />);

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("closes the stream when switching to offline mode", () => {
    const { rerender } = render(<StreamService />);

    mockUser = { type: "offline" };
    rerender(<StreamService />);

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("does not connect without the subscription the server requires", () => {
    mockMeta = { registration: { subscriptionRequired: true } };
    mockUser = { type: "online", subscription_status: "canceled" };
    render(<StreamService />);

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("connects with an active subscription when the server requires one", () => {
    mockMeta = { registration: { subscriptionRequired: true } };
    mockUser = { type: "online", subscription_status: "active" };
    render(<StreamService />);

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("closes the stream when the subscription lapses", () => {
    mockMeta = { registration: { subscriptionRequired: true } };
    mockUser = { type: "online", subscription_status: "active" };
    const { rerender } = render(<StreamService />);

    mockUser = { type: "online", subscription_status: "canceled" };
    rerender(<StreamService />);

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("closes the stream on unmount", () => {
    const { unmount } = render(<StreamService />);
    unmount();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("delivers events of every origin, including this client", () => {
    const onSync = vi.fn();
    const onSettings = vi.fn();
    const stopSync = onStream("sync", onSync);
    const stopSettings = onStream("settings", onSettings);
    render(<StreamService />);
    const source = FakeEventSource.instances[0];

    source.send("sync", { type: "sync", originClientId: "other1" });
    source.send("sync", { type: "sync", originClientId: CLIENT_ID });
    source.send("sync", { type: "sync" });

    expect(onSync).toHaveBeenCalledTimes(3);
    expect(onSync.mock.calls[1][0].originClientId).toBe(CLIENT_ID);
    expect(onSettings).not.toHaveBeenCalled();

    source.send("settings", { type: "settings", originClientId: "other1" });
    expect(onSettings).toHaveBeenCalledTimes(1);

    stopSync();
    stopSettings();
  });

  it("stops notifying after unsubscribing", () => {
    const onSync = vi.fn();
    onStream("sync", onSync)();
    render(<StreamService />);

    FakeEventSource.instances[0].send("sync", { type: "sync" });

    expect(onSync).not.toHaveBeenCalled();
  });

  it("pulls everything on every successful open, the first one included", () => {
    const onSync = vi.fn();
    const onSettings = vi.fn();
    const stopSync = onStream("sync", onSync);
    const stopSettings = onStream("settings", onSettings);
    render(<StreamService />);
    const source = FakeEventSource.instances[0];

    source.onopen?.();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledTimes(1);

    source.onopen?.();
    expect(onSync).toHaveBeenCalledTimes(2);
    expect(onSettings).toHaveBeenCalledTimes(2);

    stopSync();
    stopSettings();
  });

  it("pulls everything when the first successful open follows a refused attempt", () => {
    const onSync = vi.fn();
    const stop = onStream("sync", onSync);
    render(<StreamService />);
    const first = FakeEventSource.instances[0];
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(onSync).not.toHaveBeenCalled();

    FakeEventSource.instances[1].onopen?.();

    expect(onSync).toHaveBeenCalledTimes(1);
    stop();
  });

  it("opens a new stream after the server refuses the connection", () => {
    render(<StreamService />);
    const first = FakeEventSource.instances[0];

    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(29999);
    });
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("leaves reconnecting to the browser while the connection is only interrupted", () => {
    render(<StreamService />);

    FakeEventSource.instances[0].onerror?.();
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  describe("sequence numbers", () => {
    const listen = () => {
      const onSync = vi.fn();
      const onSettings = vi.fn();
      const onChanges = vi.fn();
      const stops = [
        onStream("sync", onSync),
        onStream("settings", onSettings),
        onStream("calendar", onChanges),
      ];
      return { onSync, onSettings, onChanges, stop: () => stops.forEach((s) => s()) };
    };
    const change = {
      type: "calendar",
      originClientId: "other1",
      changes: [{ type: "deleted", id: "a" }],
    };

    it("starts counting from the hello sequence", () => {
      const { onChanges, onSync, stop } = listen();
      render(<StreamService />);
      const source = FakeEventSource.instances[0];

      source.hello(41);
      source.send("calendar", change, 42);

      expect(onChanges).toHaveBeenCalledTimes(1);
      expect(onChanges.mock.calls[0][0].changes).toEqual(change.changes);
      expect(onSync).not.toHaveBeenCalled();
      stop();
    });

    it("pulls everything instead of using an event that follows a gap", () => {
      const { onChanges, onSync, onSettings, stop } = listen();
      render(<StreamService />);
      const source = FakeEventSource.instances[0];

      source.hello(5);
      source.send("calendar", change, 7);

      expect(onChanges).not.toHaveBeenCalled();
      expect(onSync).toHaveBeenCalledTimes(1);
      expect(onSettings).toHaveBeenCalledTimes(1);
      stop();
    });

    it("resumes normally after pulling", () => {
      const { onChanges, stop } = listen();
      render(<StreamService />);
      const source = FakeEventSource.instances[0];

      source.hello(5);
      source.send("calendar", change, 7);
      source.send("calendar", change, 8);

      expect(onChanges).toHaveBeenCalledTimes(1);
      stop();
    });

    it("treats a repeated or older sequence as a gap", () => {
      const { onChanges, onSync, stop } = listen();
      render(<StreamService />);
      const source = FakeEventSource.instances[0];

      source.hello(5);
      source.send("calendar", change, 6);
      source.send("calendar", change, 6);

      expect(onChanges).toHaveBeenCalledTimes(1);
      expect(onSync).toHaveBeenCalledTimes(1);
      stop();
    });

    it("counts events from this client like any other", () => {
      const { onChanges, onSync, stop } = listen();
      render(<StreamService />);
      const source = FakeEventSource.instances[0];

      source.hello(0);
      source.send("calendar", { ...change, originClientId: CLIENT_ID });
      source.send("calendar", change);

      expect(onChanges).toHaveBeenCalledTimes(2);
      expect(onSync).not.toHaveBeenCalled();
      stop();
    });

    it("counts sync and settings events too", () => {
      const { onSync, onSettings, onChanges, stop } = listen();
      render(<StreamService />);
      const source = FakeEventSource.instances[0];

      source.hello(0);
      source.send("sync", { type: "sync", originClientId: "other1" });
      source.send("settings", { type: "settings", originClientId: "other1" });
      source.send("calendar", change);

      expect(onSync).toHaveBeenCalledTimes(1);
      expect(onSettings).toHaveBeenCalledTimes(1);
      expect(onChanges).toHaveBeenCalledTimes(1);
      stop();
    });

    it("restarts the count from the hello of a new connection", () => {
      const { onChanges, onSync, stop } = listen();
      render(<StreamService />);
      const first = FakeEventSource.instances[0];
      first.hello(100);
      first.readyState = FakeEventSource.CLOSED;
      first.onerror?.();
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      const second = FakeEventSource.instances[1];

      second.hello(3);
      second.send("calendar", change, 4);

      expect(onChanges).toHaveBeenCalledTimes(1);
      expect(onSync).not.toHaveBeenCalled();
      stop();
    });
  });
});
