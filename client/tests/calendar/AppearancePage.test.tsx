import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { toast } from "sonner";
import AppearancePage from "../../src/components/settings/pages/AppearancePage.tsx";
import { ThemeProvider } from "../../src/components/ThemeProvider.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";

// jsdom's File/Blob implementation doesn't support .text() yet
if (typeof File.prototype.text !== "function") {
  File.prototype.text = function (this: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

const STORAGE_KEY = "test-appearance-theme";

function Harness() {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <AppearancePage sectionRefs={sectionRefs} />;
}

const renderAppearancePage = () =>
  render(
    <ThemeProvider storageKey={STORAGE_KEY}>
      <Harness />
    </ThemeProvider>,
  );

async function savePresetNamed(name: string) {
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText("Theme name");
  await user.type(input, name);
  await user.click(screen.getByRole("button", { name: "Save" }));
  return user;
}

function getPresetRow(name: string) {
  return screen.getByText(name).closest("div")!.parentElement as HTMLElement;
}

describe("AppearancePage", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it("renders the theme mode options", () => {
    renderAppearancePage();

    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("renders sidebar color fields alongside the base palette", () => {
    renderAppearancePage();

    expect(screen.getByText("Sidebar background")).toBeInTheDocument();
    expect(screen.getByText("Sidebar text")).toBeInTheDocument();
    expect(screen.getByText("Sidebar primary")).toBeInTheDocument();
    expect(screen.getByText("Sidebar accent")).toBeInTheDocument();
    expect(screen.getByText("Sidebar border")).toBeInTheDocument();
    expect(screen.getByText("Sidebar ring")).toBeInTheDocument();
  });

  it("shows an empty state when there are no saved themes", () => {
    renderAppearancePage();

    expect(screen.getByText("No saved themes yet.")).toBeInTheDocument();
  });

  it("disables the save button until a theme name is entered", async () => {
    renderAppearancePage();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Theme name"), "My theme");

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves the current theme and lists it, without marking it active", async () => {
    renderAppearancePage();
    await savePresetNamed("Sunset");

    expect(screen.getByText("Sunset")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Theme saved.");
  });

  it("clears the name input after saving", async () => {
    renderAppearancePage();
    await savePresetNamed("Sunset");

    expect(screen.getByPlaceholderText("Theme name")).toHaveValue("");
  });

  it("marks a theme as active after applying it and hides its apply button", async () => {
    renderAppearancePage();
    const user = await savePresetNamed("Sunset");

    const row = getPresetRow("Sunset");
    const applyButton = within(row).getAllByRole("button")[0];
    await user.click(applyButton);

    expect(within(row).getByText("Active")).toBeInTheDocument();
    // the active row only has export + delete buttons left
    expect(within(row).getAllByRole("button")).toHaveLength(2);
  });

  it("removes a theme when deleted", async () => {
    renderAppearancePage();
    const user = await savePresetNamed("Sunset");

    const row = getPresetRow("Sunset");
    const deleteButton = within(row).getAllByRole("button").at(-1)!;
    await user.click(deleteButton);

    expect(screen.queryByText("Sunset")).not.toBeInTheDocument();
    expect(screen.getByText("No saved themes yet.")).toBeInTheDocument();
  });

  it("imports a valid theme file and lists it", async () => {
    renderAppearancePage();
    const user = userEvent.setup();

    const file = new File(
      [
        JSON.stringify({
          name: "Imported theme",
          colors: { background: "#111111" },
          fontFamily: "Menlo",
          fontSize: 15,
        }),
      ],
      "theme.json",
      { type: "application/json" },
    );

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByText("Imported theme")).toBeInTheDocument();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Imported theme "Imported theme".',
    );
  });

  it("rejects a malformed theme file", async () => {
    renderAppearancePage();
    const user = userEvent.setup();

    const file = new File(["not json"], "bad.json", {
      type: "application/json",
    });

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Invalid theme file.",
    );
    expect(screen.getByText("No saved themes yet.")).toBeInTheDocument();
  });

  it("rejects a theme file missing required fields", async () => {
    renderAppearancePage();
    const user = userEvent.setup();

    const file = new File(
      [JSON.stringify({ name: "Incomplete" })],
      "incomplete.json",
      { type: "application/json" },
    );

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Invalid theme file.",
    );
  });

  it("exports a theme as a downloadable .json file", async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderAppearancePage();
    const user = await savePresetNamed("Sunset");

    const row = getPresetRow("Sunset");
    const exportButton = within(row).getAllByRole("button")[1];
    await user.click(exportButton);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
