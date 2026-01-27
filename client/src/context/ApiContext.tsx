import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import type { APIResponse } from "@/types/API";
import { joinUrl } from "@/lib/utils";
import type { WithChildren } from "@/types/Props";
import type { ServerMetadata } from "@/types/ServerMetadata";
import { validateServerMeta } from "@/lib/validators";
import { toast } from "sonner";

interface ApiContextType {
  url: string;
  setUrl: (url: string) => void;
  get: <T>(endpoint: string) => Promise<APIResponse<T>>;
  getRaw: (endpoint: string) => Promise<Response>;
  post: <T>(endpoint: string, body: unknown) => Promise<APIResponse<T>>;
  query: <T>(endpoint: string) => Promise<T>;
  serverMeta: ServerMetadata | null;
  setServerMeta: (meta: ServerMetadata) => void;
  pendingLogout: boolean;
  setPendingLogout: (val: boolean) => void;
}

const ApiContext = createContext<ApiContextType | undefined>(undefined);

export const ApiProvider = ({
  children,
  initialUrl = "",
}: WithChildren & { initialUrl?: string }) => {
  const [url, setUrl] = useState(initialUrl);
  const [serverMeta, setServerMeta] = useState<ServerMetadata | null>(null);
  const [pendingLogout, setPendingLogout] = useState(false);

  const get = useCallback(
    async <T,>(endpoint: string): Promise<APIResponse<T>> => {
      if (!url) throw Error("Cannot GET before connection is established.");

      try {
        const response = await fetch(joinUrl(url, endpoint), {
          credentials: "include",
        });

        if (response.status === 429) {
          return {
            success: false,
            message: "Too many requests. Try again later.",
          } as APIResponse<T>;
        }

        const result = await response.json();
        return result as APIResponse<T>;
      } catch (error) {
        console.error(error);
        return {
          success: false,
          message: "Invalid response from API.",
        } as APIResponse<T>;
      }
    },
    [url],
  );

  const getRaw = useCallback(
    async (endpoint: string): Promise<Response> => {
      if (!url) throw new Error("Cannot GET before connection is established.");

      try {
        const response = await fetch(joinUrl(url, endpoint), {
          credentials: "include",
        });

        if (response.status === 429) {
          throw new Error("Too many requests. Try again later.");
        }

        return response;
      } catch (error) {
        console.error(error);
        throw new Error("Invalid response from API.");
      }
    },
    [url],
  );

  const post = useCallback(
    async <T,>(endpoint: string, body: unknown): Promise<APIResponse<T>> => {
      if (!url) throw Error("Cannot POST before connection is established.");

      try {
        const headers: Record<string, string> = {};
        let payload: BodyInit | null = null;

        if (
          body instanceof Blob ||
          body instanceof ArrayBuffer ||
          body instanceof Uint8Array
        ) {
          payload = body;
        } else {
          payload = JSON.stringify(body);
          headers["Content-Type"] = "application/json";
        }

        const response = await fetch(joinUrl(url, endpoint), {
          method: "POST",
          headers,
          body: payload,
          credentials: "include",
        });

        if (response.status === 429) {
          return {
            success: false,
            message: "Too many requests. Try again later.",
          } as APIResponse<T>;
        } else if (response.status === 401) {
          setPendingLogout(true);
        }

        const result = await response.json();
        return result as APIResponse<T>;
      } catch (error) {
        console.error(error);
        return {
          success: false,
          message: "Invalid response from API.",
        } as APIResponse<T>;
      }
    },
    [url],
  );

  const query = useCallback(
    async <T,>(endpoint: string): Promise<T> => {
      const response = await get<T>(endpoint);
      if (!response.success || !response.data)
        throw new Error(response.message);
      return response.data!;
    },
    [get],
  );

  // update metadata whenever server changes
  useEffect(() => {
    if (!url) return;

    (async () => {
      try {
        const req = await fetch(joinUrl(url, "/metadata"), {
          credentials: "include",
        });
        const res = (await req.json()) as APIResponse<ServerMetadata>;

        if (!res || !res.success || !res.data) {
          setServerMeta(null);
          toast.error("Failed to fetch server metadata.");
          return;
        }

        if (!validateServerMeta(res.data)) {
          setServerMeta(null);
          toast.error("Failed to validate server metadata.");
          return;
        }

        setServerMeta(res.data);
      } catch {
        setServerMeta(null);
        toast.error("Failed to connect to server.");
      }
    })();
  }, [url]);

  return (
    <ApiContext.Provider
      value={{
        url,
        setUrl,
        get,
        getRaw,
        post,
        query,
        serverMeta,
        setServerMeta,
        pendingLogout,
        setPendingLogout,
      }}
    >
      {children}
    </ApiContext.Provider>
  );
};

// eslint-disable-next-line
export const useApi = (): ApiContextType => {
  const context = useContext(ApiContext);
  if (!context) throw new Error("useApi must be used within an ApiProvider");
  return context;
};
