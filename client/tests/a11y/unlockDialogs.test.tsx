import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageData } from "../../src/types/Storage.ts";
import { expectNoViolations } from "./axe.ts";

const storageMock = vi.hoisted(() => ({
  ready: true,
  data: {} as Partial<StorageData>,
  get: (key: keyof StorageData) => storageMock.data[key],
  set: vi.fn(),
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({
    user: { type: "online", uuid: "u1", envelopes: [] },
    setMasterKey: vi.fn(),
    setBucketKey: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storageMock,
}));

vi.mock("../../src/lib/crypt.ts", () => ({}));
vi.mock("../../src/lib/unlockAccount.ts", () => ({}));

import UnlockDialog from "../../src/components/login/UnlockDialog.tsx";
import {
  PinSetupDialog,
  StayUnlockedDialog,
} from "../../src/components/settings/UnlockMethodDialogs.tsx";

beforeEach(() => {
  storageMock.data = {
    unlockMethod: "password",
    pinWrappedKeys: { salt: "salt", encrypted: "blob" },
  } as Partial<StorageData>;
});

describe("unlock dialogs a11y", () => {
  it("unlock dialog (password) has no axe violations", async () => {
    render(<UnlockDialog />);
    await screen.findByLabelText("Password");
    await expectNoViolations(document.body);
  });

  it("unlock dialog (PIN) has no axe violations", async () => {
    storageMock.data = { ...storageMock.data, unlockMethod: "pin" };
    render(<UnlockDialog />);
    await screen.findByLabelText("PIN code");
    await expectNoViolations(document.body);
  });

  it("PIN setup dialog labels every input and has no axe violations", async () => {
    render(<PinSetupDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByLabelText("PIN")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm PIN")).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("stay unlocked dialog labels its input and has no axe violations", async () => {
    render(<StayUnlockedDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });
});
