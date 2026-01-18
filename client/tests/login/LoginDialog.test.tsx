import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import LoginDialog from "../../src/components/login/LoginDialog.tsx";

describe("LoginDialog", () => {
  beforeEach(() => {
    render(<LoginDialog />);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.reject(new Error("Network error")),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
          }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  url: "https://ataraxis.codes/acLife/api",
                  policies: {},
                  registration: {
                    enabled: true,
                    subscriptionRequired: true,
                    email: { verificationRequired: false, domainBlacklist: [] },
                  },
                },
              }),
          }),
        ),
    );
  });

  it("renders", () => {
    expect(screen.getByText("Log in to your account")).toBeInTheDocument();
  });

  it("opens the server switcher and changes the server", async () => {
    const user = userEvent.setup();

    await user.click(screen.getByText("..."));
    expect(screen.getByText("Change server")).toBeInTheDocument();

    const input = await screen.findByLabelText("Server URL");

    const testConnectionButton = input.nextElementSibling as HTMLButtonElement;
    await waitFor(() => expect(testConnectionButton).toBeEnabled());

    await user.click(testConnectionButton);
    expect(await screen.findByText(/connection failed/i)).toBeInTheDocument();

    await user.click(testConnectionButton);
    expect(await screen.findByText(/invalid metadata/i)).toBeInTheDocument();

    await user.click(testConnectionButton);
    expect(
      await screen.findByText(/connection successful/i),
    ).toBeInTheDocument();
  });
});
