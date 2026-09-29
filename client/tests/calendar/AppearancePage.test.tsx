import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { toast } from "sonner";
import AppearancePage from "../../src/components/settings/pages/AppearancePage.tsx";
import { ThemeProvider } from "../../src/components/ThemeProvider.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";

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

function Harness() {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <AppearancePage sectionRefs={sectionRefs} />;
}

const renderAppearancePage = () =>
  render(
    <SettingsStoreProvider>
      <ThemeProvider>
        <Harness />
      </ThemeProvider>
    </SettingsStoreProvider>,
  );

async function savePresetNamed(name: string) {
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText("Theme name");
  await user.type(input, name);
  await user.click(screen.getByRole("button", { name: "Save" }));
  return user;
}

function makeThemeFile(name: string, extra: object = {}) {
  return new File(
    [
      JSON.stringify({
        name,
        colors: { background: "#111111" },
        fontFamily: "",
        fontSize: 16,
        ...extra,
      }),
    ],
    `${name}.json`,
    { type: "application/json" },
  );
}

const fileInput = () =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

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

    const sidebarGrid = screen.getByText("Sidebar")
      .nextElementSibling as HTMLElement;

    for (const label of [
      "Background",
      "Text",
      "Primary",
      "Primary text",
      "Accent",
      "Accent text",
      "Border",
      "Ring",
    ]) {
      expect(within(sidebarGrid).getByText(label)).toBeInTheDocument();
    }
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

  it("marks a theme as active after clicking it", async () => {
    renderAppearancePage();
    const user = await savePresetNamed("Sunset");

    const row = getPresetRow("Sunset");
    await user.click(row);

    expect(within(row).getByText("Active")).toBeInTheDocument();
    // the active row is no longer clickable to apply
    expect(row).not.toHaveAttribute("role", "button");
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
      "Invalid theme file: bad.json",
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
      "Invalid theme file: incomplete.json",
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

  it("switches Save to Overwrite when the name already exists and replaces the theme", async () => {
    renderAppearancePage();
    const user = await savePresetNamed("Sunset");

    await user.type(screen.getByPlaceholderText("Theme name"), "Sunset");
    await user.click(screen.getByRole("button", { name: "Overwrite" }));

    expect(screen.getAllByText("Sunset")).toHaveLength(1);
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Theme updated.");
  });

  it("imports multiple theme files at once", async () => {
    renderAppearancePage();
    const user = userEvent.setup();

    await user.upload(fileInput(), [makeThemeFile("One"), makeThemeFile("Two")]);

    expect(await screen.findByText("One")).toBeInTheDocument();
    expect(await screen.findByText("Two")).toBeInTheDocument();
  });

  it("imports a theme whose name exists with a numeric suffix", async () => {
    renderAppearancePage();
    const user = await savePresetNamed("catppuccin");

    await user.upload(fileInput(), makeThemeFile("catppuccin"));

    expect(await screen.findByText("catppuccin 2")).toBeInTheDocument();
    expect(screen.getByText("catppuccin")).toBeInTheDocument();
  });

  it("rejects an import with an invalid base", async () => {
    renderAppearancePage();
    const user = userEvent.setup();

    await user.upload(fileInput(), makeThemeFile("Bad", { base: "sepia" }));

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Invalid theme file: Bad.json",
    );
  });

  it("paginates saved themes, 5 per page", async () => {
    renderAppearancePage();
    const user = userEvent.setup();
    await user.upload(
      fileInput(),
      ["T1", "T2", "T3", "T4", "T5", "T6"].map((n) => makeThemeFile(n)),
    );
    await screen.findByText("T5");
    // imports land one at a time, so wait for the sixth before asserting
    const pageLabel = await screen.findByText("1 / 2");

    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.queryByText("T6")).not.toBeInTheDocument();

    const [prev, next] = pageLabel
      .parentElement!.querySelectorAll("button");
    expect(prev).toBeDisabled();
    await user.click(next);

    expect(screen.getByText("T6")).toBeInTheDocument();
    expect(screen.queryByText("T1")).not.toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("renames a theme by double clicking its name", async () => {
    renderAppearancePage();
    const user = await savePresetNamed("Sunset");

    await user.dblClick(screen.getByText("Sunset"));
    const input = screen.getByDisplayValue("Sunset");
    await user.clear(input);
    await user.type(input, "Dusk{Enter}");

    expect(screen.getByText("Dusk")).toBeInTheDocument();
    expect(screen.queryByText("Sunset")).not.toBeInTheDocument();
  });

  it("does not rename to a name used by another theme", async () => {
    renderAppearancePage();
    await savePresetNamed("A");
    const user = await savePresetNamed("B");

    await user.dblClick(screen.getByText("B"));
    const input = screen.getByDisplayValue("B");
    await user.clear(input);
    await user.type(input, "A{Enter}");

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "A theme with that name already exists.",
    );
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("cancels a rename with Escape", async () => {
    renderAppearancePage();
    const user = await savePresetNamed("Sunset");

    await user.dblClick(screen.getByText("Sunset"));
    await user.type(screen.getByDisplayValue("Sunset"), "x{Escape}");

    expect(screen.getByText("Sunset")).toBeInTheDocument();
  });

  it("does not apply a theme when a drag ends over its row", async () => {
    renderAppearancePage();
    await savePresetNamed("Sunset");
    const row = getPresetRow("Sunset");
    const handle = within(row).getAllByRole("button")[0];

    fireEvent.pointerDown(handle);
    fireEvent.pointerUp(row);
    fireEvent.click(row);
    await new Promise((r) => setTimeout(r, 5));

    expect(within(row).queryByText("Active")).not.toBeInTheDocument();

    await userEvent.setup().click(row);
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it("reorders themes by dragging the handle", async () => {
    renderAppearancePage();
    await savePresetNamed("A");
    await savePresetNamed("B");
    const rowA = getPresetRow("A");
    const rowB = getPresetRow("B");
    rowA.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 40 }) as DOMRect;
    rowB.getBoundingClientRect = () => ({ left: 0, right: 100, top: 40, bottom: 80 }) as DOMRect;

    fireEvent.pointerDown(within(rowA).getAllByRole("button")[0], {
      clientX: 10,
      clientY: 20,
    });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 60 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      const names = screen.getAllByText(/^[AB]$/).map((e) => e.textContent);
      expect(names).toEqual(["B", "A"]);
    });
  });

  describe("custom theme select", () => {
    const themeJson = (name: string, base: string) => ({
      name,
      base,
      colors: { background: "#123456" },
      fontFamily: "",
      fontSize: 16,
    });

    async function pick(user: ReturnType<typeof userEvent.setup>, name: string) {
      await user.click(screen.getByRole("combobox"));
      await user.click(await screen.findByRole("option", { name }));
    }

    it("lists built-in themes and applies the chosen one, fetching each only once", async () => {
      const fetchMock = vi.fn(async (url: string) => ({
        ok: true,
        text: async () =>
          JSON.stringify(
            url.includes("latte")
              ? themeJson("Catppuccin Latte", "light")
              : themeJson("Catppuccin Mocha", "dark"),
          ),
      }));
      vi.stubGlobal("fetch", fetchMock);
      renderAppearancePage();
      const user = userEvent.setup();

      await pick(user, "Catppuccin Latte");
      await waitFor(() =>
        expect(document.documentElement.style.getPropertyValue("--background")).toBe("#123456"),
      );
      await pick(user, "Catppuccin Mocha");
      await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
      await pick(user, "Catppuccin Latte");
      await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain("themes/catppuccin-latte.json");
      vi.unstubAllGlobals();
    });

    it("shows an error toast when the theme fails to load", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, text: async () => "" })));
      renderAppearancePage();

      await pick(userEvent.setup(), "Catppuccin Frappé");

      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Failed to load theme "Catppuccin Frappé".',
        ),
      );
      vi.unstubAllGlobals();
    });
  });
});
