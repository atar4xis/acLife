import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Direction } from "radix-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../src/components/ui/dropdown-menu.tsx";

const renderMenu = (dir: "ltr" | "rtl") =>
  render(
    <Direction.Provider dir={dir}>
      <DropdownMenu open>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>more</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <div>child</div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </Direction.Provider>,
  );

describe("radix direction", () => {
  it.each([
    ["ltr", "right"],
    ["rtl", "left"],
  ] as const)("opens submenus to the %s-appropriate side", async (dir, side) => {
    renderMenu(dir);
    await userEvent.setup().hover(await screen.findByText("more"));
    const content = (await screen.findByText("child")).closest(
      "[data-side]",
    );
    expect(content).toHaveAttribute("data-side", side);
  });
});
