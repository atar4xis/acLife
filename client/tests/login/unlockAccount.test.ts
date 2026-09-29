import { beforeEach, describe, expect, it, vi } from "vitest";

// argon2's WASM loader doesn't work under jsdom, so stub Worker with a SubtleCrypto-based hash
class FakeArgonWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;

  terminate() {}

  postMessage(data: { password: string; salt: number[]; hashLen: number }) {
    void crypto.subtle
      .digest(
        "SHA-256",
        new TextEncoder().encode(
          data.password + ":" + JSON.stringify(data.salt),
        ),
      )
      .then((digest) => {
        this.onmessage?.({
          data: { hash: Array.from(new Uint8Array(digest, 0, data.hashLen)) },
        } as MessageEvent);
      });
  }
}

const { generateMasterKeyEnvelope } = await import("../../src/lib/crypt.ts");
const { unlockAccount } = await import("../../src/lib/unlockAccount.ts");

const post = vi.fn();

beforeEach(() => {
  vi.stubGlobal("Worker", FakeArgonWorker);
  post.mockReset();
}, 30000);

describe("unlockAccount", () => {
  it("unwraps the master envelope with the right password", async () => {
    const { envelope, masterKey } = await generateMasterKeyEnvelope(
      "envelope-pass",
      true,
    );
    const user = { envelopes: [envelope], salt: null, challenge: null };

    const keys = await unlockAccount(
      "envelope-pass",
      user,
      post,
      undefined,
      true,
    );

    expect(await crypto.subtle.exportKey("raw", keys.masterKey)).toEqual(
      await crypto.subtle.exportKey("raw", masterKey),
    );
  }, 30000);

  it("returns non-extractable keys unless asked otherwise", async () => {
    const { envelope } = await generateMasterKeyEnvelope("envelope-pass");
    const user = { envelopes: [envelope], salt: null, challenge: null };

    const keys = await unlockAccount("envelope-pass", user, post);

    expect(keys.masterKey.extractable).toBe(false);
  }, 30000);

  it("rejects a wrong password", async () => {
    const { envelope } = await generateMasterKeyEnvelope("envelope-pass");
    const user = { envelopes: [envelope], salt: null, challenge: null };

    await expect(unlockAccount("nope", user, post)).rejects.toThrow();
  }, 30000);
});
