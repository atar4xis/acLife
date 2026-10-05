import { useEffect } from "react";
import { useApi } from "@/context/ApiContext";
import { useUser } from "@/context/UserContext";
import { emitStream, type StreamMessage } from "@/lib/stream";
import { isSubscriptionMissing } from "@/lib/subscription";
import { joinUrl } from "@/lib/utils";

const MESSAGE_TYPES = ["sync", "settings", "calendar"] as const;
const RETRY_MS = 30000;
const TIMEOUT_MS = 60000;

type WireMessage = StreamMessage & { seq: number };

export default function StreamService() {
  const { url, serverMeta } = useApi();
  const { user } = useUser();
  const active =
    user?.type === "online" && !isSubscriptionMissing(user, serverMeta);

  useEffect(() => {
    if (!active || !url) return;

    let source: EventSource;
    let retry: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setTimeout>;
    let lastSeq = 0;

    const pullEverything = () => {
      emitStream({ type: "sync" });
      emitStream({ type: "settings" });
    };

    const armHeartbeat = () => {
      clearTimeout(heartbeat);
      heartbeat = setTimeout(() => {
        source.close();
        connect();
      }, TIMEOUT_MS);
    };

    const connect = () => {
      source = new EventSource(joinUrl(url, "/stream"), {
        withCredentials: true,
      });

      // changes made before the connection existed were never signalled
      source.onopen = () => {
        armHeartbeat();
        pullEverything();
      };

      // the browser only retries by itself while the connection is not refused
      source.onerror = () => {
        clearTimeout(heartbeat);
        if (source.readyState === EventSource.CLOSED) {
          retry = setTimeout(connect, RETRY_MS);
        }
      };

      source.addEventListener("ping", armHeartbeat);

      source.addEventListener("hello", (ev) => {
        lastSeq = (JSON.parse((ev as MessageEvent<string>).data) as WireMessage)
          .seq;
      });

      MESSAGE_TYPES.forEach((type) =>
        source.addEventListener(type, (ev) => {
          const event = JSON.parse(
            (ev as MessageEvent<string>).data,
          ) as WireMessage;
          armHeartbeat();
          const missed = event.seq !== lastSeq + 1;
          lastSeq = event.seq;

          if (missed) pullEverything();
          else emitStream(event);
        }),
      );
    };

    connect();

    return () => {
      clearTimeout(retry);
      clearTimeout(heartbeat);
      source.close();
    };
  }, [active, url]);

  return null;
}
