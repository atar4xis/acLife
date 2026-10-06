import { beforeEach, describe, expect, it, vi } from "vitest";

const srpMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  client: {
    A: Uint8Array.from([1, 2, 3]),
    M1: Uint8Array.from([4, 5, 6]),
    M2: 7n,
    setB: vi.fn(),
  },
}));

vi.mock("@mzattahri/srp", async () => {
  const actual =
    await vi.importActual<typeof import("@mzattahri/srp")>("@mzattahri/srp");
  return { ...actual, Client: { initialize: srpMock.initialize } };
});

import { postWithPassword, srpLogin } from "../../src/lib/srpLogin.ts";
import { bytesToBase64 } from "../../src/lib/utils.ts";

const b64 = (...bytes: number[]) => bytesToBase64(Uint8Array.from(bytes));

const post = vi.fn();

beforeEach(() => {
  post.mockReset();
  srpMock.initialize.mockReset().mockResolvedValue(srpMock.client);
  srpMock.client.setB.mockReset();
});

describe("srpLogin", () => {
  it("logs in when the server proves itself", async () => {
    post
      .mockResolvedValueOnce({ success: true, data: b64(9) })
      .mockResolvedValueOnce({
        success: true,
        data: { B: b64(8), session_id: "s1" },
      })
      .mockResolvedValueOnce({ success: true, data: { M2: b64(7) } });

    expect(await srpLogin(post, "a@b.c", "pw")).toEqual({ success: true });
    expect(post).toHaveBeenLastCalledWith("auth/login/verify", {
      email: "a@b.c",
      M1: b64(4, 5, 6),
      session_id: "s1",
    });
  });

  it("rejects a server proof that does not match", async () => {
    post
      .mockResolvedValueOnce({ success: true, data: b64(9) })
      .mockResolvedValueOnce({
        success: true,
        data: { B: b64(8), session_id: "s1" },
      })
      .mockResolvedValueOnce({ success: true, data: { M2: b64(6) } });

    expect((await srpLogin(post, "a@b.c", "pw")).success).toBe(false);
  });

  it("never retries with another kdf when the server refuses the proof", async () => {
    post
      .mockResolvedValueOnce({ success: true, data: b64(9) })
      .mockResolvedValueOnce({
        success: true,
        data: { B: b64(8), session_id: "s1" },
      })
      .mockResolvedValueOnce({
        success: false,
        message: "Invalid credentials.",
        code: "invalid_credentials",
      });

    expect(await srpLogin(post, "a@b.c", "pw")).toMatchObject({
      success: false,
      message: "Invalid credentials.",
    });
    expect(srpMock.initialize).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(3);
  });
});

describe("postWithPassword", () => {
  it("proves the password through SRP and never sends it", async () => {
    post
      .mockResolvedValueOnce({ success: true, data: b64(9) })
      .mockResolvedValueOnce({
        success: true,
        data: { B: b64(8), session_id: "s1" },
      })
      .mockResolvedValueOnce({ success: true });

    const res = await postWithPassword(post, "a@b.c", "hunter2", "user/email", {
      triplet: "new",
    });

    expect(res.success).toBe(true);
    expect(post).toHaveBeenNthCalledWith(2, "user/reauth/start", {
      A: b64(1, 2, 3),
    });
    expect(post).toHaveBeenNthCalledWith(3, "user/email", {
      triplet: "new",
      M1: b64(4, 5, 6),
      session_id: "s1",
    });
    expect(JSON.stringify(post.mock.calls)).not.toContain("hunter2");
  });

  it("does not post the request when the SRP start fails", async () => {
    post
      .mockResolvedValueOnce({ success: true, data: b64(9) })
      .mockResolvedValueOnce({
        success: false,
        message: "Too many attempts.",
        code: "too_many_attempts_minutes",
      });

    expect(
      await postWithPassword(post, "a@b.c", "pw", "user/password", {}),
    ).toMatchObject({ success: false, code: "too_many_attempts_minutes" });
    expect(post).toHaveBeenCalledTimes(2);
  });
});
