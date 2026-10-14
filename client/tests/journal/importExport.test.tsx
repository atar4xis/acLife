import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetJournal, setSession } from "./helpers.tsx";
import JournalImportExport from "../../src/components/settings/pages/JournalImportExport.tsx";
import {
  JournalProvider,
  useJournalItems,
} from "../../src/context/JournalContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import type { JournalItem } from "../../src/types/Journal.ts";

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

let items: JournalItem[] = [];

function Probe() {
  items = useJournalItems();
  return null;
}

beforeEach(() => localStorage.clear());
afterEach(resetJournal);

const markdown = (name: string, content: string) => {
  const file = new File([content], name);
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(content),
  });
  return file;
};

const importButton = () => screen.getByRole("button", { name: "Import" });

const renderReady = async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(
    <SettingsStoreProvider>
      <JournalProvider>
        <Probe />
        <JournalImportExport />
      </JournalProvider>
    </SettingsStoreProvider>,
  );
  await waitFor(() => expect(importButton()).toBeEnabled());
  return user;
};

const importFiles = (
  user: ReturnType<typeof userEvent.setup>,
  ...files: File[]
) => user.upload(screen.getByTestId("import-files"), files);

describe("journal import", () => {
  it("is disabled while the journal is not loaded", () => {
    setSession({ masterKey: null });
    render(
      <SettingsStoreProvider>
        <JournalProvider>
          <JournalImportExport />
        </JournalProvider>
      </SettingsStoreProvider>,
    );

    expect(importButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("imports the chosen files and lists what was skipped", async () => {
    const user = await renderReady();

    await importFiles(
      user,
      markdown("one.md", "first"),
      markdown("pic.png", "x"),
    );

    await screen.findByText("Imported 1 item, skipped 1.");
    expect(items.map((item) => item.name)).toEqual(["one"]);

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Unsupported file type")).toBeInTheDocument();
  });

  it("lists files that share a name without key warnings", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await renderReady();

    await importFiles(user, markdown("pic.png", "x"), markdown("pic.png", "y"));
    await user.click(await screen.findByRole("button", { name: "Details" }));

    expect(screen.getAllByText("Unsupported file type")).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("replaces an existing note when asked", async () => {
    const user = await renderReady();
    await importFiles(user, markdown("same.md", "first"));
    await screen.findByText("Imported 1 item, skipped 0.");

    await importFiles(user, markdown("same.md", "second"));
    await screen.findByText("Note already exists");
    await user.click(screen.getByRole("button", { name: "Replace" }));

    await screen.findByText("Imported 1 item, skipped 0.");
    expect(items.map((item) => item.content)).toEqual(["second"]);
  });

  it("skips an existing note when asked", async () => {
    const user = await renderReady();
    await importFiles(user, markdown("same.md", "first"));
    await screen.findByText("Imported 1 item, skipped 0.");

    await importFiles(user, markdown("same.md", "second"));
    await user.click(await screen.findByRole("button", { name: "Skip" }));

    await screen.findByText("Imported 0 items, skipped 1.");
    expect(items.map((item) => item.content)).toEqual(["first"]);
  });

  it("changes nothing when the conflict dialog is cancelled", async () => {
    const user = await renderReady();
    await importFiles(user, markdown("same.md", "first"));
    await screen.findByText("Imported 1 item, skipped 0.");

    await importFiles(user, markdown("same.md", "second"));
    await screen.findByText("Note already exists");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await screen.findByText("Import cancelled. Nothing was changed.");
    expect(items.map((item) => item.content)).toEqual(["first"]);
  });

  it("stops after the current batch when cancelled", async () => {
    const user = await renderReady();
    const files = Array.from({ length: 45 }, (_, i) =>
      markdown(`n${i}.md`, "x"),
    );

    await importFiles(user, ...files);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await screen.findByText("Import stopped. Progress: 20 of 45.");
    expect(items).toHaveLength(20);
  });
});
