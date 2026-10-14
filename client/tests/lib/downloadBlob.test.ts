import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ isTauri: false }));
const dialog = vi.hoisted(() => ({ save: vi.fn() }));
const fs = vi.hoisted(() => ({ writeFile: vi.fn() }));

vi.mock("../../src/lib/nativeUpdater.ts", () => ({
  get isTauri() {
    return native.isTauri;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
vi.mock("@tauri-apps/plugin-fs", () => fs);

import { downloadBlob } from "../../src/lib/utils.ts";

const blob = new Blob(["abc"]);
blob.arrayBuffer = async () => new Uint8Array([97, 98, 99]).buffer;

beforeEach(() => {
  native.isTauri = false;
  dialog.save.mockReset();
  fs.writeFile.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("downloadBlob", () => {
  it("clicks a download link and revokes the url a second later", async () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await downloadBlob(blob, "a.zip");
    expect(click).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("writes to the path chosen in the save dialog on Tauri", async () => {
    native.isTauri = true;
    dialog.save.mockResolvedValue("/home/me/a.zip");

    await downloadBlob(blob, "a.zip");

    expect(dialog.save).toHaveBeenCalledWith({ defaultPath: "a.zip" });
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/home/me/a.zip",
      new Uint8Array([97, 98, 99]),
    );
  });

  it("writes nothing when the save dialog is dismissed on Tauri", async () => {
    native.isTauri = true;
    dialog.save.mockResolvedValue(null);

    await downloadBlob(blob, "a.zip");

    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
