import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FingerprintStep from "../../src/components/sharing/FingerprintStep.tsx";
import { arrayBufferToBase64 } from "../../src/lib/utils.ts";
import type { Trust } from "../../src/types/Share";

const publicKey = arrayBufferToBase64(new Uint8Array(65).fill(4).buffer);

const renderStep = (trust: Trust, onContinue = vi.fn()) => {
  render(
    <FingerprintStep
      email="bob@example.com"
      publicKey={publicKey}
      trust={trust}
      continueLabel="Go on"
      onContinue={onContinue}
      onCancel={vi.fn()}
    />,
  );
  return onContinue;
};

describe("FingerprintStep", () => {
  it("tells me to ask the other person for their own code, not to compare two different numbers", async () => {
    renderStep("new");

    await screen.findByLabelText("Security code of bob@example.com");
    expect(screen.getByText(/This is the security code for bob@example.com/)).toBeTruthy();
    expect(screen.getByText(/read out their own code/)).toBeTruthy();
    expect(screen.queryByText(/sees/)).toBeNull();
  });

  it("shows no warning for a code I have not seen before", async () => {
    renderStep("new");

    await screen.findByLabelText("Security code of bob@example.com");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Security code of bob@example.com").className).not.toContain("border-warning");
  });

  it("raises an alert with the warning when the code changed", async () => {
    renderStep("changed");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/security code for bob@example.com has changed/);
    expect(alert.className).toContain("text-warning");
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(screen.getByLabelText("Security code of bob@example.com").className).toContain("border-warning");
  });

  it("styles continuing after a changed code as risky", async () => {
    renderStep("changed");

    const button = await screen.findByRole("button", { name: "Go on" });
    expect(button.className).toContain("bg-destructive");
  });

  it("keeps the normal continue button when the code is only new", async () => {
    renderStep("new");

    const button = await screen.findByRole("button", { name: "Go on" });
    expect(button.className).not.toContain("bg-destructive");
  });
});
