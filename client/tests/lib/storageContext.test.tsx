import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createStorageContext } from "../../src/context/StorageContext.tsx";
import { memoryAdapter } from "../../src/lib/adapter/memory.ts";

type Data = { old: string; added: number };

const defaults: Data = { old: "default", added: 0 };

describe("createStorageContext", () => {
  it("fills keys missing from stored data with their defaults", async () => {
    const { StorageProvider, useStorage } = createStorageContext<Data>(
      memoryAdapter<Data>({ old: "stored" } as Data),
      defaults,
    );
    const Probe = () => {
      const storage = useStorage();
      return (
        <p>
          {storage.ready ? `${storage.get("old")} ${storage.get("added")}` : ""}
        </p>
      );
    };

    render(
      <StorageProvider>
        <Probe />
      </StorageProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("stored 0")).toBeInTheDocument(),
    );
  });
});
